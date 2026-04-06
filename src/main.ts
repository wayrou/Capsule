import "./style.css";

import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";

import {
  addFilesToZip,
  createZipArchive,
  extractArchive,
  extractSelectedEntries,
  openArchive as openArchiveCommand,
  previewArchiveEntry,
  removeFilesFromZip,
} from "./archive-actions";
import { hydrateAboutDialog, readSelectedTheme, syncDialogVisibility, syncSettingsDialog } from "./dialogs";
import { renderApp } from "./render";
import {
  addEmptyTab,
  applyArchiveResult,
  clearSelection,
  closeTab,
  createInitialState,
  getActiveTab,
  getPrimarySelectedEntry,
  isTabEmpty,
  resetPreview,
  saveSettings,
  selectTab,
  setFolderFilter,
  setPreviewState,
  setSearchQuery,
  stagePaths,
  toggleExpandedFolder,
  toggleSelectedPath,
} from "./state";
import type { CapsuleTab, ThemeName } from "./types";
import { isArchivePath } from "./utils";

const state = createInitialState();
let isStartupComplete = false;

function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function log(...args: unknown[]): void {
  if (state.settings.logging) {
    console.log("[Capsule]", ...args);
  }
}

function applyTheme(theme: ThemeName): void {
  document.documentElement.setAttribute("data-theme", theme);
  document.body.classList.remove("theme-light", "theme-dark");
  document.body.classList.add(`theme-${theme}`);
}

function rerender(): void {
  renderApp(state, {
    onSelectTab: (id) => {
      selectTab(state, id);
      rerender();
      void refreshPreviewForActiveSelection();
    },
    onCloseTab: (id) => {
      closeTab(state, id);
      rerender();
      void refreshPreviewForActiveSelection();
    },
    onAddTab: () => {
      addEmptyTab(state, true);
      rerender();
    },
    onSelectRow: (path, append) => {
      const tab = getActiveTab(state);
      if (!tab) return;
      toggleSelectedPath(tab, path, append);
      rerender();
      void refreshPreviewForActiveSelection();
    },
    onSelectTreeFile: (path) => {
      const tab = getActiveTab(state);
      if (!tab) return;
      toggleSelectedPath(tab, path, false);
      rerender();
      void refreshPreviewForActiveSelection();
    },
    onToggleFolder: (path) => {
      const tab = getActiveTab(state);
      if (!tab) return;
      if (tab.folderFilter === path) {
        setFolderFilter(tab, null);
      } else {
        if (!tab.expandedFolders.has(path)) {
          toggleExpandedFolder(tab, path);
        }
        setFolderFilter(tab, path);
      }
      rerender();
    },
    onClearFolderFilter: () => {
      const tab = getActiveTab(state);
      if (!tab) return;
      setFolderFilter(tab, null);
      rerender();
    },
  });
  syncSettingsDialog(state.settings);
  syncDialogVisibility(state.isSettingsOpen, state.isAboutOpen);
}

function setStatus(text: string): void {
  state.statusText = text;
  rerender();
}

function writableStagingTab(): CapsuleTab {
  const active = getActiveTab(state);
  if (!active) {
    return addEmptyTab(state, true);
  }
  if (!active.archive) {
    return active;
  }
  return addEmptyTab(state, true);
}

async function resolveExtractionDestination(): Promise<string | null> {
  if (state.settings.rememberExtractionPath && state.settings.extractionPath) {
    return state.settings.extractionPath;
  }

  const chosen = await openDialog({
    directory: true,
    multiple: false,
    defaultPath: state.settings.extractionPath ?? undefined,
  });

  if (!chosen || typeof chosen !== "string") {
    return null;
  }

  state.settings.extractionPath = chosen;
  saveSettings(state.settings);
  return chosen;
}

