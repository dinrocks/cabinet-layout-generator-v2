/**
 * Drawing-sheet spec (pure): frame + zone grid + the AMR title band, in paper mm,
 * top-left coordinates. Measured 1:1 from the engineer's REAL template
 * (Template.dxf, 2026-07-20) — every line and text height below is the actual
 * company sheet, normalized to A3 landscape (the ticks/cells scale
 * proportionally for other paper sizes; the house set is A3).
 *
 * Real structure (differs from the earlier screenshot-estimated sheet):
 *   - outer rect = the PAPER EDGE; inner frame ~5mm in (x 4.99, y 4.83);
 *   - the title band (28.51mm) sits BELOW the inner frame, full width, down to
 *     the paper edge;
 *   - zone numbers 1..10 top only; letters A..F on BOTH sides;
 *   - the revision table carries BY/CHK/ENG/APPR as columns per revision row
 *     (no separate initials section);
 *   - [ REFERENCE DRAWING NO. | DESCRIPTION ]  [ REMARK ]  [ REV|DATE|DESC|
 *     BY|CHK|ENG|APPR ]  [ DESIGNER | CLIENT / TITLE ]  [ SCALE · PROJECT NO. ·
 *     DRAWING NO. · SHEET · REV. ].
 *
 * Consumed by render/page.ts (SVG → PDF/PNG); service/dxf_build.py mirrors the
 * same arithmetic for the DXF paper-space layouts — keep them in sync.
 */
import type { ProjectMeta } from "./types";

export const SHEET = {
  margin_x_mm: 4.99, // inner frame offset from the paper edge (sides)
  margin_top_mm: 4.83, // inner frame offset from the paper top
  band_mm: 28.51, // title-band height (below the inner frame, to the paper edge)
  pad_mm: 10, // min gap between the drawing and the frame/band (engineer: ≥10mm)
} as const;

export interface SheetLine { x1: number; y1: number; x2: number; y2: number; w: number }
export interface SheetText {
  x: number; y: number; // y = text BASELINE (top-left coords)
  text: string; h: number;
  anchor: "start" | "middle";
}
export interface Rect { x: number; y: number; w: number; h: number }

export interface SheetSpec {
  lines: SheetLine[];
  texts: SheetText[];
  /** inner frame (content boundary) */
  inner: Rect;
  /** where the plate drawing may sit (inner minus band minus pad) */
  drawArea: Rect;
}

const dash = (s: string | undefined) => (s && s.trim() ? s : "-");
const blank = (s: string | undefined) => (s && s.trim() ? s : "");

/** The template's zone grid is fixed 10 × 6 (scaled to the paper). */
export function zoneCounts(_innerW?: number, _innerH?: number): { cols: number; rows: number } {
  return { cols: 10, rows: 6 };
}

// ── the measured A3 template (mm; top-left origin) ───────────────────────────
const A3W = 420, A3H = 297;
const INNER = { x1: 4.99, y1: 4.83, x2: 415.01, y2: 268.49 }; // frame; band below
/** zone column tick Xs (top margin band) — edge columns are 1mm wider */
const COL_TICKS = [42.8, 84.6, 126.4, 168.2, 210.0, 251.8, 293.6, 335.4, 377.2];
/** zone row tick Ys (left AND right margin bands) */
const ROW_TICKS = [49.15, 93.36, 137.57, 181.78, 225.99];
const ZONE_H = 2.56; // zone letter/number text height

