export type ArchiveEntryKind = "file" | "dir" | "symlink" | "other";
export type ThemeName = "light" | "dark";

export type ArchiveEntry = {
  name: string;
  path: string;
  kind: ArchiveEntryKind;
  size: number;
  compressedSize: number | null;
  modified: string | null;
  isEncrypted: boolean;
};

export type ArchiveSummary = {
  path: string;
  name: string;
  format: string;
  compressedSize: number;
  totalEntries: number;
  totalSize: number;
  encryptedEntries: number;
};

export type ArchiveCapabilities = {
  canPreview: boolean;
  canExtractAll: boolean;
  canExtractSelected: boolean;
  canAddFiles: boolean;
  canRemoveFiles: boolean;
  canSaveAsZip: boolean;
  readOnly: boolean;
  readOnlyReason: string | null;
};

export type OpenArchiveResult = {
  archive: ArchiveSummary;
  entries: ArchiveEntry[];
  capabilities: ArchiveCapabilities;
};

export type PreviewKind = "text" | "image" | "binary" | "unsupported";

export type PreviewResult = {
  kind: PreviewKind;
  mime: string;
  text: string | null;
  dataBase64: string | null;
  size: number;
  truncated: boolean;
  message: string | null;
};

export type ExtractionResult = {
  extractedEntries: number;
};

export type PreviewState = {
  status: "idle" | "loading" | "ready" | "error";
  entryPath: string | null;
  result: PreviewResult | null;
  error: string | null;
};

export type SettingsState = {
  theme: ThemeName;
  rememberExtractionPath: boolean;
  extractionPath: string | null;
  logging: boolean;
};

export type CapsuleTab = {
  id: number;
  title: string;
  archive: ArchiveSummary | null;
  entries: ArchiveEntry[];
  capabilities: ArchiveCapabilities;
  isDirty: boolean;
  selectedPaths: string[];
  searchQuery: string;
  folderFilter: string | null;
  expandedFolders: Set<string>;
  preview: PreviewState;
};

export type AppState = {
  tabs: CapsuleTab[];
  activeTabId: number | null;
  nextTabId: number;
  settings: SettingsState;
  statusText: string;
  isBusy: boolean;
  isDragActive: boolean;
  isSettingsOpen: boolean;
  isAboutOpen: boolean;
  previewRequestKey: number;
};
