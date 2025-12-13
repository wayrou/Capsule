// Capsule v1.0 – Main Entry
// --------------------------------
// - Tab bar
// - Toolbar (Browse, Add, Extract, Save, Remove, Settings)
// - Tree view with expand/collapse + icons + folder navigation
// - Settings overlay (themes + logging + crash toggle + custom folder)
// - About overlay wired to Help → About menu
// - Drag & drop + OS "open with..." handler

import "./style.css";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { listen } from "@tauri-apps/api/event";
import { getVersion, getName } from "@tauri-apps/api/app";

// ----------------------------------------------------------
// TYPES
// ----------------------------------------------------------

type CapsuleEntry = {
  name: string;
  size: number;
  type: string;
  path: string;
  modified?: string;
};

type CapsuleTab = {
  id: number;
  title: string;
  path: string | null;
  entries: CapsuleEntry[];
  isDirty: boolean;
};

type ThemeName = "light" | "dark" | "night" | "north";

type SettingsState = {
  theme: ThemeName;
  parallelCompression: boolean;
  logging: boolean;
  crashReports: boolean;
  customFolderEnabled: boolean;
  customFolderPath: string | null;
};

type TreeNode = {
  name: string;
  children: Map<string, TreeNode>;
  files: CapsuleEntry[];
};

// ----------------------------------------------------------
// GLOBAL STATE
// ----------------------------------------------------------

let tabs: CapsuleTab[] = [];
let activeTabId: number | null = null;
let nextTabId = 1;

let selectedEntryPaths: string[] = [];
let isExtracting = false;

const SETTINGS_KEY = "capsule-settings-v2";

// Current tree-folder selection used to filter file list.
// Example: "folder/subfolder" or null for "show everything".
let currentFolderFilter: string | null = null;

// Current search query for filtering files
let currentSearchQuery: string = "";

let settings: SettingsState = {
  theme: "light",
  parallelCompression: true,
  logging: false,
  crashReports: false,
  customFolderEnabled: false,
  customFolderPath: null,
};

// About overlay refs
let aboutOverlayEl: HTMLDivElement | null = null;
let aboutCloseBtn: HTMLButtonElement | null = null;
let aboutOkBtn: HTMLButtonElement | null = null;

// ----------------------------------------------------------
// UTILITIES
// ----------------------------------------------------------

function $(selector: string): HTMLElement | null {
  return document.querySelector(selector);
}