// title band (y 268.49 → 297)
const BAND_Y = 268.49;
/** ref-drawings table: x 0→111.29, split at 42.79; shares row lines with the rev table */
const REF = { x1: 0, split: 42.79, x2: 111.29 };
/** remark box: x 111.29→187.09 (no subdivisions) */
const REMARK = { x1: 111.29, x2: 187.09 };
/** revision table column edges: REV|DATE|DESCRIPTION|BY|CHK|ENG|APPR */
const REV_COLS = [187.09, 192.5, 202.86, 258.34, 263.87, 269.4, 274.93, 283.27];
/** the 7 interior row lines shared by the ref + rev tables (8 rows, ~3.46mm) */
const ROW_YS = [272.48, 275.94, 279.4, 282.86, 286.31, 289.77, 293.22];
const DESIGNER = { x1: 283.27, x2: 343.99, y2: 288.57 };
const CLIENT_SPLIT_Y = 278.62; // client above, title below (x 343.99→420)
/** bottom-right strip (y 288.57→297): SCALE|PROJECT NO.|DRAWING NO.|SHEET|REV. */
const STRIP = { y1: 288.57, labelY: 291.03, cols: [283.27, 313.63, 343.99, 395.82, 413.09, 420] };
// text heights (measured from the DXF = CAD CAP heights)
const H_LABEL = 1.28, H_REVVAL = 1.02, H_TITLE = 1.88, H_TITLE2 = 1.65, H_CELLVAL = 2.13, H_SHEETVAL = 1.88;
/** Measured heights are CAP heights (the DXF unit); SVG font-size is EM size.
 *  Arial caps ≈ 0.716 em, so SVG emits h/0.716 to print caps at the true size.
 *  (dxf_build.py uses the measured cap heights directly — DXF's native unit.) */
const CAP_TO_EM = 1 / 0.716;

