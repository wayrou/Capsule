import { binaryPreviewAsHex, previewImageSource } from "./preview";
import { getActiveTab, getFilteredEntries, getPrimarySelectedEntry, isTabEmpty } from "./state";
import type { AppState, ArchiveEntry, CapsuleTab } from "./types";
import {
  dirname,
  escapeHtml,
  formatBytes,
  formatDateTime,
  humanizeKind,
  normalizePath,
  pathSegments,
} from "./utils";

type RenderHandlers = {
  onSelectTab: (id: number) => void;
  onCloseTab: (id: number) => void;
  onAddTab: () => void;
  onSelectRow: (path: string, append: boolean) => void;
  onSelectTreeFile: (path: string) => void;
  onToggleFolder: (path: string) => void;
  onClearFolderFilter: () => void;
};

type TreeNode = {
  name: string;
  path: string;
  folders: Map<string, TreeNode>;
  files: ArchiveEntry[];
};

function createTreeRoot(): TreeNode {
  return {
    name: "",
    path: "",
    folders: new Map<string, TreeNode>(),
    files: [],
  };
}

function buildTree(tab: CapsuleTab): TreeNode {
  const root = createTreeRoot();

  if (!tab.archive) {
    root.files = [...tab.entries];
    return root;
  }

  for (const entry of tab.entries) {
    const normalized = normalizePath(entry.path);
    const parts = pathSegments(normalized);
    if (parts.length === 0) {
      root.files.push(entry);
      continue;
    }

    const folderParts = entry.kind === "dir" ? parts : parts.slice(0, -1);
    let cursor = root;
    let currentPath = "";

    for (const part of folderParts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      let next = cursor.folders.get(part);
      if (!next) {
        next = {
          name: part,
          path: currentPath,
          folders: new Map<string, TreeNode>(),
          files: [],
        };
        cursor.folders.set(part, next);
      }
      cursor = next;
    }

    if (entry.kind !== "dir") {
      cursor.files.push(entry);
    }
  }

  return root;
}

function renderTreeNode(
  node: TreeNode,
  tab: CapsuleTab,
  handlers: RenderHandlers,
  container: HTMLElement,
): void {
  const folderNames = Array.from(node.folders.keys()).sort((left, right) => left.localeCompare(right));

  for (const folderName of folderNames) {
    const folder = node.folders.get(folderName);
    if (!folder) continue;

    const branch = document.createElement("div");
    branch.className = "tree-branch";

    const button = document.createElement("button");
    const isExpanded =
      tab.expandedFolders.has(folder.path) ||
      tab.folderFilter === folder.path ||
      (tab.folderFilter ? tab.folderFilter.startsWith(`${folder.path}/`) : false);
    button.className = `tree-row tree-folder${tab.folderFilter === folder.path ? " active" : ""}`;
    button.type = "button";
    button.innerHTML = `
      <span class="tree-chevron">${isExpanded ? "▾" : "▸"}</span>
      <span class="tree-label">${escapeHtml(folder.name)}</span>
    `;
    button.addEventListener("click", () => handlers.onToggleFolder(folder.path));
    branch.appendChild(button);

    if (isExpanded) {
      const nested = document.createElement("div");
      nested.className = "tree-nested";
      renderTreeNode(folder, tab, handlers, nested);
      branch.appendChild(nested);
    }

    container.appendChild(branch);
  }

  const files = [...node.files].sort((left, right) => left.name.localeCompare(right.name));
  for (const file of files) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `tree-row tree-file${tab.selectedPaths.includes(file.path) ? " active" : ""}`;
    button.innerHTML = `<span class="tree-label">${escapeHtml(file.name)}</span>`;
    button.addEventListener("click", () => handlers.onSelectTreeFile(file.path));
    container.appendChild(button);
  }
}