function setStatus(text: string) {
  const status = $("#status-text");
  if (status) status.textContent = text;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function log(...args: any[]) {
  if (settings.logging) {
    console.log("[Capsule]", ...args);
  }
}

// ----------------------------------------------------------
// SETTINGS / THEME / CRASH REPORTING
// ----------------------------------------------------------

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<SettingsState>;
    settings = {
      theme: (parsed.theme as ThemeName) ?? "light",
      parallelCompression: parsed.parallelCompression ?? true,
      logging: parsed.logging ?? false,
      crashReports: parsed.crashReports ?? false,
      customFolderEnabled: parsed.customFolderEnabled ?? false,
      customFolderPath: parsed.customFolderPath ?? null,
    };
  } catch {
    // ignore
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

function applyTheme(theme: ThemeName) {
  settings.theme = theme;

  document.documentElement.setAttribute("data-theme", theme);
  document.body.classList.remove("theme-light", "theme-dark", "theme-night", "theme-north");
  document.body.classList.add(`theme-${theme}`);

  // Theme-specific class on status text (16d)
  const statusText = document.getElementById("status-text");
  if (statusText) {
    statusText.classList.remove(
      "status-light",
      "status-dark",
      "status-night",
      "status-north",
    );
    statusText.classList.add(`status-${theme}`);
  }

  saveSettings();
}

function initCrashReporting() {
  window.addEventListener("error", (e) => {
    if (!settings.crashReports) return;
    const msg = e.error?.toString?.() ?? e.message ?? "Unknown error";
    log("Crash captured:", msg);
    try {
      invoke("report_crash", { message: msg }).catch(() => {});
    } catch {
      // ignore
    }
  });
}

function initSettingsPanel() {
  const overlay = document.getElementById("settings-overlay");
  const btnSettings = document.getElementById("btn-settings");
  const btnClose = document.getElementById("btn-settings-close");

  if (!overlay) return;

  const open = () => overlay.classList.add("open");
  const close = () => overlay.classList.remove("open");

  btnSettings?.addEventListener("click", open);
  btnClose?.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  // Theme radios
  const themeLight = document.getElementById("theme-light") as HTMLInputElement | null;
  const themeDark = document.getElementById("theme-dark") as HTMLInputElement | null;
  const themeNight = document.getElementById("theme-night") as HTMLInputElement | null;
  const themeNorth = document.getElementById("theme-north") as HTMLInputElement | null;

  if (themeLight) {
    themeLight.checked = settings.theme === "light";
    themeLight.addEventListener("change", () => {
      if (themeLight.checked) applyTheme("light");
    });
  }

  if (themeDark) {
    themeDark.checked = settings.theme === "dark";
    themeDark.addEventListener("change", () => {
      if (themeDark.checked) applyTheme("dark");
    });
  }

  if (themeNight) {
    themeNight.checked = settings.theme === "night";
    themeNight.addEventListener("change", () => {
      if (themeNight.checked) applyTheme("night");
    });
  }

  if (themeNorth) {
    themeNorth.checked = settings.theme === "north";
    themeNorth.addEventListener("change", () => {
      if (themeNorth.checked) applyTheme("north");
    });
  }

  // Logging & crash toggles
  const loggingToggle = document.getElementById("logging-toggle") as HTMLInputElement | null;
  const crashToggle = document.getElementById("crash-toggle") as HTMLInputElement | null;

  if (loggingToggle) {
    loggingToggle.checked = settings.logging;
    loggingToggle.addEventListener("change", () => {
      settings.logging = loggingToggle.checked;
      saveSettings();
    });
  }

  if (crashToggle) {
    crashToggle.checked = settings.crashReports;
    crashToggle.addEventListener("change", () => {
      settings.crashReports = crashToggle.checked;
      saveSettings();
    });
  }

  // Custom folder toggle + button (16f)
  const customFolderToggle =
    (document.getElementById("toggle-custom-folder") as HTMLInputElement | null) ||
    (document.getElementById("use-custom-folder") as HTMLInputElement | null);

  const customFolderPathEl =
    document.getElementById("custom-folder-path") ||
    document.getElementById("custom-folder-label");

  const customFolderChooseBtn =
    (document.getElementById("btn-custom-folder-choose") as HTMLButtonElement | null) ||
    (document.getElementById("custom-folder-choose") as HTMLButtonElement | null);

  if (customFolderToggle) {
    customFolderToggle.checked = settings.customFolderEnabled;
    customFolderToggle.addEventListener("change", () => {
      settings.customFolderEnabled = customFolderToggle.checked;
      saveSettings();
    });
  }

  if (customFolderPathEl && settings.customFolderPath) {
    customFolderPathEl.textContent = settings.customFolderPath;
  }

  if (customFolderChooseBtn) {
    customFolderChooseBtn.addEventListener("click", async () => {
      console.log("[Capsule] Custom folder choose clicked");
      const selected = await openDialog({ directory: true, multiple: false });
      if (!selected || typeof selected !== "string") return;
      settings.customFolderPath = selected;
      saveSettings();
      if (customFolderPathEl) {
        customFolderPathEl.textContent = selected;
      }
    });
  }
}

// ----------------------------------------------------------
// TABS
// ----------------------------------------------------------

function getActiveTab(): CapsuleTab | null {
  return tabs.find((t) => t.id === activeTabId) ?? null;
}

function isTabEmpty(tab: CapsuleTab): boolean {
  return !tab.path && tab.entries.length === 0 && !tab.isDirty;
}

function createEmptyTab(): CapsuleTab {
  return {
    id: nextTabId++,
    title: "New Archive",
    path: null,
    entries: [],
    isDirty: false,
  };
}

function addNewTab(makeActive = true): CapsuleTab {
  const tab = createEmptyTab();
  tabs.push(tab);
  if (makeActive) activeTabId = tab.id;
  renderTabs();
  renderActiveTab().catch(console.error);
  return tab;
}

function closeTab(id: number) {
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx === -1) return;

  const wasActive = tabs[idx].id === activeTabId;
  tabs.splice(idx, 1);

  if (tabs.length === 0) {
    const newTab = createEmptyTab();
    tabs.push(newTab);
    activeTabId = newTab.id;
  } else if (wasActive) {
    const fallback = tabs[idx] ?? tabs[idx - 1];
    if (fallback) activeTabId = fallback.id;
  }

  renderTabs();
  renderActiveTab().catch(console.error);
}

function renderTabs() {
  const tabBar = $("#tab-bar");
  if (!tabBar) return;

  (tabBar as HTMLElement).innerHTML = "";

  for (const tab of tabs) {
    const tabEl = document.createElement("div");
    tabEl.className = "tab" + (tab.id === activeTabId ? " active" : "");

    const titleSpan = document.createElement("span");
    titleSpan.className = "tab-title";
    titleSpan.textContent = `📦 ${tab.title}`;

    const closeBtn = document.createElement("button");
    closeBtn.className = "tab-close";
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      closeTab(tab.id);
    });

    tabEl.addEventListener("click", () => {
      if (activeTabId !== tab.id) {
        activeTabId = tab.id;
        renderTabs();
        renderActiveTab();
      }
    });

    tabEl.appendChild(titleSpan);
    tabEl.appendChild(closeBtn);
    tabBar.appendChild(tabEl);
  }

  const addBtn = document.createElement("button");
  addBtn.className = "tab-add";
  addBtn.textContent = "+";
  addBtn.addEventListener("click", () => addNewTab(true));
  tabBar.appendChild(addBtn);
}

