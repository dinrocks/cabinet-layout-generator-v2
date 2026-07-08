/**
 * Drawing-sheet spec (pure): frame + zone grid + the AMR title band, in paper mm,
 * top-left coordinates. Reproduces the engineer's real sheet template (screenshots,
 * 2026-07-06): zone columns 1..N / rows A.. on all four edges, and a bottom band of
 *   [ REFERENCE DRAWING NO. | DESCRIPTION table ] [ REMARK ] [ REV/DATE/DESCRIPTION
 *   history ] [ BY/CHK/ENG/APPR initials ] [ DESIGNER | CLIENT / TITLE | SCALE ·
 *   PROJECT NO. · DRAWING NO. · SHEET · REV. ]
 * Cell sizes are estimated from the screenshots (mm not given) — tune the constants.
 *
 * Consumed by render/page.ts (SVG → PDF/PNG); service/dxf_build.py mirrors the same
 * arithmetic for the DXF paper-space layout — keep them in sync.
 */
import type { ProjectMeta } from "./types";

export const SHEET = {
  outer_mm: 5,   // outer border offset from the paper edge
  zone_mm: 7,    // zone-tick band between outer and inner border
  band_mm: 30,   // title-band height (inside the inner border, at the bottom)
  pad_mm: 10,    // min gap between the drawing and the frame/band (engineer: ≥10mm)
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

/** Zone counts scale with the sheet (A3 landscape → 10 × 6, like the template). */
export function zoneCounts(innerW: number, innerH: number): { cols: number; rows: number } {
  return { cols: Math.max(4, Math.round(innerW / 40)), rows: Math.max(3, Math.round(innerH / 45)) };
}

export function sheetSpec(pageW: number, pageH: number, p: ProjectMeta, scaleText: string): SheetSpec {
  const L: SheetLine[] = [];
  const T: SheetText[] = [];
  const line = (x1: number, y1: number, x2: number, y2: number, w = 0.25) => L.push({ x1, y1, x2, y2, w });
  const rect = (r: Rect, w = 0.25) => {
    line(r.x, r.y, r.x + r.w, r.y, w); line(r.x, r.y + r.h, r.x + r.w, r.y + r.h, w);
    line(r.x, r.y, r.x, r.y + r.h, w); line(r.x + r.w, r.y, r.x + r.w, r.y + r.h, w);
  };
  const label = (r: Rect, text: string, h = 2.0) => T.push({ x: r.x + 1, y: r.y + h + 0.8, text, h, anchor: "start" });
  const center = (r: Rect, text: string, h = 3.0) => {
    if (text) T.push({ x: r.x + r.w / 2, y: r.y + r.h / 2 + h * 0.35, text, h, anchor: "middle" });
  };

  // ── frame + zone grid ──────────────────────────────────────────────────────
  const o = SHEET.outer_mm;
  const outer: Rect = { x: o, y: o, w: pageW - 2 * o, h: pageH - 2 * o };
  const i = o + SHEET.zone_mm;
  const inner: Rect = { x: i, y: i, w: pageW - 2 * i, h: pageH - 2 * i };
  rect(outer, 0.7);
  rect(inner, 0.5);

  // Zone references (engineer, 2026-07-08): numbers along the TOP only, letters down
  // the LEFT only — one set each is enough; the other two edges keep just the ticks.
  const { cols, rows } = zoneCounts(inner.w, inner.h);
  const colW = inner.w / cols;
  for (let c = 0; c <= cols; c += 1) {
    const x = inner.x + c * colW;
    line(x, outer.y, x, inner.y); line(x, inner.y + inner.h, x, outer.y + outer.h); // ticks top+bottom
    if (c < cols) {
      const cx = inner.x + (c + 0.5) * colW;
      T.push({ x: cx, y: (outer.y + inner.y) / 2 + 1.2, text: String(c + 1), h: 3.2, anchor: "middle" });
    }
  }
  const rowH = inner.h / rows;
  for (let r = 0; r <= rows; r += 1) {
    const y = inner.y + r * rowH;
    line(outer.x, y, inner.x, y); line(inner.x + inner.w, y, outer.x + outer.w, y); // ticks left+right
    if (r < rows) {
      const cy = inner.y + (r + 0.5) * rowH + 1.2;
      T.push({ x: (outer.x + inner.x) / 2, y: cy, text: String.fromCharCode(65 + r), h: 3.2, anchor: "middle" });
    }
  }

  // ── bottom title band ──────────────────────────────────────────────────────
  const bandH = SHEET.band_mm;
  const band: Rect = { x: inner.x, y: inner.y + inner.h - bandH, w: inner.w, h: bandH };
  line(band.x, band.y, band.x + band.w, band.y, 0.5);

  // section widths as fractions of the inner width (estimated from the template)
  const secW = [0.30, 0.12, 0.20, 0.08, 0.30].map((f) => f * band.w);
  let sx = band.x;
  const sec: Rect[] = secW.map((w) => { const r = { x: sx, y: band.y, w, h: bandH }; sx += w; return r; });
  for (const s of sec.slice(0, 4)) line(s.x + s.w, band.y, s.x + s.w, band.y + bandH, 0.5);

  // [0] REFERENCE DRAWING NO. | DESCRIPTION — header row at the bottom, empty rows above
  {
    const s = sec[0];
    const rowsN = bandH / 5; // 5mm rows
    for (let r = 1; r < rowsN; r += 1) line(s.x, s.y + r * 5, s.x + s.w, s.y + r * 5);
    const split = s.x + 0.42 * s.w;
    line(split, s.y, split, s.y + s.h);
    const head = { x: s.x, y: s.y + bandH - 5, w: 0.42 * s.w, h: 5 };
    center(head, "REFERENCE DRAWING NO.", 2.2);
    center({ ...head, x: split, w: s.w - head.w }, "DESCRIPTION", 2.2);
  }
  // [1] REMARK — one open box with the label top-left
  label(sec[1], "REMARK");
  // [2] revision history — REV. | DATE | DESCRIPTION header at the bottom, newest row above it
  {
    const s = sec[2];
    for (let r = 1; r < bandH / 5; r += 1) line(s.x, s.y + r * 5, s.x + s.w, s.y + r * 5);
    const cw = [0.15, 0.25, 0.60].map((f) => f * s.w);
    line(s.x + cw[0], s.y, s.x + cw[0], s.y + s.h);
    line(s.x + cw[0] + cw[1], s.y, s.x + cw[0] + cw[1], s.y + s.h);
    const hy = s.y + bandH - 5;
    center({ x: s.x, y: hy, w: cw[0], h: 5 }, "REV.", 2.2);
    center({ x: s.x + cw[0], y: hy, w: cw[1], h: 5 }, "DATE", 2.2);
    center({ x: s.x + cw[0] + cw[1], y: hy, w: cw[2], h: 5 }, "DESCRIPTION", 2.2);
    const vy = hy - 5; // newest revision = the row just above the header
    center({ x: s.x, y: vy, w: cw[0], h: 5 }, blank(p.rev), 2.4);
    center({ x: s.x + cw[0], y: vy, w: cw[1], h: 5 }, blank(p.date), 2.4);
    center({ x: s.x + cw[0] + cw[1], y: vy, w: cw[2], h: 5 }, blank(p.rev_desc), 2.4);
  }
  // [3] initials — BY | CHK | ENG | APPR labels at the bottom, values above
  {
    const s = sec[3];
    const cw = s.w / 4;
    line(s.x, s.y + bandH - 10, s.x + s.w, s.y + bandH - 10);
    line(s.x, s.y + bandH - 5, s.x + s.w, s.y + bandH - 5);
    const labels = ["BY", "CHK", "ENG", "APPR"];
    const values = [p.by, p.chk, p.eng, p.appr];
    for (let c = 0; c < 4; c += 1) {
      if (c) line(s.x + c * cw, s.y + bandH - 10, s.x + c * cw, s.y + bandH);
      center({ x: s.x + c * cw, y: s.y + bandH - 5, w: cw, h: 5 }, labels[c], 2.0);
      center({ x: s.x + c * cw, y: s.y + bandH - 10, w: cw, h: 5 }, dash(values[c]), 2.2);
    }
  }
  // [4] DESIGNER | CLIENT / TITLE, with SCALE · PROJECT NO. · DRAWING NO. · SHEET · REV. below
  {
    const s = sec[4];
    const rowY = s.y + bandH - 9; // bottom cells row (9mm)
    line(s.x, rowY, s.x + s.w, rowY, 0.5);
    const desW = 0.38 * s.w;
    line(s.x + desW, s.y, s.x + desW, rowY);
    label({ x: s.x, y: s.y, w: desW, h: 21 }, "DESIGNER:");
    center({ x: s.x, y: s.y + 4, w: desW, h: 17 }, blank(p.designer), 2.6);
    const cliY = s.y + 10;
    line(s.x + desW, cliY, s.x + s.w, cliY);
    label({ x: s.x + desW, y: s.y, w: s.w - desW, h: 10 }, "CLIENT:");
    center({ x: s.x + desW, y: s.y + 2.5, w: s.w - desW, h: 7.5 }, blank(p.client), 2.6);
    label({ x: s.x + desW, y: cliY, w: s.w - desW, h: rowY - cliY }, "TITLE:");
    const titleBox = { x: s.x + desW, y: cliY + 2, w: s.w - desW, h: rowY - cliY - 2 };
    T.push({ x: titleBox.x + titleBox.w / 2, y: titleBox.y + 4.0, text: blank(p.name), h: 3.4, anchor: "middle" });
    T.push({ x: titleBox.x + titleBox.w / 2, y: titleBox.y + 8.0, text: blank(p.title2), h: 2.8, anchor: "middle" });

    const cellF = [0.14, 0.22, 0.34, 0.18, 0.12];
    const cellLabels = ["SCALE", "PROJECT NO.", "DRAWING NO.", "SHEET", "REV."];
    const cellValues = [scaleText, blank(p.project_no), blank(p.drawing_no), blank(p.sheet_no), dash(p.rev)];
    let cx = s.x;
    for (let c = 0; c < 5; c += 1) {
      const cell = { x: cx, y: rowY, w: cellF[c] * s.w, h: 9 };
      if (c) line(cell.x, rowY, cell.x, rowY + 9, 0.5);
      label(cell, cellLabels[c], 1.8);
      center({ ...cell, y: cell.y + 2.5, h: cell.h - 2.5 }, cellValues[c], 2.8);
      cx += cell.w;
    }
  }

  const drawArea: Rect = {
    x: inner.x + SHEET.pad_mm,
    y: inner.y + SHEET.pad_mm,
    w: inner.w - 2 * SHEET.pad_mm,
    h: inner.h - bandH - 2 * SHEET.pad_mm,
  };
  return { lines: L, texts: T, inner, drawArea };
}
