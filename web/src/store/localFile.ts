/**
 * Local layout file I/O — the always-available fallback (offline, or anti-lock-in
 * export). Saves an envelope { model, library } so custom/uploaded parts round-trip
 * too; tolerates a bare model file. The caller still runs the model through
 * validate() (against the merged library) before using it.
 */
import { SEED_LIBRARY } from "../model/library";
import type { LayoutModel, Library } from "../model/types";

const SCHEMA = "clg.layout.v1";

interface Envelope {
  schema: string;
  model: LayoutModel;
  library: Library; // non-seed items only
}

function nonSeed(library: Library): Library {
  return Object.fromEntries(Object.entries(library).filter(([k]) => !(k in SEED_LIBRARY)));
}

export function downloadLayout(model: LayoutModel, library: Library): void {
  const env: Envelope = { schema: SCHEMA, model, library: nonSeed(library) };
  const blob = new Blob([JSON.stringify(env, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safe = (model.project.name || "layout").replace(/[^\w.-]+/g, "_");
  a.href = url;
  a.download = `${safe}.layout.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Open a file picker → { model, library } (or null on cancel / parse error). */
export function pickLayoutFile(): Promise<{ model: LayoutModel; library: Library } | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(String(reader.result)) as Partial<Envelope> & LayoutModel;
          if (parsed && parsed.schema === SCHEMA && parsed.model) {
            resolve({ model: parsed.model, library: parsed.library ?? {} });
          } else {
            // tolerate a bare model file
            resolve({ model: parsed as unknown as LayoutModel, library: {} });
          }
        } catch {
          resolve(null);
        }
      };
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    };
    input.click();
  });
}
