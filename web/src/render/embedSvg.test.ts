import { describe, it, expect } from "vitest";
import { buildPartDef, placePartUse } from "./embedSvg";
import { renderPlateBody } from "./toSvg";
import { newModel } from "../model/factory";
import type { Library, LayoutModel } from "../model/types";

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

const box = { x: 30, y: 40, w: 70, h: 100 };

describe("buildPartDef", () => {
  it("drops the background rect, keeps the geometry, strips the prolog", () => {
    const d = buildPartDef(EZ, "pt0")!;
    expect(d.def.startsWith(`<g id="pt0">`)).toBe(true);
    expect(d.def).not.toContain("#212830");
    expect(d.def).toContain("<path");
    expect(d.def).toContain("<circle");
    expect(d.def).not.toContain("<?xml");
    expect([d.minx, d.miny, d.vbw, d.vbh]).toEqual([0, 0, 7000, 10000]);
  });

  it("plots monochrome: strokes black, coloured fills black, white fills stay (masks)", () => {
    const d = buildPartDef(EZ, "pt0")!;
    expect(d.def).toContain("stroke: #111111");            // .C1 white stroke → black
    expect(d.def).toContain("fill: #ffffff");              // .C2 white fill stays (mask)
    expect(d.def).not.toContain("#ff0000");                // .C3 red fill → black
    expect(d.def).toContain(`stroke="#111111"`);           // attr form too
    expect(d.def).toContain(`fill="#111111"`);
    expect(d.def).not.toContain("#0000ff");
  });

  it("namespaces classes and ids so two defined parts can't collide", () => {
    const d = buildPartDef(EZ, "pt7")!;
    expect(d.def).toContain(".pt7-C1 {");
    expect(d.def).toContain(`class="pt7-C1"`);
    expect(d.def).toContain(`id="pt7-clip0"`);
    expect(d.def).toContain(`url(#pt7-clip0)`);
    expect(d.def).not.toMatch(/class="C\d"/);
  });

  it("strips executable content — shared layouts render in anonymous browsers", () => {
    const evil = `<svg viewBox="0 0 100 100">` +
      `<script>alert(1)</script>` +
      `<image href="x" onload="alert(2)" width="10" height="10"/>` +
      `<circle cx="5" cy="5" r="2" onclick='alert(3)'/>` +
      `<foreignObject><body onload="alert(4)"></body></foreignObject>` +
      `<a href="javascript:alert(5)"><rect width="9" height="9"/></a>` +
      `<a xlink:href=" javascript:alert(6)"><path d="M0 0"/></a></svg>`;
    const d = buildPartDef(evil, "s0")!;
    expect(d.def).not.toContain("<script");
    expect(d.def).not.toContain("onload");
    expect(d.def).not.toContain("onclick");
    expect(d.def).not.toContain("foreignObject");
    expect(d.def).not.toContain("javascript:");
    expect(d.def).toContain("<circle");     // the geometry itself survives
    expect(d.def).toContain("<rect");
  });

  it("returns null on garbage (caller keeps the plain rectangle)", () => {
    expect(buildPartDef("<svg>no viewbox</svg>", "n")).toBeNull();
    expect(buildPartDef("not svg at all", "n")).toBeNull();
    expect(buildPartDef(`<svg viewBox="0 0 0 0"></svg>`, "n")).toBeNull();
  });
});

describe("placePartUse", () => {
  it("maps the viewBox onto the box, rotated about the footprint centre", () => {
    const d = buildPartDef(EZ, "pt0")!;
    const u = placePartUse(d, box, 90, 30 + 50, 40 + 35); // 90°: footprint 100×70
    expect(u).toContain(`href="#pt0"`);
    expect(u).toContain(`xlink:href="#pt0"`);
    expect(u).toContain(`translate(80 75) rotate(90) scale(${70 / 7000} ${100 / 10000}) translate(-3500 -5000)`);
  });
});

describe("define-once/use-many in the renderer (R2-4)", () => {
  it("N placements of one part = 1 def + N uses, defs first", () => {
    const lib: Library = {
      plc: { lib_key: "plc", source: "dxf", name: "PLC", width_mm: 70, height_mm: 100, block_ref: "b", svg_ref: EZ },
    };
    const el = (id: string, x: number) => ({
      id, lib_key: "plc", tag: "", x_mm: x, y_mm: 20, rot_deg: 0,
      gap_before_mm: 0.1, clearance_to_duct_mm: 3, group_id: null, locked: false,
    });
    const m: LayoutModel = { ...newModel("T"), plate: { width_mm: 900, height_mm: 300, origin: "top_left" } };
    m.elements = [el("a", 10), el("b", 110), el("c", 210)];
    m.groups = [{
      id: "g1", kind: "set", lib_key: "plc", count: 5, internal_gap_mm: 0.1,
      x_mm: 310, y_mm: 20, rot_deg: 0, tag_start: null, tag_step: 1,
      cap_start_key: null, cap_end_key: null, exploded: false, label_id: null,
    }];
    const body = renderPlateBody(m, lib);
    expect(body.match(/<g id="pt0">/g)).toHaveLength(1);          // defined once
    expect(body.match(/<use href="#pt0"/g)).toHaveLength(8);      // 3 elements + 5 members
    expect(body.indexOf("<defs>")).toBeLessThan(body.indexOf("<use ")); // forward-safe
    // the heavy artwork appears exactly once, not per placement
    expect(body.match(/M0 0 L7000 10000/g)).toHaveLength(1);
  });
});
