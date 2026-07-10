/**
 * Thai-capable text for the PDF exports.
 *
 * jsPDF's built-in fonts (helvetica etc.) are Latin-only — a Thai project name or
 * title would come out garbled/blank in the PDF title block, and the engineer's
 * real titles ARE Thai. We bundle Sarabun (OFL — assets/Sarabun-OFL.txt), the
 * standard Thai document font (Thai + Latin), and register it on each jsPDF
 * instance. Arial stays the sheet DEFAULT (engineer's house font); only text runs
 * that actually contain Thai list "Sarabun" in their font-family (render/page.ts),
 * so svg2pdf switches to Sarabun for those and leaves everything else as Arial.
 * PNG/preview fall back to Arial + the OS Thai fonts (Sarabun isn't installed in the
 * browser) — visually close; the PDF is the shipped one.
 */
import fontUrl from "../assets/Sarabun-Regular.ttf?url";

/** The face name registered with jsPDF; listed in font-family only on Thai runs. */
export const PDF_FONT = "Sarabun";

interface FontHost {
  addFileToVFS(filename: string, data: string): void;
  addFont(postScriptName: string, id: string, fontStyle: string): void;
}

/** Register the Sarabun TTF (base64) on a jsPDF instance so svg2pdf can select it
 *  by font-family. Does NOT change the active font — Arial stays the default. Split
 *  out so tests can feed the file straight from disk without the fetch. */
export function registerThaiFont(pdf: FontHost, base64Ttf: string): void {
  pdf.addFileToVFS("Sarabun-Regular.ttf", base64Ttf);
  pdf.addFont("Sarabun-Regular.ttf", PDF_FONT, "normal");
}

let cached: string | null = null; // fetched + encoded once per session

async function fontBase64(): Promise<string> {
  if (cached) return cached;
  const bytes = new Uint8Array(await (await fetch(fontUrl)).arrayBuffer());
  let bin = "";
  const CHUNK = 0x8000; // String.fromCharCode arg-count limit
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  cached = btoa(bin);
  return cached;
}

/** Fetch the bundled font and register it; call once per jsPDF instance. */
export async function ensureThaiFont(pdf: FontHost): Promise<void> {
  registerThaiFont(pdf, await fontBase64());
}
