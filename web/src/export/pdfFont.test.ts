import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { jsPDF } from "jspdf";
import { registerThaiFont, PDF_FONT } from "./pdfFont";

// the bundled font, straight from disk (the browser path fetches the same asset)
const b64 = readFileSync(join(__dirname, "../assets/Sarabun-Regular.ttf")).toString("base64");

const THAI_TITLE = "แบบแปลนตู้ควบคุม"; // "control-cabinet layout drawing"

describe("registerThaiFont", () => {
  it("registers Sarabun on the jsPDF instance", () => {
    const pdf = new jsPDF();
    registerThaiFont(pdf, b64);
    expect(Object.keys(pdf.getFontList())).toContain(PDF_FONT);
    expect(pdf.getFont().fontName).toBe(PDF_FONT); // set as the active font too
  });

  it("embeds a (subset) font program so Thai text survives into the PDF bytes", () => {
    const bare = new jsPDF(); // helvetica default — the pre-fix behaviour
    bare.text(THAI_TITLE, 20, 20);
    const bareLen = bare.output("arraybuffer").byteLength;

    const pdf = new jsPDF();
    registerThaiFont(pdf, b64);
    pdf.text(THAI_TITLE, 20, 20);
    const out = pdf.output("arraybuffer");
    const s = Buffer.from(out).toString("latin1");
    expect(s).toContain("Sarabun");                    // font resource present
    expect(s).toContain("ToUnicode");                  // extractable text mapping
    expect(out.byteLength).toBeGreaterThan(bareLen + 10_000); // glyph program embedded
    expect(Buffer.from(bare.output("arraybuffer")).toString("latin1")).not.toContain("Sarabun");
  });
});
