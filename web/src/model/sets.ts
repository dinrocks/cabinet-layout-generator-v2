/**
 * Set (group) layout — where each piece of a set sits: optional start cap,
 * the N members, optional end cap. Pure + testable; THE single source for the
 * editor canvas, the SVG renderer, rows/overlap math and explode. (The DXF
 * assembler mirrors this math in service/dxf_build.py — keep them in sync.)
 *
 * Caps are rail-aligned to the members: a cap whose height/rail offset differs
 * from the members still sits on the same DIN-rail line (the same rule the
 * editor uses for drag-snap alignment).
 */
import type { Group, Library } from "./types";
import { libItemSize } from "./resolve";
import { rotatedFootprint } from "./geometry";
import { railOffsetWithinFootprint } from "./align";

export interface GroupPiece {
  kind: "cap_start" | "member" | "cap_end";
  lib_key: string;
  /** member index (0-based) for auto-tag numbering; undefined for caps */
  index?: number;
  x_mm: number;
  y_mm: number;
  w: number;
  h: number;
}

export interface GroupLayout {
  pieces: GroupPiece[];
  /** total run width incl. caps + gaps (the set's footprint width) */
  totalW: number;
  /** bounding box over all pieces (caps may be taller/shorter than members) */
  bbox: { x: number; y: number; w: number; h: number };
  /** absolute y of the DIN-rail line the run is aligned on */
  railY: number;
}

/** Layout for a set; null when the member part is unresolved (validation flags it). */
export function groupLayout(g: Group, library: Library): GroupLayout | null {
  const item = library[g.lib_key];
  if (!item) return null;
  const f = rotatedFootprint(libItemSize(item), g.rot_deg);
  const memberRail = railOffsetWithinFootprint(item, g.rot_deg);
  const railY = g.y_mm + memberRail;
  const gap = g.internal_gap_mm;

  const pieces: GroupPiece[] = [];
  let x = g.x_mm;

  const pushCap = (key: string | null | undefined, kind: "cap_start" | "cap_end") => {
    const capItem = key ? library[key] : undefined;
    if (!key || !capItem) return; // unresolved cap keys are flagged by validate()
    const cf = rotatedFootprint(libItemSize(capItem), g.rot_deg);
    const capRail = railOffsetWithinFootprint(capItem, g.rot_deg);
    pieces.push({ kind, lib_key: key, x_mm: +x.toFixed(2), y_mm: +(railY - capRail).toFixed(2), w: cf.w, h: cf.h });
    x += cf.w + gap;
  };

  pushCap(g.cap_start_key, "cap_start");
  for (let i = 0; i < g.count; i += 1) {
    pieces.push({ kind: "member", lib_key: g.lib_key, index: i, x_mm: +x.toFixed(2), y_mm: g.y_mm, w: f.w, h: f.h });
    x += f.w + gap;
  }
  pushCap(g.cap_end_key, "cap_end");

  const right = pieces[pieces.length - 1];
  const totalW = +(right.x_mm + right.w - g.x_mm).toFixed(2);
  const top = Math.min(...pieces.map((p) => p.y_mm));
  const bottom = Math.max(...pieces.map((p) => p.y_mm + p.h));
  return {
    pieces,
    totalW,
    bbox: { x: g.x_mm, y: top, w: totalW, h: +(bottom - top).toFixed(2) },
    railY: +railY.toFixed(2),
  };
}