// ----------------------------------------------------------
// TREE VIEW
// ----------------------------------------------------------

function buildTreeFromEntries(entries: CapsuleEntry[]): TreeNode {
  const root: TreeNode = {
    name: "",
    children: new Map(),
    files: [],
  };

  for (const entry of entries) {
    const fullPath = (entry.path || entry.name || "")
      .replace(/\\/g, "/")
      .replace(/^\/+/, ""); // normalize leading slashes

    const parts = fullPath.split("/").filter(Boolean);

    if (parts.length <= 1) {
      root.files.push(entry);
      continue;
    }

    const folderParts = parts.slice(0, -1);
    let node = root;

    for (const rawPart of folderParts) {
      // Drop bogus segments so you don't see "/" as a folder name
      const part = rawPart.trim();
      if (!part || part === "/") continue;

      if (!node.children.has(part)) {
        node.children.set(part, {
          name: part,
          children: new Map(),
          files: [],
        });
      }
      node = node.children.get(part)!;
    }

    node.files.push(entry);
  }

  return root;
}

function renderTreeFromEntries(entries: CapsuleEntry[]) {
  const treeRoot = document.getElementById("tree-view") as HTMLUListElement | null;
  if (!treeRoot) {
    console.warn("[Capsule] Tree root not found in DOM");
    return;
  }

  treeRoot.innerHTML = "";

  if (!entries.length) {
    const li = document.createElement("li");
    li.className = "tree-empty";
    li.textContent = "Open an archive to see its structure";
    treeRoot.appendChild(li);
    return;
  }

  const tree = buildTreeFromEntries(entries);

  const renderNode = (node: TreeNode, container: HTMLUListElement, basePath: string) => {
    const folderNames = Array.from(node.children.keys()).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );

    for (const folderName of folderNames) {
      const child = node.children.get(folderName)!;
      const li = document.createElement("li");
      li.className = "tree-folder";

      const chevron = document.createElement("span");
      chevron.textContent = "▸";
      chevron.style.fontSize = "0.7rem";
      chevron.style.opacity = "0.7";

      const iconSpan = document.createElement("span");
      iconSpan.className = "tree-folder-icon";
      iconSpan.textContent = "📁";

      const labelSpan = document.createElement("span");
      labelSpan.className = "tree-folder-label";
      labelSpan.textContent = folderName;

      const header = document.createElement("div");
      header.style.display = "flex";
      header.style.alignItems = "center";
      header.style.gap = "4px";
      header.append(chevron, iconSpan, labelSpan);

      const nested = document.createElement("ul");
      nested.className = "tree-view-nested tree-collapsed";

      const fullFolderPath = basePath ? `${basePath}/${folderName}` : folderName;
      (header as any).dataset.path = fullFolderPath;

      header.addEventListener("click", () => {
        // Toggle expand/collapse visuals
        const isCollapsed = nested.classList.contains("tree-collapsed");
        nested.classList.toggle("tree-collapsed", !isCollapsed);
        nested.classList.toggle("tree-expanded", isCollapsed);
        chevron.textContent = isCollapsed ? "▾" : "▸";

        // Folder navigation: clicking sets/clears the current folder filter
        if (currentFolderFilter === fullFolderPath) {
          currentFolderFilter = null;
          header.classList.remove("tree-folder-active");
        } else {
          currentFolderFilter = fullFolderPath;
          document
            .querySelectorAll(".tree-folder-active")
            .forEach((el) => el.classList.remove("tree-folder-active"));
          header.classList.add("tree-folder-active");
        }

        console.log("[Capsule] Folder clicked:", fullFolderPath, "filter =", currentFolderFilter);
        renderActiveTab().catch(console.error);
      });

      li.appendChild(header);
      li.appendChild(nested);
      container.appendChild(li);

      renderNode(child, nested, fullFolderPath);
    }

    const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of files) {
      const li = document.createElement("li");
      li.className = "tree-file";

      const iconSpan = document.createElement("span");
      iconSpan.className = "tree-file-icon";
      iconSpan.textContent = "📄";

      const labelSpan = document.createElement("span");
      labelSpan.className = "tree-file-label";
      labelSpan.textContent = entry.name;

      li.append(iconSpan, labelSpan);

      const filePath = (entry.path || entry.name || "").replace(/\\/g, "/");
      (li as any).dataset.path = filePath;

      li.addEventListener("click", () => {
        const selector = `.file-row[data-path="${CSS.escape(filePath)}"]`;
        const row = document.querySelector<HTMLTableRowElement>(selector);
        if (row) {
          row.scrollIntoView({ block: "nearest" });
          row.click();
        }
      });

      container.appendChild(li);
    }
  };

  renderNode(tree, treeRoot, "");
}