function renderTopBar(state: AppState): void {
  const tab = getActiveTab(state);
  const formatChip = document.getElementById("archive-format-chip");
  const modeChip = document.getElementById("archive-mode-chip");
  const openButton = document.getElementById("btn-open-archive") as HTMLButtonElement | null;
  const addButton = document.getElementById("btn-add-files") as HTMLButtonElement | null;
  const createButton = document.getElementById("btn-save-archive") as HTMLButtonElement | null;
  const extractButton = document.getElementById("btn-extract-all") as HTMLButtonElement | null;
  const extractSelectedButton =
    document.getElementById("btn-extract-selected") as HTMLButtonElement | null;
  const removeSelectedButton =
    document.getElementById("btn-remove-selected") as HTMLButtonElement | null;
  const searchInput = document.getElementById("search-input") as HTMLInputElement | null;

  const hasArchive = Boolean(tab?.archive);
  const hasSelection = Boolean(tab?.selectedPaths.length);
  const canAdd = !state.isBusy && Boolean(tab) && (!tab?.archive || tab.capabilities.canAddFiles);
  const canCreateZip = !state.isBusy && Boolean(tab) && !tab?.archive && (tab?.entries.length ?? 0) > 0;
  const canExtract = !state.isBusy && Boolean(tab?.archive && tab.capabilities.canExtractAll);
  const canExtractSelected =
    !state.isBusy &&
    Boolean(tab?.archive && tab.capabilities.canExtractSelected && tab.selectedPaths.length > 0);
  const canRemove =
    !state.isBusy &&
    Boolean(tab && hasSelection && (!tab.archive || tab.capabilities.canRemoveFiles));

  if (formatChip) {
    formatChip.hidden = !hasArchive;
    formatChip.textContent = tab?.archive?.format ?? "";
  }

  if (modeChip) {
    const showReadOnly = Boolean(tab?.archive && tab.capabilities.readOnly);
    modeChip.hidden = !showReadOnly;
    modeChip.textContent = showReadOnly ? "Read only" : "";
  }

  if (openButton) openButton.disabled = state.isBusy;
  if (addButton) addButton.disabled = !canAdd;
  if (createButton) {
    createButton.disabled = !canCreateZip;
    createButton.hidden = Boolean(tab?.archive);
  }
  if (extractButton) extractButton.disabled = !canExtract;
  if (extractSelectedButton) {
    extractSelectedButton.disabled = !canExtractSelected;
    extractSelectedButton.textContent = hasSelection
      ? `Extract selected (${tab?.selectedPaths.length ?? 0})`
      : "Extract selected";
  }
  if (removeSelectedButton) {
    removeSelectedButton.disabled = !canRemove;
    removeSelectedButton.textContent = hasSelection
      ? `Remove selected (${tab?.selectedPaths.length ?? 0})`
      : "Remove selected";
  }
  if (searchInput) {
    searchInput.disabled = !tab || tab.entries.length === 0;
    if (tab && searchInput.value !== tab.searchQuery) {
      searchInput.value = tab.searchQuery;
    }
  }
}

function renderTabs(state: AppState, handlers: RenderHandlers): void {
  const tabStrip = document.getElementById("tab-strip");
  if (!tabStrip) return;

  const activeTab = getActiveTab(state);
  const shouldShow =
    state.tabs.length > 1 || (activeTab ? !isTabEmpty(activeTab) : false);
  tabStrip.hidden = !shouldShow;
  if (!shouldShow) {
    tabStrip.innerHTML = "";
    return;
  }

  tabStrip.innerHTML = "";

  for (const tab of state.tabs) {
    const item = document.createElement("div");
    item.className = `tab-chip${state.activeTabId === tab.id ? " active" : ""}`;

    const openTabButton = document.createElement("button");
    openTabButton.type = "button";
    openTabButton.className = "tab-chip-button";
    openTabButton.textContent = `${tab.title}${tab.isDirty ? " *" : ""}`;
    openTabButton.addEventListener("click", () => handlers.onSelectTab(tab.id));
    item.appendChild(openTabButton);

    if (state.tabs.length > 1 || !isTabEmpty(tab)) {
      const closeButton = document.createElement("button");
      closeButton.type = "button";
      closeButton.className = "tab-chip-close";
      closeButton.textContent = "×";
      closeButton.setAttribute("aria-label", `Close ${tab.title}`);
      closeButton.addEventListener("click", () => handlers.onCloseTab(tab.id));
      item.appendChild(closeButton);
    }

    tabStrip.appendChild(item);
  }

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "tab-chip-add";
  addButton.textContent = "+";
  addButton.setAttribute("aria-label", "New tab");
  addButton.addEventListener("click", handlers.onAddTab);
  tabStrip.appendChild(addButton);
}

function renderHero(state: AppState): void {
  const hero = document.getElementById("hero-panel");
  const tab = getActiveTab(state);
  if (!hero || !tab) return;

  hero.hidden = !isTabEmpty(tab);
  hero.classList.toggle("drag-active", state.isDragActive);
}

