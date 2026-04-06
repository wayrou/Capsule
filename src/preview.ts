import type { PreviewResult } from "./types";

export function previewImageSource(result: PreviewResult | null): string | null {
  if (!result || result.kind !== "image" || !result.dataBase64) return null;
  return `data:${result.mime};base64,${result.dataBase64}`;
}

export function binaryPreviewAsHex(dataBase64: string | null): string {
  if (!dataBase64) return "";

  const raw = atob(dataBase64);
  let lines = "";

  for (let index = 0; index < raw.length; index += 16) {
    const chunk = raw.slice(index, index + 16);
    const hex = Array.from(chunk)
      .map((character) => character.charCodeAt(0).toString(16).padStart(2, "0"))
      .join(" ");
    const ascii = Array.from(chunk)
      .map((character) => {
        const code = character.charCodeAt(0);
        return code >= 32 && code <= 126 ? character : ".";
      })
      .join("");
    lines += `${index.toString(16).padStart(8, "0")}  ${hex.padEnd(47)}  ${ascii}\n`;
  }

  return lines.trimEnd();
}