// ----------------------------------------------------------
// FILE LIST + PREVIEW
// ----------------------------------------------------------

function getSelectedEntries(): CapsuleEntry[] {
  const tab = getActiveTab();
  if (!tab) return [];
  const selectedSet = new Set(selectedEntryPaths);
  return tab.entries.filter((e) => selectedSet.has(e.path));
}

async function updatePreviewForSelection() {
  const tab = getActiveTab();
  if (!tab || !tab.path) return;

  const previewTitle = document.getElementById("preview-title");
  const previewMeta = document.getElementById("preview-meta");
  const previewBody = document.getElementById("preview-body");
  const previewMessage = document.getElementById("preview-message");
  const previewText = document.getElementById("preview-text");
  const previewImage = document.getElementById("preview-image") as HTMLImageElement | null;
  const previewHex = document.getElementById("preview-hex");

  if (!previewTitle || !previewMeta || !previewBody) return;

  const first = getSelectedEntries()[0];

  if (!first) {
    previewTitle.textContent = "No file selected";
    previewMeta.textContent = "";
    if (previewMessage) {
      previewMessage.textContent = "Select a file from the list to see details.";
      previewMessage.hidden = false;
    }
    if (previewText) previewText.hidden = true;
    if (previewImage) previewImage.hidden = true;
    if (previewHex) previewHex.hidden = true;
    return;
  }

  previewTitle.textContent = first.name;
  previewMeta.textContent = `${formatBytes(first.size)} • ${first.type} • ${first.path}`;

  // Hide all preview types initially
  if (previewMessage) previewMessage.hidden = true;
  if (previewText) previewText.hidden = true;
  if (previewImage) previewImage.hidden = true;
  if (previewHex) previewHex.hidden = true;

  // Skip directories
  if (first.type === "dir") {
    if (previewMessage) {
      previewMessage.textContent = "Directory selected. Use the tree view to navigate.";
      previewMessage.hidden = false;
    }
    return;
  }

  // Skip if file is too large (preview limit: 10MB)
  if (first.size > 10 * 1024 * 1024) {
    if (previewMessage) {
      previewMessage.textContent = `File too large to preview (${formatBytes(first.size)}). Maximum preview size: 10MB.`;
      previewMessage.hidden = false;
    }
    return;
  }

  try {
    const result = await invoke("preview_archive_entry", {
      archivePath: tab.path,
      entryPath: first.path,
    }) as any;

    if (result.kind === "text") {
      // Text preview
      if (previewText) {
        previewText.textContent = result.text || "";
        previewText.hidden = false;
        
        // Simple syntax highlighting based on file extension
        const ext = first.name.split(".").pop()?.toLowerCase() || "";
        previewText.className = "preview-text";
        if (["js", "ts", "jsx", "tsx"].includes(ext)) {
          previewText.classList.add("syntax-js");
        } else if (["json"].includes(ext)) {
          previewText.classList.add("syntax-json");
        } else if (["xml", "html", "svg"].includes(ext)) {
          previewText.classList.add("syntax-xml");
        } else if (["md", "markdown"].includes(ext)) {
          previewText.classList.add("syntax-markdown");
        } else if (["css"].includes(ext)) {
          previewText.classList.add("syntax-css");
        } else if (["py"].includes(ext)) {
          previewText.classList.add("syntax-python");
        } else if (["rs"].includes(ext)) {
          previewText.classList.add("syntax-rust");
        } else if (["sh", "bash"].includes(ext)) {
          previewText.classList.add("syntax-shell");
        }
      }
    } else if (result.kind === "binary") {
      // Check if it's an image based on mime type or extension
      const ext = first.name.split(".").pop()?.toLowerCase() || "";
      const imageExts = ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "ico"];
      
      if (imageExts.includes(ext) && result.data_base64 && previewImage) {
        previewImage.src = `data:image/${ext === "svg" ? "svg+xml" : ext};base64,${result.data_base64}`;
        previewImage.hidden = false;
      } else if (previewHex && result.data_base64) {
        // Hex preview for binaries
        const binaryData = atob(result.data_base64);
        let hexLines = "";
        for (let i = 0; i < Math.min(binaryData.length, 1024); i += 16) {
          const chunk = binaryData.slice(i, i + 16);
          const hex = Array.from(chunk)
            .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
            .join(" ");
          const ascii = Array.from(chunk)
            .map((c) => {
              const code = c.charCodeAt(0);
              return code >= 32 && code < 127 ? c : ".";
            })
            .join("");
          hexLines += `${i.toString(16).padStart(8, "0")}: ${hex.padEnd(48)} ${ascii}\n`;
        }
        previewHex.textContent = hexLines;
        previewHex.hidden = false;
      } else {
        if (previewMessage) {
          previewMessage.textContent = "Binary file (not previewable).";
          previewMessage.hidden = false;
        }
      }
    }
  } catch (err) {
    console.error("Preview error:", err);
    if (previewMessage) {
      previewMessage.textContent = `Preview failed: ${err instanceof Error ? err.message : String(err)}`;
      previewMessage.hidden = false;
    }
  }
}

