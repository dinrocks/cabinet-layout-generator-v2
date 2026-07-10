/// <reference types="node" />
// (node builtins are used only here — the app tsconfig stays vite/client-only)
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { jsPDF } from "jspdf";
import { registerThaiFont, PDF_FONT } from "./pdfFont";

// the bundled font, straight from disk (the browser path fetches the same asset)
const b64 = readFileSync(join(__dirname, "../assets/Sarabun-Regular.ttf")).toString("base64");

const THAI_TITLE = "แบบแปลนตู้ควบคุม"; // "control-cabinet layout drawing"

describe("registerThaiFont", () => {
  it("registers Sarabun but leaves Arial/helvetica the active default", () => {
    const pdf = new jsPDF();
    const before = pdf.getFont().fontName;
    registerThaiFont(pdf, b64);
    expect(Object.keys(pdf.getFontList())).toContain(PDF_FONT); // available for selection
    expect(pdf.getFont().fontName).toBe(before);                // but NOT made active
  });

  it("embeds a (subset) font program so Thai text survives into the PDF bytes", () => {
    const bare = new jsPDF(); // helvetica default — the pre-fix behaviour
    bare.text(THAI_TITLE, 20, 20);
    const bareLen = bare.output("arraybuffer").byteLength;

    const pdf = new jsPDF();
    registerThaiFont(pdf, b64);
    pdf.setFont(PDF_FONT); // svg2pdf selects it per Thai run; here we select explicitly
    pdf.text(THAI_TITLE, 20, 20);
    const out = pdf.output("arraybuffer");
    const s = Buffer.from(out).toString("latin1");
    expect(s).toContain("Sarabun");                    // font resource present
    expect(s).toContain("ToUnicode");                  // extractable text mapping
    expect(out.byteLength).toBeGreaterThan(bareLen + 10_000); // glyph program embedded
    expect(Buffer.from(bare.output("arraybuffer")).toString("latin1")).not.toContain("Sarabun");
  });
});
