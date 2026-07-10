/**
 * Compose a paper-sized SVG "page" around the plate render, for PDF/PNG export.
 *
 * The page is a real drawing SHEET (AMR template): frame + zone grid + title band
 * (model/sheet.ts), with the drawing auto-fitted into the sheet's draw area and
 * the RESULTING scale printed in the SCALE cell (e.g. "1:10"). Orientation is
 * whichever yields the larger drawing. (brief §6.)
 *
 * Everything is in millimetres so the same SVG drives both a vector PDF (svg2pdf
 * into a mm-unit jsPDF) and a rasterised PNG (mm → px at the chosen DPI).
 */
import type { LayoutModel, Library } from "../model/types";
import { renderPlateBody, contentWidth } from "./toSvg";
import { sheetSpec, SHEET, type SheetLine, type SheetText } from "../model/sheet";
import { bomSheetPages } from "../model/bomsheet";
import { buildBom } from "../model/bom";

export type Paper = "A4" | "A3";

/** Portrait dimensions in mm; we may swap for landscape. */
const PAPER_MM: Record<Paper, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A3: { w: 297, h: 420 },
};

export interface PageResult {
  /** Full page SVG string, sized in mm. */
  svg: string;
  /** Page size in mm (after orientation choice). */
  pageW: number;
  pageH: number;
  orientation: "portrait" | "landscape";
  /** Denominator N of the fitted scale 1:N (rounded, ≥ 1). */
  scaleN: number;
  titleLine: string;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

interface Fit {
  pageW: number;
  pageH: number;
  orientation: "portrait" | "landscape";
  scale: number;
}

/** The sheet's usable draw area for a given page size (mirrors sheetSpec). */
function drawAreaDims(pageW: number, pageH: number): { w: number; h: number } {
  const off = SHEET.outer_mm + SHEET.zone_mm + SHEET.pad_mm;
  return { w: pageW - 2 * off, h: pageH - 2 * off - SHEET.band_mm };
}

/** Sheets are ALWAYS landscape — the house drawing style (engineer, 2026-07-06).
 *  A tall plate simply prints smaller rather than flipping the sheet. */
function bestFit(paper: Paper, plateW: number, plateH: number): Fit {
  const base = PAPER_MM[paper];
  const pageW = base.h; // landscape: swap the portrait dims
  const pageH = base.w;
  const a = drawAreaDims(pageW, pageH);
  return { pageW, pageH, orientation: "landscape", scale: Math.min(a.w / plateW, a.h / plateH) };
}

export function composePageSvg(model: LayoutModel, library: Library, paper: Paper): PageResult {
  const plateW = contentWidth(model); // include the row-dimension margin
  const plateH = model.plate.height_mm;
  const fit = bestFit(paper, plateW, plateH);
  const scaleN = Math.max(1, Math.round(1 / fit.scale));
  const titleLine = `SCALE 1:${scaleN} — PAPER SIZE: ${paper}`;

  const sheet = sheetSpec(fit.pageW, fit.pageH, model.project, `1:${scaleN}`);

  // centre the fitted drawing inside the sheet's draw area
  const drawnW = plateW * fit.scale;
  const drawnH = plateH * fit.scale;
  const offsetX = sheet.drawArea.x + (sheet.drawArea.w - drawnW) / 2;
  const offsetY = sheet.drawArea.y + (sheet.drawArea.h - drawnH) / 2;

  const body = renderPlateBody(model, library);
  const svg = [
    svgOpen(fit.pageW, fit.pageH),
    frameSvg(sheet.lines, sheet.texts),
    `<g transform="translate(${offsetX} ${offsetY}) scale(${fit.scale})">${body}</g>`,
    `</svg>`,
  ].join("");

  return { svg, pageW: fit.pageW, pageH: fit.pageH, orientation: fit.orientation, scaleN, titleLine };
}

// A run containing Thai codepoints opts into the embedded Sarabun (jsPDF built-ins
// and Arial carry no Thai glyphs); everything else stays the Arial default. Per-run,
// because a jsPDF text run is a single font — so a Latin-only sheet is pure Arial.
const THAI_RE = /[฀-๿]/; // Thai Unicode block

/** Serialize sheet lines + texts (paper mm, top-left coords) to SVG elements. */
function frameSvg(lines: SheetLine[], texts: SheetText[]): string {
  return [
    ...lines.map((l) =>
      `<line x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}" stroke="#111" stroke-width="${l.w}"/>`),
    ...texts.map((t) => {
      const ff = THAI_RE.test(t.text) ? ` font-family="Sarabun, Arial, Helvetica, sans-serif"` : "";
      return `<text x="${t.x}" y="${t.y}" font-size="${t.h}" fill="#111" text-anchor="${t.anchor}"${ff}>${esc(t.text)}</text>`;
    }),
  ].join("");
}

function svgOpen(pageW: number, pageH: number): string {
  // Arial is the house default; only Thai-bearing runs opt into the embedded Sarabun
  // (see frameSvg + export/pdfFont.ts), since Arial has no Thai glyphs.
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${pageW}" height="${pageH}" viewBox="0 0 ${pageW} ${pageH}" font-family="Arial, Helvetica, sans-serif">` +
    `<rect x="0" y="0" width="${pageW}" height="${pageH}" fill="#ffffff"/>`
  );
}

export interface BomPagesResult {
  /** One full-page SVG string per BOM sheet (all landscape). */
  svgs: string[];
  pageW: number;
  pageH: number;
}

/** The BOM as printable drawing sheets (AMR frame + title block), one SVG per page. */
export function composeBomPagesSvg(model: LayoutModel, library: Library, paper: Paper): BomPagesResult {
  const base = PAPER_MM[paper];
  const pageW = base.h; // landscape, house style
  const pageH = base.w;
  const bom = buildBom(model, library);
  const pages = bomSheetPages(bom, pageW, pageH, model.project);
  const svgs = pages.map((pg) => [svgOpen(pageW, pageH), frameSvg(pg.lines, pg.texts), `</svg>`].join(""));
  return { svgs, pageW, pageH };
}