async function renderActiveTab() {
  const tab = getActiveTab();
  const tbody = document.querySelector<HTMLTableSectionElement>("#file-list-body");
  const currentName = $("#current-archive-name");
  const statEntries = $("#stat-entries");
  const statSize = $("#stat-size");
  const statType = $("#stat-type");

  if (!tbody || !currentName) return;

  tbody.innerHTML = "";

  if (!tab || tab.entries.length === 0) {
    (currentName as HTMLElement).textContent = "New Archive";

    if (statEntries) statEntries.textContent = "0";
    if (statSize) statSize.textContent = "0 B";
    if (statType) statType.textContent = "—";

    renderTreeFromEntries([]);

    const tr = document.createElement("tr");
    tr.className = "file-list-empty";
    tr.innerHTML = `
      <td colspan="5">
        Drop files or click “Browse…” to begin.
      </td>
    `;
    tbody.appendChild(tr);

    selectedEntryPaths = [];
    updatePreviewForSelection();
    return;
  }

  (currentName as HTMLElement).textContent = tab.title;

  // Apply folder filter
  let visibleEntries = currentFolderFilter
    ? tab.entries.filter((e) => {
        const p = (e.path || e.name || "")
          .replace(/\\/g, "/")
          .replace(/^\/+/, "");
        const folder = currentFolderFilter!;
        return p === folder || p.startsWith(folder + "/");
      })
    : tab.entries;

  // Apply search filter
  if (currentSearchQuery.trim()) {
    const query = currentSearchQuery.toLowerCase().trim();
    visibleEntries = visibleEntries.filter((e) => {
      const name = (e.name || "").toLowerCase();
      const path = (e.path || "").toLowerCase();
      // Support glob-like patterns: * for wildcard
      if (query.includes("*")) {
        const pattern = query.replace(/\*/g, ".*");
        const regex = new RegExp(`^${pattern}$`);
        return regex.test(name) || regex.test(path);
      }
      return name.includes(query) || path.includes(query);
    });
  }

  console.log(
    "[Capsule] renderActiveTab: total entries",
    tab.entries.length,
    "visible",
    visibleEntries.length,
    "filter",
    currentFolderFilter,
  );

  if (statEntries) statEntries.textContent = String(visibleEntries.length);
  const totalSize = visibleEntries.reduce((sum, e) => sum + (e.size || 0), 0);
  if (statSize) statSize.textContent = formatBytes(totalSize);
  if (statType) {
    statType.textContent = tab.path?.split(".").pop()?.toUpperCase() ?? "Unknown";
  }

  // Calculate archive metadata
  const statCompressed = document.getElementById("stat-compressed");
  const statSaved = document.getElementById("stat-saved");
  
  if (tab.path && statCompressed && statSaved) {
    // Try to get archive file size
    try {
      const archiveSize = await invoke<number>("get_file_size", { path: tab.path }).catch(() => null);
      if (archiveSize !== null && archiveSize > 0) {
        statCompressed.textContent = formatBytes(archiveSize);
        const ratio = totalSize > 0 ? (1 - archiveSize / totalSize) * 100 : 0;
        statSaved.textContent = ratio > 0 ? `${ratio.toFixed(1)}%` : "—";
      } else {
        statCompressed.textContent = "—";
        statSaved.textContent = "—";
      }
    } catch {
      statCompressed.textContent = "—";
      statSaved.textContent = "—";
    }
  } else {
    if (statCompressed) statCompressed.textContent = "—";
    if (statSaved) statSaved.textContent = "—";
  }

  for (const entry of visibleEntries) {
    const tr = document.createElement("tr");
    tr.className = "file-row";

    const filePath = (entry.path || entry.name || "").replace(/\\/g, "/");
    (tr as any).dataset.path = filePath;

    tr.innerHTML = `
      <td>${entry.name}</td>
      <td>${formatBytes(entry.size)}</td>
      <td>${entry.type}</td>
      <td>${entry.modified ?? ""}</td>
      <td>${entry.path}</td>
    `;

    if (selectedEntryPaths.includes(entry.path)) {
      tr.classList.add("file-selected");
    }

    tr.addEventListener("click", () => {
      selectedEntryPaths = [entry.path];
      document.querySelectorAll<HTMLTableRowElement>("tr.file-row").forEach((row) => {
        const rowPath = (row as any).dataset.path;
        row.classList.toggle("file-selected", rowPath === filePath);
      });
      updatePreviewForSelection();
    });

    // Context menu for extraction
    tr.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      selectedEntryPaths = [entry.path];
      document.querySelectorAll<HTMLTableRowElement>("tr.file-row").forEach((row) => {
        const rowPath = (row as any).dataset.path;
        row.classList.toggle("file-selected", rowPath === filePath);
      });
      showContextMenu(e.clientX, e.clientY, entry);
    });

    tbody.appendChild(tr);
  }

  renderTreeFromEntries(tab.entries);
  updatePreviewForSelection();
}

