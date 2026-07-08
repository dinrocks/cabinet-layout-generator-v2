import { describe, it, expect } from "vitest";
import { bomSheetPages, wrapCell } from "./bomsheet";
import { sheetSpec } from "./sheet";
import type { Bom, BomRow } from "./bom";
import type { ProjectMeta } from "./types";

const P: ProjectMeta = { id: "p", name: "RTU-FLOOR-TYPE 4", panel_tag: "", rev: "A" };

const row = (over: Partial<BomRow>): BomRow => ({
  key: "k", tags: [], description: "PSU 24VDC", manufacturer: "", model: "",
  category: "Power", band: 2, qty: 1, confirm: false, ...over,
});

const bomOf = (rows: BomRow[]): Bom => ({ rows, totalParts: rows.reduce((s, r) => s + r.qty, 0) });

// A3 landscape (the house default)
const pages = (rows: BomRow[]) => bomSheetPages(bomOf(rows), 420, 297, P);

describe("wrapCell", () => {
  it("keeps short text on one line, wraps long text on word boundaries", () => {
    expect(wrapCell("PSU 24VDC", 60)).toEqual(["PSU 24VDC"]);
    const lines = wrapCell("RTU CABINET STEEL SHEET POWDER COATED OUTDOOR TYPE IP54 RAL7035", 40);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(Math.floor((40 - 3) / (0.68 * 2.6)));
  });

  it("hard-breaks a single overlong word (long tag runs)", () => {
    const lines = wrapCell("B101-B112,X201-X299,K1-K44", 20);
    expect(lines.length).toBeGreaterThan(1);
  });
});

describe("bomSheetPages", () => {
  it("a small BOM is one page: heading, column headers, row data, total", () => {
    const pgs = pages([
      row({ key: "a", tags: ["PS01"], description: "PSU 24VDC", manufacturer: "MEAN WELL", model: "NDR-120-24", qty: 1 }),
      row({ key: "b", tags: ["B101", "B102", "B103", "B104"], description: "Terminal 2.5mm", qty: 4 }),
    ]);
    expect(pgs).toHaveLength(1);
    const texts = pgs[0].texts.map((t) => t.text);
    for (const s of ["BILL OF MATERIALS", "ITEM NO.", "DESCRIPTION", "MANUFACTURER", "MODEL", "QTY",
      "PS01", "PSU 24VDC", "MEAN WELL", "NDR-120-24", "B101-B104"])
      expect(texts, s).toContain(s);
    // sheet frame is present too (title block labels come from sheetSpec)
    expect(texts).toContain("DRAWING NO.");
    // no Total-parts row on the drawing sheet (it lives in the dialog + CSV)
    expect(texts).not.toContain("Total parts");
  });

  it("unentered fields print '-', estimates carry the * marker", () => {
    const pgs = pages([row({ description: "IDEC FC6A CPU", confirm: true })]);
    const texts = pgs[0].texts.map((t) => t.text);
    expect(texts).toContain("IDEC FC6A CPU *");
    expect(texts.filter((t) => t === "-").length).toBeGreaterThanOrEqual(3); // item no + mfr + model
  });

  it("many rows paginate; the header repeats and pages are numbered", () => {
    const many = Array.from({ length: 80 }, (_, i) =>
      row({ key: `k${i}`, tags: [`D${100 + i}`], description: `DEVICE NUMBER ${i} WITH A LONGISH SPEC LINE` }));
    const pgs = pages(many);
    expect(pgs.length).toBeGreaterThan(1);
    for (const [i, pg] of pgs.entries()) {
      const texts = pg.texts.map((t) => t.text);
      expect(texts).toContain("ITEM NO."); // header on every page
      expect(texts).toContain(`BILL OF MATERIALS — PAGE ${i + 1} OF ${pgs.length}`);
    }
    // every device row landed exactly once across the pages
    const all = pgs.flatMap((pg) => pg.texts.map((t) => t.text));
    for (let i = 0; i < many.length; i += 1)
      expect(all.filter((t) => t === `D${100 + i}`)).toHaveLength(1);
  });

  it("no table content spills below the draw area or into the title band", () => {
    const many = Array.from({ length: 80 }, (_, i) => row({ key: `k${i}`, tags: [`D${i}`] }));
    const base = sheetSpec(420, 297, P, "-");
    // table texts = everything the page adds beyond the sheet frame/title block
    const frame = new Set(base.texts.map((t) => `${t.x},${t.y},${t.text}`));
    for (const pg of pages(many)) {
      const table = pg.texts.filter((t) => !frame.has(`${t.x},${t.y},${t.text}`));
      expect(table.length).toBeGreaterThan(0);
      for (const t of table) expect(t.y).toBeLessThanOrEqual(base.drawArea.y + base.drawArea.h + 0.01);
    }
  });

  it("a wrapped description grows its row instead of overlapping the next", () => {
    const long = "RTU CABINET STEEL SHEET POWDER COATED OUTDOOR TYPE IP54 RAL7035 WITH RAIN HOOD AND BASE";
    const pgs = pages([
      row({ key: "a", description: long }),
      row({ key: "b", tags: ["FAN01"], description: "AXIAL FAN 120MM" }),
    ]);
    const texts = pgs[0].texts;
    const longLines = texts.filter((t) => long.startsWith(t.text.split(" ")[0]) && t.h === 2.6 && t.anchor === "start" && t.text !== "AXIAL FAN 120MM");
    const fan = texts.find((t) => t.text === "AXIAL FAN 120MM")!;
    for (const l of longLines.filter((t) => long.includes(t.text)))
      expect(fan.y).toBeGreaterThan(l.y); // next row starts below every wrapped line
  });

  it("the table is a centred block, clearly narrower than the draw area", () => {
    const base = sheetSpec(420, 297, P, "-");
    const area = base.drawArea;
    const frame = new Set(base.lines.map((l) => `${l.x1},${l.y1},${l.x2},${l.y2}`));
    const pg = pages([row({ tags: ["A1"] }), row({ tags: ["A2"] })])[0];
    const xs = pg.lines
      .filter((l) => !frame.has(`${l.x1},${l.y1},${l.x2},${l.y2}`)) // table lines only
      .flatMap((l) => [l.x1, l.x2]);
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    expect(right - left).toBeLessThan(area.w * 0.8);                 // narrower than full width
    expect(right - left).toBeGreaterThan(area.w * 0.5);             // but not tiny
    expect(Math.abs((left - area.x) - (area.x + area.w - right))).toBeLessThan(0.5); // centred
  });

  it("the SCALE cell prints '-' (a BOM sheet has no scale)", () => {
    const texts = pages([row({})])[0].texts;
    expect(texts.some((t) => t.text === "SCALE")).toBe(true);
    expect(texts.some((t) => t.text === "-")).toBe(true);
  });

  it("even an empty BOM yields one well-formed page", () => {
    const pgs = pages([]);
    expect(pgs).toHaveLength(1);
    const texts = pgs[0].texts.map((t) => t.text);
    expect(texts).toContain("BILL OF MATERIALS"); // heading + frame, no data rows
    expect(texts).toContain("DRAWING NO.");
  });

  it("all geometry stays on the page", () => {
    const many = Array.from({ length: 40 }, (_, i) => row({ key: `k${i}` }));
    for (const pg of pages(many)) {
      for (const l of pg.lines) {
        for (const v of [l.x1, l.x2]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(420); }
        for (const v of [l.y1, l.y2]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(297); }
      }
    }
  });
});
