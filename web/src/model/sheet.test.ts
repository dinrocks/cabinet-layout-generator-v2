import { describe, it, expect } from "vitest";
import { sheetSpec, zoneCounts, SHEET } from "./sheet";
import type { ProjectMeta } from "./types";

const P: ProjectMeta = {
  id: "p", name: "RTU-FLOOR-TYPE 4", panel_tag: "", rev: "A",
  title2: "CABINET LAYOUT", project_no: "EE-NEX2025010", drawing_no: "EE-NEX2025010-XX",
  sheet_no: "4 OF 26", date: "19-AUG-2025", rev_desc: "ISSUED FOR APPROVAL",
  by: "PS", chk: "SI", eng: "SI", appr: "", client: "", designer: "",
};

// A3 landscape (the house default)
const spec = () => sheetSpec(420, 297, P, "1:10");

describe("zoneCounts", () => {
  it("matches the template: A3 landscape → 10 × 6", () => {
    const inner = { w: 420 - 2 * (SHEET.outer_mm + SHEET.zone_mm), h: 297 - 2 * (SHEET.outer_mm + SHEET.zone_mm) };
    expect(zoneCounts(inner.w, inner.h)).toEqual({ cols: 10, rows: 6 });
  });
});

describe("sheetSpec", () => {
  it("draw area sits inside the inner frame, above the title band", () => {
    const s = spec();
    expect(s.drawArea.x).toBeGreaterThan(s.inner.x - 0.01);
    expect(s.drawArea.y).toBeGreaterThan(s.inner.y - 0.01);
    expect(s.drawArea.x + s.drawArea.w).toBeLessThan(s.inner.x + s.inner.w + 0.01);
    // bottom of the draw area must clear the 30mm band
    expect(s.drawArea.y + s.drawArea.h).toBeLessThanOrEqual(s.inner.y + s.inner.h - SHEET.band_mm);
  });

  it("prints every field where the template has it", () => {
    const texts = spec().texts.map((t) => t.text);
    for (const expected of [
      "RTU-FLOOR-TYPE 4", "CABINET LAYOUT",                       // TITLE lines
      "EE-NEX2025010", "EE-NEX2025010-XX", "4 OF 26", "A",        // bottom cells + rev history
      "1:10",                                                     // computed scale
      "19-AUG-2025", "ISSUED FOR APPROVAL",                       // newest revision row
      "PS", "SI",                                                 // initials
      "SCALE", "PROJECT NO.", "DRAWING NO.", "SHEET", "REV.",     // cell labels
      "REFERENCE DRAWING NO.", "DESCRIPTION", "REMARK", "DESIGNER:", "CLIENT:", "TITLE:",
      "BY", "CHK", "ENG", "APPR",
    ]) expect(texts, expected).toContain(expected);
  });

  it("zone numbers label the top only, letters the left only (once each)", () => {
    const texts = spec().texts;
    expect(texts.filter((t) => t.text === "7")).toHaveLength(1);   // top only, not bottom
    expect(texts.filter((t) => t.text === "F")).toHaveLength(1);   // left only, not right
  });

  it("keeps at least a 10mm gap between the drawing and the frame/band", () => {
    const s = spec();
    const bandTop = s.inner.y + s.inner.h - SHEET.band_mm;
    expect(s.drawArea.x - s.inner.x).toBeGreaterThanOrEqual(10);                          // left
    expect(s.drawArea.y - s.inner.y).toBeGreaterThanOrEqual(10);                          // top
    expect(s.inner.x + s.inner.w - (s.drawArea.x + s.drawArea.w)).toBeGreaterThanOrEqual(10); // right
    expect(bandTop - (s.drawArea.y + s.drawArea.h)).toBeGreaterThanOrEqual(10);           // above band
  });

  it("blank optional fields stay blank; empty initials print a dash", () => {
    const s = sheetSpec(420, 297, { id: "p", name: "X", panel_tag: "", rev: "A" }, "1:10");
    const texts = s.texts.map((t) => t.text);
    expect(texts).not.toContain("undefined");
    expect(texts.filter((t) => t === "-").length).toBeGreaterThanOrEqual(4); // BY/CHK/ENG/APPR dashes
  });

  it("all geometry stays on the page", () => {
    const s = spec();
    for (const l of s.lines) {
      for (const v of [l.x1, l.x2]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(420); }
      for (const v of [l.y1, l.y2]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(297); }
    }
  });
});