function renderSummary(state: AppState): void {
  const panel = document.getElementById("summary-panel");
  if (!panel) return;

  const tab = getActiveTab(state);
  if (!tab || isTabEmpty(tab)) {
    panel.innerHTML = `
      <div class="summary-card empty">
        <p class="summary-kicker">Ready</p>
        <h2>Open an archive or build a ZIP</h2>
        <p class="summary-copy">Capsule keeps the workflow simple: open, preview, extract.</p>
      </div>
    `;
    return;
  }

  const visibleEntries = getFilteredEntries(tab);
  const summaryTitle = tab.archive ? tab.archive.name : "New ZIP";
  const summarySubtitle = tab.archive
    ? `${tab.archive.format} archive`
    : `${tab.entries.length} staged item${tab.entries.length === 1 ? "" : "s"}`;

  const stats = [
    ["Entries", String(tab.entries.length)],
    ["Visible", String(visibleEntries.length)],
    ["Unpacked", formatBytes(tab.archive?.totalSize ?? 0)],
    ["Compressed", tab.archive ? formatBytes(tab.archive.compressedSize) : "—"],
    ["Encrypted", String(tab.archive?.encryptedEntries ?? 0)],
    ["Selected", String(tab.selectedPaths.length)],
  ];

  panel.innerHTML = `
    <div class="summary-card">
      <p class="summary-kicker">${tab.archive ? "Current archive" : "Staged ZIP"}</p>
      <h2>${escapeHtml(summaryTitle)}</h2>
      <p class="summary-copy">${escapeHtml(summarySubtitle)}</p>
      ${
        tab.archive && tab.capabilities.readOnlyReason
          ? `<p class="summary-note">${escapeHtml(tab.capabilities.readOnlyReason)}</p>`
          : !tab.archive
            ? `<p class="summary-note">Add files, then create a ZIP when you are ready.</p>`
            : `<p class="summary-note">ZIP archives stay editable inside Capsule.</p>`
      }
      <dl class="summary-stats">
        ${stats
          .map(
            ([label, value]) => `
              <div>
                <dt>${escapeHtml(label)}</dt>
                <dd>${escapeHtml(value)}</dd>
              </div>
            `,
          )
          .join("")}
      </dl>
    </div>
  `;
}

function renderTree(state: AppState, handlers: RenderHandlers): void {
  const panel = document.getElementById("tree-panel");
  const clearButton = document.getElementById("btn-clear-folder-filter") as HTMLButtonElement | null;
  if (!panel) return;

  const tab = getActiveTab(state);
  panel.innerHTML = "";

  if (clearButton) {
    clearButton.hidden = !tab?.folderFilter;
    clearButton.onclick = handlers.onClearFolderFilter;
  }

  if (!tab || tab.entries.length === 0) {
    panel.innerHTML = `<p class="tree-empty">Archive contents appear here once something is open.</p>`;
    return;
  }

  const tree = buildTree(tab);
  const container = document.createElement("div");
  container.className = "tree-root";
  renderTreeNode(tree, tab, handlers, container);
  panel.appendChild(container);
}

function renderFileTable(state: AppState, handlers: RenderHandlers): void {
  const tbody = document.getElementById("file-table-body") as HTMLTableSectionElement | null;
  if (!tbody) return;

  const tab = getActiveTab(state);
  tbody.innerHTML = "";

  if (!tab || tab.entries.length === 0) {
    tbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="4">Open an archive to browse it, or add files to build a new ZIP.</td>
      </tr>
    `;
    return;
  }

  const visibleEntries = getFilteredEntries(tab);
  if (visibleEntries.length === 0) {
    tbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="4">No results match the current folder or search filter.</td>
      </tr>
    `;
    return;
  }

  for (const entry of visibleEntries) {
    const row = document.createElement("tr");
    row.className = `file-row${tab.selectedPaths.includes(entry.path) ? " selected" : ""}`;
    row.tabIndex = 0;

    const pathDetail = tab.archive ? dirname(entry.path) : entry.path;
    row.innerHTML = `
      <td>
        <div class="file-name-cell">
          <span class="file-name">${escapeHtml(entry.name)}</span>
          <span class="file-path">${escapeHtml(pathDetail || "Root")}</span>
        </div>
      </td>
      <td>${escapeHtml(formatBytes(entry.size))}</td>
      <td><span class="kind-pill">${escapeHtml(humanizeKind(entry.kind))}</span></td>
      <td>${escapeHtml(formatDateTime(entry.modified))}</td>
    `;

    const select = (append: boolean) => handlers.onSelectRow(entry.path, append);

    row.addEventListener("click", (event) => {
      const mouseEvent = event as MouseEvent;
      select(Boolean(mouseEvent.ctrlKey || mouseEvent.metaKey));
    });

    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        const keyboardEvent = event as KeyboardEvent;
        select(Boolean(keyboardEvent.ctrlKey || keyboardEvent.metaKey));
      }
    });

    tbody.appendChild(row);
  }
}