// ----------------------------------------------------------
// BACKEND HELPERS (OPEN, EXTRACT, ADD, SAVE, REMOVE)
// ----------------------------------------------------------

async function openArchiveAtPath(path: string) {
  let tab = getActiveTab();
  if (!tab || !isTabEmpty(tab)) {
    tab = addNewTab(true);
  }

  try {
    setStatus("Opening archive…");
    log("Opening archive", path);

    const result = await invoke("open_archive", { path });
    const entries = Array.isArray(result)
      ? (result as CapsuleEntry[])
      : ((result as any).entries ?? []);

    tab.path = path;
    tab.entries = entries;
    tab.isDirty = false;
    tab.title = path.split(/[\\/]/).pop() || "Archive";

    currentFolderFilter = null;

    renderTabs();
    await renderActiveTab();
    setStatus("Archive opened");
  } catch (err) {
    console.error(err);
    setStatus("Failed to open archive");
  }
}

async function handleBrowse() {
  log("Browse clicked");
  const selected = await openDialog({ multiple: false, directory: false });
  if (!selected || typeof selected !== "string") return;
  await openArchiveAtPath(selected);
}

async function handleExtract() {
  const tab = getActiveTab();
  if (!tab?.path) {
    setStatus("No archive to extract");
    return;
  }
  if (isExtracting) return;

  isExtracting = true;
  try {
    let dest: string | null = null;

    if (settings.customFolderEnabled && settings.customFolderPath) {
      dest = settings.customFolderPath;
    } else {
      const chosen = await openDialog({ directory: true, multiple: false });
      if (!chosen || typeof chosen !== "string") {
        setStatus("Extraction cancelled");
        return;
      }
      dest = chosen;
    }

    setStatus("Extracting…");
    await invoke("extract_archive", { path: tab.path, dest });
    setStatus("Extraction complete");
  } catch (err) {
    console.error(err);
    setStatus("Extraction failed");
  } finally {
    isExtracting = false;
  }
}

async function handleAddFiles() {
  const tab = getActiveTab();
  if (!tab) {
    setStatus("No active tab");
    return;
  }

  const selected = await openDialog({ multiple: true, directory: false });
  if (!selected) return;
  const files = Array.isArray(selected) ? selected : [selected];
  if (!files.length) return;

  if (tab.path) {
    setStatus("Adding files…");
    await invoke("add_files_to_zip", { args: { zip: tab.path, files } });
    await openArchiveAtPath(tab.path);
    setStatus("Files added");
    return;
  }

  const newEntries = files.map((fullPath) => {
    const name = fullPath.split(/[\\/]/).pop() || fullPath;
    const entry: CapsuleEntry = {
      name,
      size: 0,
      type: "file",
      path: fullPath,
      modified: "",
    };
    return entry;
  });

  tab.entries = [...tab.entries, ...newEntries];
  tab.isDirty = true;
  await renderActiveTab();
  setStatus("Files staged – use Save to create archive");
}

async function handleSaveAsZip() {
  const tab = getActiveTab();
  if (!tab) {
    setStatus("Nothing to save");
    return;
  }

  const inputPaths = tab.entries.map((e) => e.path);
  if (!inputPaths.length) {
    setStatus("Nothing to save");
    return;
  }

  const baseTitle = tab.title.replace(/\.[^.]+$/, "") || "archive";
  const suggested = tab.path || baseTitle + ".zip";

  const dest = await saveDialog({
    defaultPath: suggested,
    filters: [{ name: "ZIP archive", extensions: ["zip"] }],
  });

  if (!dest || typeof dest !== "string") {
    setStatus("Save cancelled");
    return;
  }

  setStatus("Creating archive…");
  log("Creating ZIP", dest, inputPaths);

  await invoke("create_zip_archive", {
    args: {
      outputPath: dest,
      inputPaths,
      compressionMode: "balanced",
      parallelCompression: settings.parallelCompression,
      tempDir: null,
    },
  });

  tab.path = dest;
  tab.isDirty = false;
  tab.title = dest.split(/[\\/]/).pop() || tab.title;
  renderTabs();
  setStatus("Archive saved");
}