async function refreshPreviewForActiveSelection(): Promise<void> {
  const tab = getActiveTab(state);
  if (!tab) return;

  const selectedEntry = getPrimarySelectedEntry(tab);
  if (!tab.archive || !selectedEntry || !tab.capabilities.canPreview) {
    resetPreview(tab);
    rerender();
    return;
  }

  const requestKey = ++state.previewRequestKey;
  setPreviewState(tab, {
    status: "loading",
    entryPath: selectedEntry.path,
    result: null,
    error: null,
  });
  rerender();

  try {
    const result = await previewArchiveEntry(tab.archive.path, selectedEntry.path);
    const active = getActiveTab(state);
    if (!active || active.id !== tab.id || requestKey !== state.previewRequestKey) {
      return;
    }

    setPreviewState(active, {
      status: "ready",
      entryPath: selectedEntry.path,
      result,
      error: null,
    });
  } catch (error) {
    const active = getActiveTab(state);
    if (!active || active.id !== tab.id || requestKey !== state.previewRequestKey) {
      return;
    }

    setPreviewState(active, {
      status: "error",
      entryPath: selectedEntry.path,
      result: null,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  rerender();
}

async function openArchiveAtPath(path: string): Promise<void> {
  let tab = getActiveTab(state);
  if (!tab || !isTabEmpty(tab)) {
    tab = addEmptyTab(state, true);
  }

  state.isBusy = true;
  setStatus(`Opening ${path.split(/[\\/]/).pop() ?? "archive"}…`);

  try {
    const result = await openArchiveCommand(path);
    applyArchiveResult(tab, result);
    state.statusText = `${result.archive.name} opened.`;
    log("Opened archive", result.archive.path);
  } catch (error) {
    state.statusText = error instanceof Error ? error.message : String(error);
  } finally {
    state.isBusy = false;
    rerender();
  }

  await refreshPreviewForActiveSelection();
}

async function reopenArchive(tab: CapsuleTab): Promise<void> {
  if (!tab.archive) return;
  const result = await openArchiveCommand(tab.archive.path);
  applyArchiveResult(tab, result);
}

async function handleOpenArchivePicker(): Promise<void> {
  const selected = await openDialog({ multiple: false, directory: false });
  if (!selected || typeof selected !== "string") return;
  await openArchiveAtPath(selected);
}

async function handleAddFiles(): Promise<void> {
  const selected = await openDialog({ multiple: true, directory: false });
  if (!selected) return;
  const paths = Array.isArray(selected) ? selected : [selected];
  if (!paths.length) return;

  const active = getActiveTab(state);
  if (active?.archive && active.capabilities.canAddFiles) {
    state.isBusy = true;
    setStatus(`Adding ${paths.length} file${paths.length === 1 ? "" : "s"} to ${active.archive.name}…`);

    try {
      await addFilesToZip(active.archive.path, paths);
      await reopenArchive(active);
      state.statusText = "Files added to ZIP archive.";
      clearSelection(active);
    } catch (error) {
      state.statusText = error instanceof Error ? error.message : String(error);
    } finally {
      state.isBusy = false;
      rerender();
    }

    await refreshPreviewForActiveSelection();
    return;
  }

  const stagingTab = writableStagingTab();
  stagePaths(stagingTab, paths);
  state.statusText = `${paths.length} item${paths.length === 1 ? "" : "s"} staged for ZIP creation.`;
  rerender();
}

async function handleCreateZip(): Promise<void> {
  const tab = getActiveTab(state);
  if (!tab || tab.archive || tab.entries.length === 0) return;

  const defaultPath = `${tab.title || "capsule"}.zip`;
  const destination = await saveDialog({
    defaultPath,
    filters: [{ name: "ZIP archive", extensions: ["zip"] }],
  });

  if (!destination || typeof destination !== "string") return;

  state.isBusy = true;
  setStatus(`Creating ${destination.split(/[\\/]/).pop() ?? "ZIP"}…`);

  try {
    await createZipArchive(
      destination,
      tab.entries.map((entry) => entry.path),
    );
    const result = await openArchiveCommand(destination);
    applyArchiveResult(tab, result);
    state.statusText = `${result.archive.name} created.`;
  } catch (error) {
    state.statusText = error instanceof Error ? error.message : String(error);
  } finally {
    state.isBusy = false;
    rerender();
  }

  await refreshPreviewForActiveSelection();
}

async function handleExtractAll(): Promise<void> {
  const tab = getActiveTab(state);
  if (!tab?.archive) return;

  const destination = await resolveExtractionDestination();
  if (!destination) {
    setStatus("Extraction cancelled.");
    return;
  }

  state.isBusy = true;
  setStatus(`Extracting ${tab.archive.name}…`);

  try {
    const result = await extractArchive(tab.archive.path, destination);
    state.statusText = `Extracted ${result.extractedEntries} item${result.extractedEntries === 1 ? "" : "s"} to ${destination}.`;
  } catch (error) {
    state.statusText = error instanceof Error ? error.message : String(error);
  } finally {
    state.isBusy = false;
    rerender();
  }
}

async function handleExtractSelected(): Promise<void> {
  const tab = getActiveTab(state);
  if (!tab?.archive || tab.selectedPaths.length === 0) return;

  const destination = await resolveExtractionDestination();
  if (!destination) {
    setStatus("Extraction cancelled.");
    return;
  }

  state.isBusy = true;
  setStatus(`Extracting ${tab.selectedPaths.length} selected item${tab.selectedPaths.length === 1 ? "" : "s"}…`);

  try {
    const result = await extractSelectedEntries(tab.archive.path, destination, tab.selectedPaths);
    state.statusText = `Extracted ${result.extractedEntries} item${result.extractedEntries === 1 ? "" : "s"} to ${destination}.`;
  } catch (error) {
    state.statusText = error instanceof Error ? error.message : String(error);
  } finally {
    state.isBusy = false;
    rerender();
  }
}

async function handleRemoveSelected(): Promise<void> {
  const tab = getActiveTab(state);
  if (!tab || tab.selectedPaths.length === 0) return;

  if (tab.archive) {
    if (!tab.capabilities.canRemoveFiles) return;

    state.isBusy = true;
    setStatus(`Removing ${tab.selectedPaths.length} selected item${tab.selectedPaths.length === 1 ? "" : "s"}…`);

    try {
      await removeFilesFromZip(tab.archive.path, tab.selectedPaths);
      await reopenArchive(tab);
      state.statusText = "Selected ZIP entries removed.";
    } catch (error) {
      state.statusText = error instanceof Error ? error.message : String(error);
    } finally {
      state.isBusy = false;
      rerender();
    }

    await refreshPreviewForActiveSelection();
    return;
  }

  const selected = new Set(tab.selectedPaths);
  tab.entries = tab.entries.filter((entry) => !selected.has(entry.path));
  tab.selectedPaths = [];
  tab.isDirty = tab.entries.length > 0;
  state.statusText = "Removed selected staged files.";
  rerender();
}

function openSettings(): void {
  state.isAboutOpen = false;
  state.isSettingsOpen = true;
  rerender();
}

function closeSettings(): void {
  state.isSettingsOpen = false;
  rerender();
}

function openAbout(): void {
  state.isSettingsOpen = false;
  state.isAboutOpen = true;
  rerender();
}

function closeAbout(): void {
  state.isAboutOpen = false;
  rerender();
}

function bindStaticEvents(): void {
  $("btn-open-archive")?.addEventListener("click", () => void handleOpenArchivePicker());
  $("btn-open-hero")?.addEventListener("click", () => void handleOpenArchivePicker());
  $("btn-add-files")?.addEventListener("click", () => void handleAddFiles());
  $("btn-save-archive")?.addEventListener("click", () => void handleCreateZip());
  $("btn-extract-all")?.addEventListener("click", () => void handleExtractAll());
  $("btn-extract-selected")?.addEventListener("click", () => void handleExtractSelected());
  $("btn-remove-selected")?.addEventListener("click", () => void handleRemoveSelected());
  $("btn-settings")?.addEventListener("click", openSettings);
  $("btn-settings-close")?.addEventListener("click", closeSettings);
  $("btn-about")?.addEventListener("click", openAbout);
  $("btn-about-close")?.addEventListener("click", closeAbout);
  $("btn-about-dismiss")?.addEventListener("click", closeAbout);

  $("settings-dialog")?.addEventListener("click", (event) => {
    if (event.target === $("settings-dialog")) {
      closeSettings();
    }
  });

  $("about-dialog")?.addEventListener("click", (event) => {
    if (event.target === $("about-dialog")) {
      closeAbout();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (state.isAboutOpen) {
      closeAbout();
      return;
    }
    if (state.isSettingsOpen) {
      closeSettings();
    }
  });

  const searchInput = $("search-input") as HTMLInputElement | null;
  searchInput?.addEventListener("input", (event) => {
    const tab = getActiveTab(state);
    if (!tab) return;
    const target = event.target as HTMLInputElement;
    setSearchQuery(tab, target.value);
    rerender();
  });
  searchInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const tab = getActiveTab(state);
    if (!tab) return;
    setSearchQuery(tab, "");
    rerender();
  });

  $("theme-light")?.addEventListener("change", () => {
    state.settings.theme = readSelectedTheme();
    applyTheme(state.settings.theme);
    saveSettings(state.settings);
    rerender();
  });
  $("theme-dark")?.addEventListener("change", () => {
    state.settings.theme = readSelectedTheme();
    applyTheme(state.settings.theme);
    saveSettings(state.settings);
    rerender();
  });

  const rememberPathToggle = $("remember-extraction-path") as HTMLInputElement | null;
  rememberPathToggle?.addEventListener("change", () => {
    state.settings.rememberExtractionPath = rememberPathToggle.checked;
    saveSettings(state.settings);
    rerender();
  });

  const loggingToggle = $("logging-toggle") as HTMLInputElement | null;
  loggingToggle?.addEventListener("change", () => {
    state.settings.logging = loggingToggle.checked;
    saveSettings(state.settings);
    rerender();
  });

  $("btn-choose-extraction-path")?.addEventListener("click", async () => {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      defaultPath: state.settings.extractionPath ?? undefined,
    });
    if (!selected || typeof selected !== "string") return;
    state.settings.extractionPath = selected;
    saveSettings(state.settings);
    rerender();
  });
}

