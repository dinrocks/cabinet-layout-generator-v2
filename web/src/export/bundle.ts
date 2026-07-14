/**
 * Portable bundle export (Phase 3, CLAUDE.md §5/§6 "free + portable, every layer"):
 * one ZIP holding the layout JSON envelope (the same file ⬇/⬆ use) plus the raw
 * DXF of every placed uploaded part — so an engineer keeps a complete, offline,
 * vendor-free copy of the drawing even if a free tier disappears.
 *
 * The DXFs come from the ezdxf service block store (the browser never held them);
 * a missing block fails the bundle loudly rather than shipping an incomplete ZIP.
 */
import JSZip from "jszip";
import type { LayoutModel, Library } from "../model/types";
import { bundleParts, partFileName } from "../model/bundle";
import { layoutEnvelopeJson } from "../store/localFile";
import { fetchBlock } from "../service/dxfClient";

function readme(model: LayoutModel, n: number): string {
  return [
    `Cabinet Layout Generator — portable bundle`,
    `Project: ${model.project.name || "Untitled"}`,
    `Exported: ${new Date().toISOString()}`,
    ``,
    `layout.json   the full layout (open it in the editor via the ⬆ toolbar button)`,
    `parts/*.dxf   the ${n} uploaded equipment drawing${n === 1 ? "" : "s"} this layout places`,
    ``,
    `Nothing else is needed: re-upload the DXFs to rebuild the parts library anywhere.`,
  ].join("\n");
}

/** Build + download `<name>.bundle.zip`. Throws (via the caller's run()) on any
 *  missing block so the user never gets a silently-incomplete bundle. */
export async function downloadBundle(model: LayoutModel, library: Library): Promise<void> {
  const parts = bundleParts(model, library);
  const zip = new JSZip();
  zip.file("layout.json", layoutEnvelopeJson(model, library));
  zip.file("README.txt", readme(model, parts.length));
  // fetch sequentially — free-tier service; a bundle has a handful of parts
  for (const p of parts) {
    zip.file(partFileName(p), await fetchBlock(p.block_ref));
  }
  const blob = await zip.generateAsync({ type: "blob" });
  const safe = (model.project.name || "layout").replace(/[^\w.-]+/g, "_");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safe}.bundle.zip`;
  a.click();
  URL.revokeObjectURL(url);
}
