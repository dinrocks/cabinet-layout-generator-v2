/**
 * Insert a device INTO a row with automatic gap-making (pure, tested).
 *
 * The manual workflow this replaces: shift+click everything right of the spot
 * (painful with many slim parts), arrow-nudge the pack, then place the new part.
 * Here the user picks ONE easy anchor (element or set) and a side; the function
 * opens the gap by shifting everything downstream and drops the new part(s) in,
 * rail-aligned to the anchor.
 *
 * Rules (matching the brief's re-flow isolation + the editor's conventions):
 *  - "Same row" = rail line within SNAP_RAIL_MM of the anchor's (works with or
 *    without ducts). Sets shift as whole units; locked pairs share the delta
 *    because both mates sit in the band; labels follow their hosts (offsets).
 *  - side "right": inserts after the anchor; everything right of the anchor's
 *    right edge shifts. side "left": inserts at the anchor's position; the
 *    anchor itself and everything downstream shifts right. Upstream never moves.
 *  - `locked` entities keep their x (same rule as auto-pack); any resulting
 *    overlap is flagged by the overlap detector — warn-but-allow.
 */
import type { LayoutModel, Library } from "./types";
import { libItemSize } from "./resolve";
import { rotatedFootprint } from "./geometry";
import { railOffsetWithinFootprint, SNAP_RAIL_MM } from "./align";
import { groupLayout } from "./sets";
import { addElement, elementFootprint } from "./edit";

export interface InsertResult {
  model: LayoutModel;
  /** ids of the newly-inserted elements (first one is a good selection target) */
  ids: string[];
}

/** Insert `count` copies of `libKey` beside an element/set, shifting the row open. */
export function insertBeside(
  model: LayoutModel,
  library: Library,
  anchor: { kind: "element" | "group"; id: string },
  side: "left" | "right",
  libKey: string,
  count: number,
): InsertResult | null {
  const item = library[libKey];
  if (!item || count < 1) return null;

  // anchor geometry: left/right edges + the rail line to align on
  let aLeft: number, aRight: number, aRailY: number;
  if (anchor.kind === "element") {
    const el = model.elements.find((e) => e.id === anchor.id);
    const aItem = el && library[el.lib_key];
    if (!el || !aItem) return null;
    const f = elementFootprint(el, library);
    aLeft = el.x_mm;
    aRight = el.x_mm + f.w;
    aRailY = el.y_mm + railOffsetWithinFootprint(aItem, el.rot_deg);
  } else {
    const g = model.groups.find((x) => x.id === anchor.id);
    const layout = g && groupLayout(g, library);
    if (!g || !layout) return null;
    aLeft = g.x_mm;
    aRight = g.x_mm + layout.totalW;
    aRailY = layout.railY;
  }

  const gap = model.defaults.gap_between_equipment_mm;
  const size = libItemSize(item);
  const f = rotatedFootprint(size, 0);
  const insW = count * f.w + count * gap; // N parts + one gap joining them to the row
  const newY = +(aRailY - railOffsetWithinFootprint(item, 0)).toFixed(2);

  // side right: gap opens after the anchor; side left: at the anchor (anchor shifts too)
  const threshold = side === "right" ? aRight - 0.01 : aLeft - 0.01;
  const insX0 = side === "right" ? aRight + gap : aLeft;

  const inBand = (railY: number) => Math.abs(railY - aRailY) <= SNAP_RAIL_MM;
  const shifted: LayoutModel = {
    ...model,
    elements: model.elements.map((e) => {
      if (e.locked) return e; // honour locked, same as auto-pack
      const it = library[e.lib_key];
      if (!it) return e;
      const railY = e.y_mm + railOffsetWithinFootprint(it, e.rot_deg);
      return inBand(railY) && e.x_mm > threshold ? { ...e, x_mm: +(e.x_mm + insW).toFixed(2) } : e;
    }),
    groups: model.groups.map((g) => {
      const layout = groupLayout(g, library);
      if (!layout) return g;
      return inBand(layout.railY) && g.x_mm > threshold ? { ...g, x_mm: +(g.x_mm + insW).toFixed(2) } : g;
    }),
    // labels store offsets from their anchors, so they follow automatically
  };

  // drop the new part(s) into the opened gap, left to right
  let m = shifted;
  const ids: string[] = [];
  let x = insX0;
  for (let i = 0; i < count; i += 1) {
    const r = addElement(m, libKey, library, +x.toFixed(2), newY);
    m = r.model;
    ids.push(r.id);
    x += f.w + gap;
  }
  return { model: m, ids };
}
