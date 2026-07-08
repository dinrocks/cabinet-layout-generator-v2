/**
 * BOM drawing sheet (pure): lay the Bill of Materials out as one or more AMR
 * drawing sheets (model/sheet.ts frame + title block) in paper mm, top-left
 * coords — the printable companion to the CSV export, matching the shop-drawing
 * BOM page: ITEM NO. · DESCRIPTION · MANUFACTURER · MODEL · QTY.
 *
 * Deterministic text wrapping (same 0.62·font char-width estimate the renderers
 * use) grows a row's height; rows paginate when the draw area fills and the
 * column header repeats on every page. Nothing is invented: cells print exactly
 * what buildBom() surfaced — "-" for unentered fields, "*" for unconfirmed
 * size estimates (CLAUDE.md §0).
 *
 * Consumed by render/page.ts (SVG per page → multi-page PDF).
 */
import type { ProjectMeta } from "./types";
import { sheetSpec, type SheetLine, type SheetText } from "./sheet";
import { itemNo, type Bom } from "./bom";

export interface BomPage {
  lines: SheetLine[];
  texts: SheetText[];
}

// The table is a centred block narrower than the draw area (engineer's real BOM
// sheet, 2026-07-08): ~0.65 of the width, DESCRIPTION dominant, MFR/MODEL/QTY slim.
const TABLE_W_FRAC = 0.65;
// column fractions of the TABLE width + headers (shop-drawing BOM order)
const COL_F = [0.13, 0.57, 0.12, 0.12, 0.06] as const;
const COL_HEAD = ["ITEM NO.", "DESCRIPTION", "MANUFACTURER", "MODEL", "QTY"] as const;
/** Which columns center their text (ITEM NO. + QTY); the rest are left-aligned. */
const COL_CENTER = [true, false, false, false, true] as const;

const FONT = 2.6; // row text height (mm)
const LINE_H = 4.0; // wrapped-line pitch (mm)
const HEAD_H = 8.0; // header row height (mm)
const HEADING = "BILL OF MATERIALS";

const dash = (s: string) => (s && s.trim() ? s : "-");

/** Greedy word-wrap into lines that fit `maxW` mm at `font` mm (0.62·h char width). */
export function wrapCell(s: string, maxW: number, font = FONT): string[] {
  const maxChars = Math.max(4, Math.floor((maxW - 3) / (0.62 * font)));
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [s];
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const cand = cur ? `${cur} ${w}` : w;
    if (cand.length <= maxChars) { cur = cand; continue; }
    if (cur) lines.push(cur);
    let rest = w; // hard-break a single overlong word (long tag runs)
    while (rest.length > maxChars) { lines.push(rest.slice(0, maxChars)); rest = rest.slice(maxChars); }
    cur = rest;
  }
  if (cur) lines.push(cur);
  return lines;
}

interface WrappedRow {
  cells: string[][]; // wrapped lines per column
  h: number; // row height (mm)
}

/** Lay the BOM out on AMR sheets; one BomPage per paper page (≥1, even empty). */
export function bomSheetPages(bom: Bom, pageW: number, pageH: number, p: ProjectMeta): BomPage[] {
  // the table grid is identical on every page — measure it once
  const probe = sheetSpec(pageW, pageH, p, "-");
  const area = probe.drawArea;
  // a centred block narrower than the draw area (matches the shop sheet)
  const tableW = TABLE_W_FRAC * area.w;
  const tableX = area.x + (area.w - tableW) / 2;
  const colW = COL_F.map((f) => f * tableW);
  const colX: number[] = [tableX];
  for (const w of colW) colX.push(colX[colX.length - 1] + w);
  const tableTop = area.y + 10; // heading sits above the table
  const bottom = area.y + area.h;

  // wrap every row up front so pagination sees real heights
  const rows: WrappedRow[] = bom.rows.map((r) => {
    const cells = [
      itemNo(r),
      dash(r.description) + (r.confirm ? " *" : ""),
      dash(r.manufacturer),
      dash(r.model),
      String(r.qty),
    ].map((s, c) => wrapCell(s, colW[c]));
    const n = Math.max(...cells.map((l) => l.length));
    return { cells, h: n * LINE_H + 2.4 };
  });

  // paginate: the header repeats on each page (no Total-parts row — the engineer's
  // sheet doesn't carry one; it's still shown in the on-screen BOM dialog + CSV).
  const pagesRows: WrappedRow[][] = [[]];
  let y = tableTop + HEAD_H;
  for (const row of rows) {
    if (y + row.h > bottom && pagesRows[pagesRows.length - 1].length > 0) {
      pagesRows.push([]);
      y = tableTop + HEAD_H;
    }
    pagesRows[pagesRows.length - 1].push(row);
    y += row.h;
  }
  const nPages = pagesRows.length;

  return pagesRows.map((pageRows, pi) => {
    const sheet = sheetSpec(pageW, pageH, p, "-"); // BOM sheet carries no scale
    const L: SheetLine[] = [...sheet.lines];
    const T: SheetText[] = [...sheet.texts];
    const line = (x1: number, y1: number, x2: number, y2: number, w = 0.25) =>
      L.push({ x1, y1, x2, y2, w });

    // heading (page counter only when the BOM spans pages)
    const heading = nPages > 1 ? `${HEADING} — PAGE ${pi + 1} OF ${nPages}` : HEADING;
    T.push({ x: area.x + area.w / 2, y: area.y + 6, text: heading, h: 4.5, anchor: "middle" });

    // header row
    let ry = tableTop;
    for (let c = 0; c < COL_HEAD.length; c += 1) {
      T.push({
        x: colX[c] + colW[c] / 2, y: ry + HEAD_H / 2 + 2.8 * 0.35,
        text: COL_HEAD[c], h: 2.8, anchor: "middle",
      });
    }
    ry += HEAD_H;
    line(colX[0], tableTop + HEAD_H, colX[5], tableTop + HEAD_H, 0.5);

    // data rows
    for (const row of pageRows) {
      for (let c = 0; c < 5; c += 1) {
        const linesC = row.cells[c];
        const blockH = (linesC.length - 1) * LINE_H;
        let base = ry + row.h / 2 - blockH / 2 + FONT * 0.35;
        for (const s of linesC) {
          if (s) {
            if (COL_CENTER[c]) T.push({ x: colX[c] + colW[c] / 2, y: base, text: s, h: FONT, anchor: "middle" });
            else T.push({ x: colX[c] + 1.5, y: base, text: s, h: FONT, anchor: "start" });
          }
          base += LINE_H;
        }
      }
      ry += row.h;
      line(colX[0], ry, colX[5], ry);
    }

    // table outline + column separators (span header→last row on this page)
    line(colX[0], tableTop, colX[5], tableTop, 0.5);
    for (let c = 0; c <= 5; c += 1) line(colX[c], tableTop, colX[c], ry, c === 0 || c === 5 ? 0.5 : 0.25);

    return { lines: L, texts: T };
  });
}