async function handleRemoveFiles() {
  const tab = getActiveTab();
  if (!tab) {
    setStatus("No active tab");
    return;
  }

  const selected = getSelectedEntries();
  if (!selected.length) {
    setStatus("Select file(s) to remove");
    return;
  }

  if (!tab.path) {
    const selectedSet = new Set(selected.map((e) => e.path));
    tab.entries = tab.entries.filter((e) => !selectedSet.has(e.path));
    selectedEntryPaths = [];
    await renderActiveTab();
    setStatus("Removed from staged archive");
    return;
  }

  const names = Array.from(
    new Set([...selected.map((e) => e.name), ...selected.map((e) => e.path)]),
  );

  try {
    setStatus("Removing from archive…");
    await invoke("remove_files_from_zip", {
      args: {
        zipPath: tab.path,
        entryNames: names,
      },
    });

    selectedEntryPaths = [];
    await openArchiveAtPath(tab.path);
    setStatus("Removed selected entries");
  } catch (err) {
    console.error(err);
    setStatus("Failed to remove entries");
  }
}

// ----------------------------------------------------------
// DROPZONE + TAURI DRAG & DROP
// ----------------------------------------------------------

function initDropzoneAndDnd() {
  const dz = document.getElementById("dropzone");
  if (!dz) return;

  const highlight = () => dz.classList.add("dropzone-active");
  const unhighlight = () => dz.classList.remove("dropzone-active");

  ["dragenter", "dragover"].forEach((evt) => {
    dz.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      highlight();
    });
  });

  ["dragleave", "drop"].forEach((evt) => {
    dz.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      unhighlight();
    });
  });

  const webview = getCurrentWebview();

  webview.onDragDropEvent(async (event) => {
    const payload = event.payload;
    if (payload.type !== "drop") return;

    const paths = payload.paths ?? [];
    if (!paths.length) return;

    const isArchive = (p: string) => /\.(zip|7z|tar|gz|tgz|bz2|rar)$/i.test(p);

    const archives = paths.filter(isArchive);
    const nonArchives = paths.filter((p) => !isArchive(p));

    if (archives.length === 1 && nonArchives.length === 0) {
      await openArchiveAtPath(archives[0]);
      return;
    }

    let tab = getActiveTab();
    if (!tab) {
      tab = addNewTab(true);
    }

    const newEntries = paths.map((fullPath) => {
      const name = fullPath.split(/[\\/]/).pop() || fullPath;
      const entry: CapsuleEntry = {
        name,
        size: 0,
        type: "file",
        path: fullPath,
        modified: "",
      };
      return entry;
    });

    tab.entries = [...tab.entries, ...newEntries];
    tab.isDirty = true;
    await renderActiveTab();
    setStatus("Files added from drag-and-drop");
  });
}

// ----------------------------------------------------------
// TOOLBAR
// ----------------------------------------------------------

function initToolbar() {
  const browseBtn = document.getElementById("btn-browse");
  const browseToolbarBtn = document.getElementById("btn-browse-toolbar");
  const addBtn = document.getElementById("btn-add-files");
  const extractBtn = document.getElementById("btn-extract");
  const saveBtn = document.getElementById("btn-save-archive");
  const removeBtn = document.getElementById("btn-remove-files");

  browseBtn?.addEventListener("click", () => {
    handleBrowse();
  });

  browseToolbarBtn?.addEventListener("click", () => {
    handleBrowse();
  });

  addBtn?.addEventListener("click", () => {
    handleAddFiles();
  });

  extractBtn?.addEventListener("click", () => {
    handleExtract();
  });

  saveBtn?.addEventListener("click", () => {
    handleSaveAsZip();
  });

  removeBtn?.addEventListener("click", () => {
    handleRemoveFiles();
  });
}

// ----------------------------------------------------------
// ABOUT OVERLAY
// ----------------------------------------------------------

function openAboutOverlay() {
  if (!aboutOverlayEl) return;
  aboutOverlayEl.classList.add("open");
  log("About overlay opened");
}

async function initAboutOverlay() {
  aboutOverlayEl = document.getElementById("about-overlay") as HTMLDivElement | null;
  aboutCloseBtn = document.getElementById("about-close") as HTMLButtonElement | null;
  aboutOkBtn = document.getElementById("about-ok") as HTMLButtonElement | null;

  if (!aboutOverlayEl) {
    console.warn("[Capsule] #about-overlay not found in DOM");
    return;
  }

  const close = () => {
    if (!aboutOverlayEl) return;
    aboutOverlayEl.classList.remove("open");
  };

  aboutCloseBtn?.addEventListener("click", close);
  aboutOkBtn?.addEventListener("click", close);

  aboutOverlayEl.addEventListener("click", (e) => {
    if (e.target === aboutOverlayEl) close();
  });

  // 16e – ensure metadata shows up
  try {
    const [appName, appVersion] = await Promise.all([getName(), getVersion()]);
    const metaEl = document.getElementById("about-meta");
    if (metaEl) {
      metaEl.textContent = appName + " v" + appVersion;
    }
  } catch {
    // ignore metadata errors
  }

  console.log("[Capsule] About overlay initialized");
}