export function sheetSpec(pageW: number, pageH: number, p: ProjectMeta, scaleText: string): SheetSpec {
  // everything is specced on the measured A3 sheet, scaled proportionally
  const kx = pageW / A3W;
  const ky = pageH / A3H;
  const L: SheetLine[] = [];
  const T: SheetText[] = [];
  const line = (x1: number, y1: number, x2: number, y2: number, w = 0.25) =>
    L.push({ x1: x1 * kx, y1: y1 * ky, x2: x2 * kx, y2: y2 * ky, w });
  const text = (s: string, x: number, yBase: number, h: number, anchor: "start" | "middle") => {
    if (s) T.push({ x: x * kx, y: yBase * ky, text: s, h: h * CAP_TO_EM * ky, anchor });
  };
  /** label in a box's top-left corner (measured inset ≈0.6 right, 2.1 down) */
  const label = (x: number, y: number, s: string) => text(s, x + 0.6, y + 2.12, H_LABEL, "start");
  /** centered in a horizontal span at a baseline */
  const center = (x1: number, x2: number, yBase: number, s: string, h: number) =>
    text(s, (x1 + x2) / 2, yBase, h, "middle");

  // ── paper edge + inner frame ───────────────────────────────────────────────
  line(0, 0, A3W, 0, 0.5); line(0, A3H, A3W, A3H, 0.5);
  line(0, 0, 0, A3H, 0.5); line(A3W, 0, A3W, A3H, 0.5);
  line(INNER.x1, INNER.y1, INNER.x2, INNER.y1, 0.7);
  line(INNER.x1, INNER.y2, INNER.x2, INNER.y2, 0.7);
  line(INNER.x1, INNER.y1, INNER.x1, INNER.y2, 0.7);
  line(INNER.x2, INNER.y1, INNER.x2, INNER.y2, 0.7);

  // ── zone grid: numbers 1..10 top only; letters A..F on BOTH sides ─────────
  for (const x of COL_TICKS) line(x, 0, x, INNER.y1);
  const colEdges = [0, ...COL_TICKS, A3W];
  for (let c = 0; c < 10; c += 1) {
    center(colEdges[c], colEdges[c + 1], 3.72, String(c + 1), ZONE_H);
  }
  for (const y of ROW_TICKS) { line(0, y, INNER.x1, y); line(INNER.x2, y, A3W, y); }
  const rowEdges = [INNER.y1, ...ROW_TICKS, INNER.y2];
  for (let r = 0; r < 6; r += 1) {
    const yBase = (rowEdges[r] + rowEdges[r + 1]) / 2 + ZONE_H * 0.45;
    const letter = String.fromCharCode(65 + r); // A..F, top→bottom
    text(letter, INNER.x1 / 2, yBase, ZONE_H, "middle");
    text(letter, (INNER.x2 + A3W) / 2, yBase, ZONE_H, "middle");
  }

  // ── title band ─────────────────────────────────────────────────────────────
  line(0, BAND_Y, A3W, BAND_Y, 0.7); // band top spans the full paper width
  // section verticals (full band height)
  for (const x of [REF.split, REF.x2, ...REV_COLS.slice(0, -1), REV_COLS[REV_COLS.length - 1], DESIGNER.x2]) {
    line(x, BAND_Y, x, A3H, 0.35);
  }
  // ref + rev tables share the 8 rows
  for (const y of ROW_YS) { line(REF.x1, y, REF.x2, y, 0.18); line(REV_COLS[0], y, REV_COLS[REV_COLS.length - 1], y, 0.18); }
  // [ref table] headers on the bottom row
  center(REF.x1, REF.split, 295.6, "REFERENCE DRAWING NO.", H_LABEL);
  center(REF.split, REF.x2, 295.6, "DESCRIPTION", H_LABEL);
  // [remark]
  label(REMARK.x1, BAND_Y + 0.9, "REMARK");
  // [revision table] headers on the bottom row; the newest revision fills the row above
  const revHead = ["REV.", "DATE", "DESCRIPTION", "BY", "CHK", "ENG", "APPR"];
  const revVals = [blank(p.rev), blank(p.date), blank(p.rev_desc), dash(p.by), dash(p.chk), dash(p.eng), dash(p.appr)];
  for (let c = 0; c < 7; c += 1) {
    center(REV_COLS[c], REV_COLS[c + 1], 295.56, revHead[c], H_LABEL);
    if (c === 2) text(revVals[c], REV_COLS[c] + 1.9, 292.01, H_REVVAL, "start"); // description: left-aligned
    else center(REV_COLS[c], REV_COLS[c + 1], 292.01, revVals[c], H_REVVAL);
  }
  // [designer] and [client / title]
  label(DESIGNER.x1, BAND_Y, "DESIGNER:");
  center(DESIGNER.x1, DESIGNER.x2, 280, blank(p.designer), H_TITLE2);
  line(DESIGNER.x2, CLIENT_SPLIT_Y, A3W, CLIENT_SPLIT_Y, 0.35);
  line(DESIGNER.x1, DESIGNER.y2, A3W, DESIGNER.y2, 0.35);
  label(DESIGNER.x2, BAND_Y, "CLIENT:");
  center(DESIGNER.x2, A3W, 275.5, blank(p.client), H_TITLE2);
  label(DESIGNER.x2, CLIENT_SPLIT_Y, "TITLE:");
  center(DESIGNER.x2, A3W, 282.94, blank(p.name), H_TITLE);
  center(DESIGNER.x2, A3W, 286.21, blank(p.title2), H_TITLE2);
  // [bottom strip] SCALE · PROJECT NO. · DRAWING NO. · SHEET · REV.
  line(STRIP.cols[0], STRIP.labelY, A3W, STRIP.labelY, 0.18);
  const stripHead = ["SCALE", "PROJECT NO.", "DRAWING NO.", "SHEET", "REV."];
  const stripVals = [scaleText, blank(p.project_no), blank(p.drawing_no), blank(p.sheet_no), dash(p.rev)];
  const stripValH = [H_CELLVAL, H_CELLVAL, H_CELLVAL, H_SHEETVAL, H_CELLVAL];
  for (let c = 0; c < 5; c += 1) {
    if (c) line(STRIP.cols[c], STRIP.y1, STRIP.cols[c], A3H, 0.35);
    center(STRIP.cols[c], STRIP.cols[c + 1], 290.43, stripHead[c], H_LABEL);
    center(STRIP.cols[c], STRIP.cols[c + 1], 294.73, stripVals[c], stripValH[c]);
  }

  const inner: Rect = {
    x: INNER.x1 * kx, y: INNER.y1 * ky,
    w: (INNER.x2 - INNER.x1) * kx, h: (INNER.y2 - INNER.y1) * ky,
  };
  const drawArea: Rect = {
    x: inner.x + SHEET.pad_mm,
    y: inner.y + SHEET.pad_mm,
    w: inner.w - 2 * SHEET.pad_mm,
    h: inner.h - 2 * SHEET.pad_mm,
  };
  return { lines: L, texts: T, inner, drawArea };
}