function initMenuListeners(): void {
  listen("menu://file-open", () => {
    void handleOpenArchivePicker();
  }).catch(() => {});

  listen("menu://file-save", () => {
    void handleCreateZip();
  }).catch(() => {});

  listen("menu://file-extract", () => {
    void handleExtractAll();
  }).catch(() => {});

  listen("menu://file-close-tab", () => {
    const active = getActiveTab(state);
    if (!active) return;
    closeTab(state, active.id);
    rerender();
    void refreshPreviewForActiveSelection();
  }).catch(() => {});

  listen("menu://edit-add-files", () => {
    void handleAddFiles();
  }).catch(() => {});

  listen("menu://edit-remove-files", () => {
    void handleRemoveSelected();
  }).catch(() => {});

  listen("menu://help-about", () => {
    if (!isStartupComplete) return;
    openAbout();
  }).catch(() => {});

  listen("tauri://menu", (event) => {
    const payload = event.payload as { id?: string } | null;
    switch (payload?.id) {
      case "file-open":
        void handleOpenArchivePicker();
        break;
      case "file-save":
        void handleCreateZip();
        break;
      case "file-extract":
        void handleExtractAll();
        break;
      case "file-close-tab": {
        const active = getActiveTab(state);
        if (!active) return;
        closeTab(state, active.id);
        rerender();
        void refreshPreviewForActiveSelection();
        break;
      }
      case "edit-add-files":
        void handleAddFiles();
        break;
      case "edit-remove-files":
        void handleRemoveSelected();
        break;
      case "help-about":
        if (!isStartupComplete) return;
        openAbout();
        break;
      default:
        break;
    }
  }).catch(() => {});
}

