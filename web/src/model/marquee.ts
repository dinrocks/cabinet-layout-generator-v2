/**
 * Bulk selection helpers (pure, tested) — the answer to "shift+click ×100":
 *
 *  - marqueeSelect: rubber-band selection with the CAD window/crossing rule —
 *    drag left→right selects only what's FULLY inside; right→left selects
 *    anything the box TOUCHES (GstarCAD/AutoCAD muscle memory).
 *  - selectRow: everything sharing the anchor's DIN-rail line (one click grabs
 *    the whole run: elements, sets, and their text labels).
 *
 * Both pick up devices + labels only — wire ducts are deliberately excluded so a
 * sweep never accidentally drags the row frame.
 */
import type { LayoutModel, Library } from "./types";
import { rotatedFootprint } from "./geometry";
import { libItemSize } from "./resolve";
import { railOffsetWithinFootprint, SNAP_RAIL_MM } from "./align";
import { groupLayout } from "./sets";
import { anchorHost } from "./edit";

export type SelKind = "element" | "group" | "label";
export interface Sel {
  id: string;
  kind: SelKind;
}

interface BBox { x: number; y: number; w: number; h: number }

/** Approximate footprint boxes for every selectable device/label (no ducts). */
function selectableBoxes(model: LayoutModel, library: Library): Array<Sel & { box: BBox }> {
  const out: Array<Sel & { box: BBox }> = [];
  for (const e of model.elements) {
    const item = library[e.lib_key];
    if (!item) continue;
    const f = rotatedFootprint(libItemSize(item), e.rot_deg);
    out.push({ id: e.id, kind: "element", box: { x: e.x_mm, y: e.y_mm, w: f.w, h: f.h } });
  }
  for (const g of model.groups) {
    const layout = groupLayout(g, library);
    if (!layout) continue;
    out.push({ id: g.id, kind: "group", box: layout.bbox });
  }
  for (const l of model.labels) {
    const host = anchorHost(model, l.anchor);
    if (!host) continue;
    // labels are 10mm text; ~0.62 em/char matches the renderers' width estimate
    out.push({
      id: l.id, kind: "label",
      box: { x: host.x_mm + l.dx_mm, y: host.y_mm + l.dy_mm, w: Math.max(4, l.text.length * 10 * 0.62), h: 10 },
    });
  }
  return out;
}

const contains = (a: BBox, b: BBox) =>
  a.x <= b.x && a.y <= b.y && a.x + a.w >= b.x + b.w && a.y + a.h >= b.y + b.h;
const intersects = (a: BBox, b: BBox) =>
  a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;

/**
 * Select by rubber-band from drag start (x1,y1) to end (x2,y2), in mm.
 * Direction decides the rule: x2 ≥ x1 → "window" (fully inside), else
 * "crossing" (touching counts).
 */
export function marqueeSelect(
  model: LayoutModel, library: Library,
  x1: number, y1: number, x2: number, y2: number,
): Sel[] {
  const mode: "window" | "crossing" = x2 >= x1 ? "window" : "crossing";
  const box: BBox = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
  return selectableBoxes(model, library)
    .filter((s) => (mode === "window" ? contains(box, s.box) : intersects(box, s.box)))
    .map(({ id, kind }) => ({ id, kind }));
}

/**
 * Everything sharing the anchor's DIN-rail line (within SNAP_RAIL_MM), plus the
 * labels anchored to any selected host — i.e. "the whole row" in one click.
 */
export function selectRow(model: LayoutModel, library: Library, anchor: Sel): Sel[] {
  let railY: number | null = null;
  if (anchor.kind === "element") {
    const el = model.elements.find((e) => e.id === anchor.id);
    const item = el && library[el.lib_key];
    if (el && item) railY = el.y_mm + railOffsetWithinFootprint(item, el.rot_deg);
  } else if (anchor.kind === "group") {
    const g = model.groups.find((x) => x.id === anchor.id);
    const layout = g && groupLayout(g, library);
    if (layout) railY = layout.railY;
  }
  if (railY === null) return [anchor];

  const inBand = (y: number) => Math.abs(y - railY!) <= SNAP_RAIL_MM;
  const out: Sel[] = [];
  for (const e of model.elements) {
    const item = library[e.lib_key];
    if (item && inBand(e.y_mm + railOffsetWithinFootprint(item, e.rot_deg))) out.push({ id: e.id, kind: "element" });
  }
  for (const g of model.groups) {
    const layout = groupLayout(g, library);
    if (layout && inBand(layout.railY)) out.push({ id: g.id, kind: "group" });
  }
  const hostIds = new Set(out.map((s) => s.id));
  for (const l of model.labels) {
    const ref = l.anchor.split(":")[1];
    if (hostIds.has(ref)) out.push({ id: l.id, kind: "label" });
  }
  return out;
}
