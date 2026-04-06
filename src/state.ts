import type {
  AppState,
  ArchiveCapabilities,
  ArchiveEntry,
  CapsuleTab,
  OpenArchiveResult,
  PreviewState,
  SettingsState,
} from "./types";
import { basename, normalizePath } from "./utils";

const SETTINGS_KEY = "capsule-settings-v3";

const STAGED_CAPABILITIES: ArchiveCapabilities = {
  canPreview: false,
  canExtractAll: false,
  canExtractSelected: false,
  canAddFiles: true,
  canRemoveFiles: true,
  canSaveAsZip: true,
  readOnly: false,
  readOnlyReason: null,
};

const EMPTY_PREVIEW: PreviewState = {
  status: "idle",
  entryPath: null,
  result: null,
  error: null,
};

const DEFAULT_SETTINGS: SettingsState = {
  theme: "light",
  rememberExtractionPath: false,
  extractionPath: null,
  logging: false,
};

export function loadSettings(): SettingsState {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<SettingsState>;
    return {
      theme: parsed.theme === "dark" ? "dark" : "light",
      rememberExtractionPath: parsed.rememberExtractionPath ?? false,
      extractionPath: parsed.extractionPath ?? null,
      logging: parsed.logging ?? false,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: SettingsState): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function stagedCapabilities(): ArchiveCapabilities {
  return { ...STAGED_CAPABILITIES };
}

function emptyPreview(): PreviewState {
  return { ...EMPTY_PREVIEW };
}

export function createEmptyTab(id: number): CapsuleTab {
  return {
    id,
    title: "New ZIP",
    archive: null,
    entries: [],
    capabilities: stagedCapabilities(),
    isDirty: false,
    selectedPaths: [],
    searchQuery: "",
    folderFilter: null,
    expandedFolders: new Set<string>(),
    preview: emptyPreview(),
  };
}

export function createInitialState(): AppState {
  const firstTab = createEmptyTab(1);
  return {
    tabs: [firstTab],
    activeTabId: firstTab.id,
    nextTabId: 2,
    settings: loadSettings(),
    statusText: "Open an archive to explore it instantly, or stage files to build a ZIP.",
    isBusy: false,
    isDragActive: false,
    isSettingsOpen: false,
    isAboutOpen: false,
    previewRequestKey: 0,
  };
}

export function getActiveTab(state: AppState): CapsuleTab | null {
  return state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
}

export function isTabEmpty(tab: CapsuleTab): boolean {
  return !tab.archive && tab.entries.length === 0 && !tab.isDirty;
}

export function addEmptyTab(state: AppState, makeActive = true): CapsuleTab {
  const tab = createEmptyTab(state.nextTabId++);
  state.tabs.push(tab);
  if (makeActive) {
    state.activeTabId = tab.id;
  }
  return tab;
}

export function selectTab(state: AppState, id: number): void {
  state.activeTabId = id;
}

export function closeTab(state: AppState, id: number): void {
  const currentIndex = state.tabs.findIndex((tab) => tab.id === id);
  if (currentIndex === -1) return;

  const removed = state.tabs[currentIndex];
  state.tabs.splice(currentIndex, 1);

  if (state.tabs.length === 0) {
    const replacement = createEmptyTab(state.nextTabId++);
    state.tabs.push(replacement);
    state.activeTabId = replacement.id;
    return;
  }

  if (state.activeTabId === removed.id) {
    const fallback = state.tabs[currentIndex] ?? state.tabs[currentIndex - 1];
    state.activeTabId = fallback?.id ?? state.tabs[0].id;
  }
}

function stagedEntryFromPath(path: string): ArchiveEntry {
  return {
    name: basename(path),
    path,
    kind: "file",
    size: 0,
    compressedSize: null,
    modified: null,
    isEncrypted: false,
  };
}

export function stagePaths(tab: CapsuleTab, paths: string[]): void {
  const newEntries = paths.map(stagedEntryFromPath);
  tab.archive = null;
  tab.capabilities = stagedCapabilities();
  tab.entries = [...tab.entries, ...newEntries];
  tab.isDirty = tab.entries.length > 0;
  tab.selectedPaths = [];
  tab.folderFilter = null;
  tab.searchQuery = "";
  tab.expandedFolders = new Set<string>();
  tab.preview = emptyPreview();
}

export function applyArchiveResult(tab: CapsuleTab, result: OpenArchiveResult): void {
  tab.title = result.archive.name;
  tab.archive = result.archive;
  tab.entries = result.entries;
  tab.capabilities = { ...result.capabilities };
  tab.isDirty = false;
  tab.selectedPaths = [];
  tab.searchQuery = "";
  tab.folderFilter = null;
  tab.expandedFolders = new Set<string>();
  tab.preview = emptyPreview();
}

export function getFilteredEntries(tab: CapsuleTab): ArchiveEntry[] {
  let entries = [...tab.entries];

  if (tab.folderFilter) {
    const folder = normalizePath(tab.folderFilter);
    entries = entries.filter((entry) => {
      const path = normalizePath(entry.path);
      return path === folder || path.startsWith(`${folder}/`);
    });
  }

  const query = tab.searchQuery.trim().toLowerCase();
  if (!query) return entries;

  if (query.includes("*")) {
    const escaped = query.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    const pattern = new RegExp(`^${escaped}$`);
    return entries.filter((entry) => {
      const haystacks = [entry.name.toLowerCase(), normalizePath(entry.path).toLowerCase()];
      return haystacks.some((value) => pattern.test(value));
    });
  }

  return entries.filter((entry) => {
    const haystacks = [entry.name.toLowerCase(), normalizePath(entry.path).toLowerCase()];
    return haystacks.some((value) => value.includes(query));
  });
}

export function toggleSelectedPath(tab: CapsuleTab, path: string, append: boolean): void {
  if (!append) {
    tab.selectedPaths = [path];
    return;
  }

  const set = new Set(tab.selectedPaths);
  if (set.has(path)) {
    set.delete(path);
  } else {
    set.add(path);
  }
  tab.selectedPaths = Array.from(set);
}

export function clearSelection(tab: CapsuleTab): void {
  tab.selectedPaths = [];
}

export function getPrimarySelectedEntry(tab: CapsuleTab): ArchiveEntry | null {
  const [firstSelected] = tab.selectedPaths;
  if (!firstSelected) return null;
  return tab.entries.find((entry) => entry.path === firstSelected) ?? null;
}

export function setFolderFilter(tab: CapsuleTab, path: string | null): void {
  tab.folderFilter = path;
}

export function toggleExpandedFolder(tab: CapsuleTab, path: string): void {
  if (tab.expandedFolders.has(path)) {
    tab.expandedFolders.delete(path);
  } else {
    tab.expandedFolders.add(path);
  }
}

export function setSearchQuery(tab: CapsuleTab, query: string): void {
  tab.searchQuery = query;
}

export function setPreviewState(tab: CapsuleTab, preview: PreviewState): void {
  tab.preview = preview;
}

export function resetPreview(tab: CapsuleTab): void {
  tab.preview = emptyPreview();
}
