import { getName, getVersion } from "@tauri-apps/api/app";
import type { SettingsState, ThemeName } from "./types";

function setDialogState(id: string, open: boolean): void {
  const dialog = document.getElementById(id);
  if (!dialog) return;
  dialog.hidden = !open;
  dialog.setAttribute("aria-hidden", open ? "false" : "true");
  (dialog as HTMLElement).style.display = open ? "grid" : "none";
  dialog.classList.toggle("open", open);
}

export function syncDialogVisibility(settingsOpen: boolean, aboutOpen: boolean): void {
  setDialogState("settings-dialog", settingsOpen);
  setDialogState("about-dialog", aboutOpen);
}

export function syncSettingsDialog(settings: SettingsState): void {
  const themeLight = document.getElementById("theme-light") as HTMLInputElement | null;
  const themeDark = document.getElementById("theme-dark") as HTMLInputElement | null;
  const rememberPath =
    document.getElementById("remember-extraction-path") as HTMLInputElement | null;
  const loggingToggle = document.getElementById("logging-toggle") as HTMLInputElement | null;
  const pathLabel = document.getElementById("settings-extraction-path");

  if (themeLight) themeLight.checked = settings.theme === "light";
  if (themeDark) themeDark.checked = settings.theme === "dark";
  if (rememberPath) rememberPath.checked = settings.rememberExtractionPath;
  if (loggingToggle) loggingToggle.checked = settings.logging;
  if (pathLabel) {
    pathLabel.textContent = settings.extractionPath ?? "No folder selected";
  }
}

export function readSelectedTheme(): ThemeName {
  const themeDark = document.getElementById("theme-dark") as HTMLInputElement | null;
  return themeDark?.checked ? "dark" : "light";
}

export async function hydrateAboutDialog(): Promise<void> {
  const nameNode = document.getElementById("about-app-name");
  const versionNode = document.getElementById("about-app-version");

  try {
    const [name, version] = await Promise.all([getName(), getVersion()]);
    if (nameNode) nameNode.textContent = name;
    if (versionNode) versionNode.textContent = `Version ${version}`;
  } catch {
    if (nameNode) nameNode.textContent = "Capsule";
    if (versionNode) versionNode.textContent = "Desktop archive utility";
  }
}