function initDragAndDrop(): void {
  const hero = $("hero-panel");
  hero?.addEventListener("dragenter", (event) => {
    event.preventDefault();
  });
  hero?.addEventListener("dragover", (event) => {
    event.preventDefault();
  });
  hero?.addEventListener("dragleave", (event) => {
    event.preventDefault();
  });
  hero?.addEventListener("drop", (event) => {
    event.preventDefault();
  });

  const webview = getCurrentWebview();
  webview.onDragDropEvent(async (event) => {
    switch (event.payload.type) {
      case "enter":
      case "over":
        state.isDragActive = true;
        rerender();
        break;
      case "leave":
        state.isDragActive = false;
        rerender();
        break;
      case "drop": {
        state.isDragActive = false;
        rerender();

        const paths = event.payload.paths ?? [];
        if (!paths.length) return;

        const archives = paths.filter(isArchivePath);
        const nonArchives = paths.filter((path) => !isArchivePath(path));

        if (archives.length === paths.length) {
          for (const archivePath of archives) {
            await openArchiveAtPath(archivePath);
          }
          return;
        }

        if (nonArchives.length) {
          const active = getActiveTab(state);
          if (active?.archive && active.capabilities.canAddFiles) {
            state.isBusy = true;
            setStatus(`Adding ${nonArchives.length} dropped item${nonArchives.length === 1 ? "" : "s"}…`);
            try {
              await addFilesToZip(active.archive.path, nonArchives);
              await reopenArchive(active);
              state.statusText = "Dropped files added to ZIP archive.";
            } catch (error) {
              state.statusText = error instanceof Error ? error.message : String(error);
            } finally {
              state.isBusy = false;
              rerender();
            }
            await refreshPreviewForActiveSelection();
            return;
          }

          const stagingTab = writableStagingTab();
          stagePaths(stagingTab, nonArchives);
          state.statusText = `${nonArchives.length} dropped item${nonArchives.length === 1 ? "" : "s"} staged for ZIP creation.`;
          rerender();
        }
        break;
      }
      default:
        break;
    }
  });
}

async function initTauriListeners(): Promise<void> {
  await listen<string>("open-with://file", (event) => {
    if (event.payload) {
      void openArchiveAtPath(event.payload);
    }
  }).catch(() => {});
}

document.addEventListener("DOMContentLoaded", async () => {
  applyTheme(state.settings.theme);
  bindStaticEvents();
  initMenuListeners();
  initDragAndDrop();
  await initTauriListeners();
  await hydrateAboutDialog();
  rerender();
  isStartupComplete = true;
});