function renderPreview(state: AppState): void {
  const panel = document.getElementById("preview-panel");
  if (!panel) return;

  const tab = getActiveTab(state);
  const selectedEntry = tab ? getPrimarySelectedEntry(tab) : null;

  if (!tab || isTabEmpty(tab)) {
    panel.innerHTML = `
      <div class="preview-card">
        <p class="preview-kicker">Preview</p>
        <h2>Nothing selected yet</h2>
        <p class="preview-copy">Open an archive and select a file to inspect it here.</p>
      </div>
    `;
    return;
  }

  if (!selectedEntry) {
    panel.innerHTML = `
      <div class="preview-card">
        <p class="preview-kicker">Preview</p>
        <h2>Select a file</h2>
        <p class="preview-copy">Preview opens for the first selected archive entry.</p>
      </div>
    `;
    return;
  }

  if (!tab.archive) {
    panel.innerHTML = `
      <div class="preview-card">
        <p class="preview-kicker">Staged ZIP</p>
        <h2>${escapeHtml(selectedEntry.name)}</h2>
        <p class="preview-copy">Preview is available for opened archives. Staged files will be written into a ZIP when you create it.</p>
      </div>
    `;
    return;
  }

  if (tab.preview.status === "loading") {
    panel.innerHTML = `
      <div class="preview-card">
        <p class="preview-kicker">Preview</p>
        <h2>${escapeHtml(selectedEntry.name)}</h2>
        <p class="preview-copy">Loading preview…</p>
      </div>
    `;
    return;
  }

  if (tab.preview.status === "error") {
    panel.innerHTML = `
      <div class="preview-card">
        <p class="preview-kicker">Preview</p>
        <h2>${escapeHtml(selectedEntry.name)}</h2>
        <p class="preview-copy">${escapeHtml(tab.preview.error ?? "Preview failed.")}</p>
      </div>
    `;
    return;
  }

  const result = tab.preview.result;
  const imageSource = previewImageSource(result);
  const meta = `${formatBytes(selectedEntry.size)} · ${humanizeKind(selectedEntry.kind)} · ${
    selectedEntry.path
  }`;

  let body = `<p class="preview-copy">Preview unavailable.</p>`;

  if (result?.kind === "text") {
    body = `<pre class="preview-code">${escapeHtml(result.text ?? "")}</pre>`;
  } else if (result?.kind === "image" && imageSource) {
    body = `<img class="preview-image" src="${imageSource}" alt="${escapeHtml(selectedEntry.name)} preview" />`;
  } else if (result?.kind === "binary") {
    body = `<pre class="preview-code preview-hex">${escapeHtml(
      binaryPreviewAsHex(result.dataBase64),
    )}</pre>`;
  } else if (result?.kind === "unsupported") {
    body = `<p class="preview-copy">${escapeHtml(result.message ?? "This entry cannot be previewed.")}</p>`;
  }

  panel.innerHTML = `
    <div class="preview-card">
      <p class="preview-kicker">Preview</p>
      <h2>${escapeHtml(selectedEntry.name)}</h2>
      <p class="preview-meta">${escapeHtml(meta)}</p>
      <div class="preview-body">${body}</div>
      ${
        result?.message && result.kind !== "unsupported"
          ? `<p class="preview-footnote">${escapeHtml(result.message)}</p>`
          : ""
      }
    </div>
  `;
}

export function renderApp(state: AppState, handlers: RenderHandlers): void {
  const status = document.getElementById("status-text");
  if (status) {
    status.textContent = state.statusText;
  }

  renderTopBar(state);
  renderTabs(state, handlers);
  renderHero(state);
  renderSummary(state);
  renderTree(state, handlers);
  renderFileTable(state, handlers);
  renderPreview(state);
}
