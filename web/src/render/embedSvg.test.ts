import { describe, it, expect } from "vitest";
import { embedPartSvg } from "./embedSvg";

// shaped like the real ezdxf SVGBackend output (prolog, dark bg rect, .Cn classes)
const EZ = `<?xml version='1.0' encoding='utf-8'?>
<svg xmlns="http://www.w3.org/2000/svg" width="70mm" height="100mm" viewBox="0 0 7000 10000">` +
  `<defs><style>.C1 {stroke: #ffffff; stroke-width: 167; fill: none;}</style>` +
  `<style>.C2 {stroke: none; fill: #ffffff;}</style>` +
  `<style>.C3 {stroke: none; fill: #ff0000;}</style>` +
  `<clipPath id="clip0"><rect x="0" y="0" width="7000" height="10000"/></clipPath></defs>` +
  `<rect fill="#212830" x="0" y="0" width="7000" height="10000" fill-opacity="1.0" />` +
  `<g clip-path="url(#clip0)"><path class="C1" d="M0 0 L7000 10000"/>` +
  `<rect class="C2" x="100" y="100" width="500" height="500"/>` +
  `<circle class="C3" cx="3500" cy="5000" r="300" stroke="#00ff00" fill="#0000ff"/></g></svg>`;

const box = { x: 10, y: 20, w: 70, h: 100 };

describe("embedPartSvg", () => {
  it("maps the viewBox onto the box and rotates about the footprint centre", () => {
    const g = embedPartSvg(EZ, "e1-", box, 90, 10 + 50, 20 + 35)!; // 90°: footprint 100×70
    expect(g).toContain(`translate(60 55) rotate(90) scale(${70 / 7000} ${100 / 10000}) translate(-3500 -5000)`);
    expect(g.startsWith("<g transform=")).toBe(true);
  });

  it("drops the background rect, keeps the geometry", () => {
    const g = embedPartSvg(EZ, "e1-", box, 0, 45, 70)!;
    expect(g).not.toContain("#212830");
    expect(g).toContain("<path");
    expect(g).toContain("<circle");
    expect(g).not.toContain("<?xml"); // prolog stripped with the outer <svg>
  });

  it("plots monochrome: strokes black, coloured fills black, white fills stay (masks)", () => {
    const g = embedPartSvg(EZ, "e1-", box, 0, 45, 70)!;
    expect(g).toContain("stroke: #111111");            // .C1 white stroke → black
    expect(g).toContain("fill: #ffffff");              // .C2 white fill stays (mask)
    expect(g).not.toContain("#ff0000");                // .C3 red fill → black
    expect(g).toContain(`stroke="#111111"`);           // attr form too
    expect(g).toContain(`fill="#111111"`);
    expect(g).not.toContain("#0000ff");
  });

  it("namespaces classes and ids so two embedded parts can't collide", () => {
    const g = embedPartSvg(EZ, "e1-", box, 0, 45, 70)!;
    expect(g).toContain(".e1-C1 {");
    expect(g).toContain(`class="e1-C1"`);
    expect(g).toContain(`id="e1-clip0"`);
    expect(g).toContain(`url(#e1-clip0)`);
    expect(g).not.toMatch(/class="C\d"/);
  });

  it("strips executable content — shared layouts render in anonymous browsers", () => {
    const evil = `<svg viewBox="0 0 100 100">` +
      `<script>alert(1)</script>` +
      `<image href="x" onload="alert(2)" width="10" height="10"/>` +
      `<circle cx="5" cy="5" r="2" onclick='alert(3)'/>` +
      `<foreignObject><body onload="alert(4)"></body></foreignObject>` +
      `<a href="javascript:alert(5)"><rect width="9" height="9"/></a>` +
      `<a xlink:href=" javascript:alert(6)"><path d="M0 0"/></a></svg>`;
    const g = embedPartSvg(evil, "s-", box, 0, 45, 70)!;
    expect(g).not.toContain("<script");
    expect(g).not.toContain("onload");
    expect(g).not.toContain("onclick");
    expect(g).not.toContain("foreignObject");
    expect(g).not.toContain("javascript:");
    expect(g).toContain("<circle");     // the geometry itself survives
    expect(g).toContain("<rect");
  });

  it("returns null on garbage (caller keeps the plain rectangle)", () => {
    expect(embedPartSvg("<svg>no viewbox</svg>", "n", box, 0, 0, 0)).toBeNull();
    expect(embedPartSvg("not svg at all", "n", box, 0, 0, 0)).toBeNull();
    expect(embedPartSvg(`<svg viewBox="0 0 0 0"></svg>`, "n", box, 0, 0, 0)).toBeNull();
  });
});