// ----------------------------------------------------------
// MENU BRIDGE + Tauri listeners
// ----------------------------------------------------------

function initMenuBridge() {
  console.log("[Capsule] initMenuBridge (stub)");
}

async function initTauriListeners() {
  await listen<string>("open-with://file", (event) => {
    const path = event.payload;
    if (!path) return;
    log("Open-with file from OS:", path);
    openArchiveAtPath(path);
  }).catch(() => {});
}

function initMenuListeners() {
  // Legacy custom events if you already emit them from Rust
  listen("menu://file-open", () => {
    handleBrowse();
  }).catch(() => {});

  listen("menu://file-save", () => {
    handleSaveAsZip();
  }).catch(() => {});

  listen("menu://file-extract", () => {
    handleExtract();
  }).catch(() => {});

  listen("menu://edit-add-files", () => {
    handleAddFiles();
  }).catch(() => {});

  listen("menu://edit-remove-files", () => {
    handleRemoveFiles();
  }).catch(() => {});

  listen("menu://help-about", () => {
    console.log("[Capsule] menu://help-about received");
    openAboutOverlay();
  }).catch(() => {});

  // Robust Tauri menu handler: listens to tauri://menu and checks ID
  listen("tauri://menu", (event) => {
    const payload: any = event.payload;
    const id = payload?.id as string | undefined;
    if (!id) return;

    switch (id) {
      case "file-open":
        handleBrowse();
        break;
      case "file-save":
        handleSaveAsZip();
        break;
      case "file-extract":
        handleExtract();
        break;
      case "edit-add-files":
        handleAddFiles();
        break;
      case "edit-remove-files":
        handleRemoveFiles();
        break;
      case "help-about":
      case "help-about-capsule":
        console.log("[Capsule] tauri://menu help-about received (id =", id, ")");
        openAboutOverlay();
        break;
      default:
        break;
    }
  }).catch(() => {});
}

// ----------------------------------------------------------
// DOM READY
// ----------------------------------------------------------

document.addEventListener("DOMContentLoaded", async () => {
  loadSettings();
  applyTheme(settings.theme);

  if (tabs.length === 0) {
    addNewTab(true);
  } else {
    renderTabs();
    renderActiveTab().catch(console.error);
  }

  initSettingsPanel();
  initCrashReporting();
  initToolbar();
  initDropzoneAndDnd();
  initMenuListeners();
  initMenuBridge();
  await initTauriListeners();
  await initAboutOverlay();
  initSearch();

  setStatus("Ready. Drop files or click Browse…");
});

// ----------------------------------------------------------
// CONTEXT MENU
// ----------------------------------------------------------

function showContextMenu(x: number, y: number, entry: CapsuleEntry) {
  const menu = document.getElementById("file-context-menu");
  if (!menu) return;

  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.hidden = false;

  const extractBtn = document.getElementById("ctx-extract-entry");
  if (extractBtn) {
    extractBtn.onclick = () => {
      extractSelectedEntries();
      menu.hidden = true;
    };
  }

  // Close menu when clicking outside
  const closeMenu = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) {
      menu.hidden = true;
      document.removeEventListener("click", closeMenu);
    }
  };
  setTimeout(() => document.addEventListener("click", closeMenu), 100);
}

async function extractSelectedEntries() {
  const tab = getActiveTab();
  if (!tab?.path) {
    setStatus("No archive to extract from");
    return;
  }

  const selected = getSelectedEntries();
  if (!selected.length) {
    setStatus("No files selected");
    return;
  }

  try {
    const dest = await openDialog({ directory: true, multiple: false });
    if (!dest || typeof dest !== "string") {
      setStatus("Extraction cancelled");
      return;
    }

    setStatus(`Extracting ${selected.length} file(s)…`);

    // Extract each selected entry
    for (const entry of selected) {
      try {
        const tempPath = await invoke("extract_archive_entry_to_temp", {
          archivePath: tab.path,
          entryPath: entry.path,
          tempDir: null,
        });

        // Copy from temp to destination
        const destPath = `${dest}/${entry.name}`;
        await invoke("copy_file", { src: tempPath, dest: destPath });
      } catch (err) {
        console.error(`Failed to extract ${entry.name}:`, err);
      }
    }

    setStatus(`Extracted ${selected.length} file(s) successfully`);
  } catch (err) {
    console.error("Extraction error:", err);
    setStatus("Extraction failed");
  }
}

// ----------------------------------------------------------
// SEARCH
// ----------------------------------------------------------

function initSearch() {
  const searchInput = document.getElementById("search-input") as HTMLInputElement | null;
  if (!searchInput) return;

  searchInput.addEventListener("input", (e) => {
    const target = e.target as HTMLInputElement;
    currentSearchQuery = target.value;
    renderActiveTab().catch(console.error);
  });

  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      searchInput.value = "";
      currentSearchQuery = "";
      renderActiveTab();
    }
  });
}
