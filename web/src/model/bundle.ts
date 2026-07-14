/**
 * Portable-bundle manifest (pure): which equipment DXFs a layout actually needs.
 *
 * The bundle (Phase 3, CLAUDE.md §5/§6 "free + portable") is a ZIP of the layout
 * JSON envelope plus the raw DXF of every PLACED uploaded part — elements, set
 * members and set caps — so nothing about the drawing is trapped in a cloud
 * bucket. Rect/custom/label parts carry no CAD file and need no entry.
 */
import type { LayoutModel, Library } from "./types";

export interface BundlePart {
  lib_key: string;
  name: string;
  block_ref: string;
}

/** Every placed DXF-backed part, deduped by lib_key (stable placement order). */
export function bundleParts(model: LayoutModel, library: Library): BundlePart[] {
  const keys: string[] = [
    ...model.elements.map((e) => e.lib_key),
    ...model.groups.flatMap((g) => [g.lib_key, g.cap_start_key, g.cap_end_key]),
  ].filter((k): k is string => !!k);

  const out: BundlePart[] = [];
  const seen = new Set<string>();
  for (const k of keys) {
    if (seen.has(k)) continue;
    seen.add(k);
    const item = library[k];
    if (item && item.source === "dxf" && item.block_ref) {
      out.push({ lib_key: k, name: item.name || k, block_ref: item.block_ref });
    }
  }
  return out;
}

/** ZIP-safe file name for a part's DXF ("parts/<name>.dxf"). */
export function partFileName(p: BundlePart): string {
  const safe = (p.name || p.lib_key).replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || p.lib_key;
  return `parts/${safe}.dxf`;
}
