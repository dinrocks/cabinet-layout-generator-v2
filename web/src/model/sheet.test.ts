import { describe, it, expect } from "vitest";
import { sheetSpec, zoneCounts, SHEET } from "./sheet";
import type { ProjectMeta } from "./types";

const P: ProjectMeta = {
  id: "p", name: "RTU-FLOOR-TYPE 4", panel_tag: "", rev: "A",
  title2: "CABINET LAYOUT", project_no: "EE-NEX2025010", drawing_no: "EE-NEX2025010-XX",
  sheet_no: "4 OF 26", date: "19-AUG-2025", rev_desc: "ISSUED FOR APPROVAL",
  by: "PS", chk: "SI", eng: "SI", appr: "", client: "", designer: "",
};

// A3 landscape (the house template's native size)
const spec = () => sheetSpec(420, 297, P, "1:10");

describe("zoneCounts", () => {
  it("is the template's fixed 10 × 6 grid", () => {
    expect(zoneCounts()).toEqual({ cols: 10, rows: 6 });
  });
});

describe("sheetSpec — measured 1:1 from Template.dxf", () => {
  it("inner frame and band sit at the measured template positions", () => {
    const s = spec();
    expect(s.inner.x).toBeCloseTo(4.99, 2);
    expect(s.inner.y).toBeCloseTo(4.83, 2);
    expect(s.inner.x + s.inner.w).toBeCloseTo(415.01, 2);
    // the inner frame bottom IS the band top; band runs to the paper edge
    expect(s.inner.y + s.inner.h).toBeCloseTo(297 - SHEET.band_mm, 2);
  });

  it("draw area keeps the ≥10mm pad inside the frame, above the band", () => {
    const s = spec();
    expect(s.drawArea.x - s.inner.x).toBeGreaterThanOrEqual(10);
    expect(s.drawArea.y - s.inner.y).toBeGreaterThanOrEqual(10);
    expect(s.inner.x + s.inner.w - (s.drawArea.x + s.drawArea.w)).toBeGreaterThanOrEqual(10);
    expect(s.inner.y + s.inner.h - (s.drawArea.y + s.drawArea.h)).toBeGreaterThanOrEqual(10);
  });

  it("prints every field where the template has it", () => {
    const texts = spec().texts.map((t) => t.text);
    for (const expected of [
      "RTU-FLOOR-TYPE 4", "CABINET LAYOUT",                       // TITLE lines
      "EE-NEX2025010", "EE-NEX2025010-XX", "4 OF 26", "A",        // bottom cells
      "1:10",                                                     // computed scale
      "19-AUG-2025", "ISSUED FOR APPROVAL", "PS", "SI",           // newest revision row (incl. initials)
      "SCALE", "PROJECT NO.", "DRAWING NO.", "SHEET", "REV.",     // cell labels
      "REFERENCE DRAWING NO.", "DESCRIPTION", "REMARK", "DESIGNER:", "CLIENT:", "TITLE:",
      "BY", "CHK", "ENG", "APPR",                                 // revision-table header columns
    ]) expect(texts, expected).toContain(expected);
  });

  it("zone numbers top only; letters on BOTH sides (like the template)", () => {
    const texts = spec().texts;
    expect(texts.filter((t) => t.text === "7")).toHaveLength(1);   // top only
    expect(texts.filter((t) => t.text === "F")).toHaveLength(2);   // left + right
    expect(texts.filter((t) => t.text === "10")).toHaveLength(1);
  });

  it("initials live IN the revision row (no separate initials block); empties dash", () => {
    const s = sheetSpec(420, 297, { id: "p", name: "X", panel_tag: "", rev: "A" }, "1:10");
    const texts = s.texts.map((t) => t.text);
    expect(texts).not.toContain("undefined");
    expect(texts.filter((t) => t === "-").length).toBeGreaterThanOrEqual(4); // BY/CHK/ENG/APPR dashes
  });

  it("measured CAP heights print true-size (SVG em = cap / 0.716)", () => {
    const s = spec();
    const cap = (txt: string) => s.texts.find((t) => t.text === txt)!.h * 0.716;
    expect(cap("SCALE")).toBeCloseTo(1.28, 2);        // labels
    expect(cap("EE-NEX2025010")).toBeCloseTo(2.13, 2); // bottom cell values
    expect(cap("7")).toBeCloseTo(2.56, 2);             // zone numbers
    expect(cap("RTU-FLOOR-TYPE 4")).toBeCloseTo(1.88, 2); // title
  });

  it("scales proportionally to A4 landscape", () => {
    const s = sheetSpec(297, 210, P, "1:10");
    expect(s.inner.x).toBeCloseTo(4.99 * 297 / 420, 2);
    expect(s.inner.y + s.inner.h).toBeCloseTo(210 - SHEET.band_mm * 210 / 297, 1);
  });

  it("all geometry stays on the page", () => {
    const s = spec();
    for (const l of s.lines) {
      for (const v of [l.x1, l.x2]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(420); }
      for (const v of [l.y1, l.y2]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(297); }
    }
  });
});
