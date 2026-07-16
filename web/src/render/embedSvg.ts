/**
 * Embed an uploaded part's SVG (the ezdxf render captured at upload, `svg_ref`)
 * into the export drawing, so PDF/PNG/SVG show the part's REAL vector linework —
 * like a monochrome CAD plot — instead of a bare footprint rectangle.
 *
 * Split into DEFINE-once / USE-many (RISK_REVIEW R2-4): a real layout places the
 * same terminal drawing hundreds of times, and duplicating the full artwork per
 * placement made exports multi-megabyte and froze the browser in svg2pdf. Each
 * distinct part is now built ONCE (`buildPartDef` → a `<g id>` for `<defs>`) and
 * every placement is a one-line `<use>` with just a transform (`placePartUse`).
 *
 * The service SVG comes ezdxf-styled for a dark screen: an opaque background
 * rect and CAD colours (often white strokes) via document-global classes
 * (`.C1{…}`). Building a definition therefore:
 *   1. strips the XML prolog and the full-bleed background rect,
 *   2. maps every stroke/fill colour to print black — EXCEPT white fills, which
 *      are masks (wipeouts) and stay white (same rule as a monochrome plot),
 *   3. strips anything executable (scripts / on* handlers / foreignObject /
 *      javascript: URLs) — svg_ref can arrive via a hand-edited layout import
 *      and shared layouts render in ANONYMOUS viewers' browsers (share links),
 *   4. namespaces classes and ids per definition so two parts can't collide.
 *
 * Pure string→string, unit-tested; parse failure returns null and the caller
 * keeps the plain rectangle (never a broken drawing).
 */

export interface EmbedBox { x: number; y: number; w: number; h: number }

/** A reusable part definition: the `<defs>` entry + its source viewBox. */
export interface PartDef {
  id: string;
  def: string;
  minx: number;
  miny: number;
  vbw: number;
  vbh: number;
}

const BLACK = "#111111";
const HEX = /#[0-9a-fA-F]{3,8}\b/;

const isWhite = (c: string) => /^#(fff|ffffff|ffffffff)$/i.test(c) || c.toLowerCase() === "white";

/** Monochrome-plot colour mapping on one CSS/attr colour token. */
function plotColor(c: string, kind: "stroke" | "fill"): string {
  if (kind === "fill" && isWhite(c)) return "#ffffff"; // masks stay white
  return BLACK;
}

/** Recolour both attribute (`stroke="#x"`) and CSS (`stroke: #x`) forms. */
function monochrome(s: string): string {
  return s
    .replace(new RegExp(`stroke="(${HEX.source})"`, "g"), () => `stroke="${BLACK}"`)
    .replace(new RegExp(`stroke:\\s*(${HEX.source})`, "g"), () => `stroke: ${BLACK}`)
    .replace(new RegExp(`fill="(${HEX.source})"`, "g"), (_m, c: string) => `fill="${plotColor(c, "fill")}"`)
    .replace(new RegExp(`fill:\\s*(${HEX.source})`, "g"), (_m, c: string) => `fill: ${plotColor(c, "fill")}`);
}

/** Strip anything executable — svg_ref is treated as untrusted markup. */
function sanitized(s: string): string {
  return s
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/((?:xlink:)?href\s*=\s*")\s*javascript:[^"]*(")/gi, "$1#$2");
}

/** Prefix ezdxf's `C<n>` class names and any `id="…"` refs with the def's ns. */
function namespaced(s: string, ns: string): string {
  return s
    .replace(/\.C(\d+)\s*\{/g, `.${ns}C$1 {`)
    .replace(/class="C(\d+)"/g, `class="${ns}C$1"`)
    .replace(/id="/g, `id="${ns}`)
    .replace(/url\(#/g, `url(#${ns}`)
    .replace(/href="#/g, `href="#${ns}`);
}

/**
 * Build the once-per-part `<defs>` entry from a raw svg_ref. `defId` must be
 * unique per distinct part within one render (e.g. "pt0", "pt1", …).
 * Returns null when svgRef can't be parsed (caller keeps the plain rectangle).
 */
export function buildPartDef(svgRef: string, defId: string): PartDef | null {
  const vb = /viewBox="([-\d.eE]+)[ ,]+([-\d.eE]+)[ ,]+([-\d.eE]+)[ ,]+([-\d.eE]+)"/.exec(svgRef);
  if (!vb) return null;
  const [minx, miny, vbw, vbh] = [+vb[1], +vb[2], +vb[3], +vb[4]];
  if (!(vbw > 0) || !(vbh > 0)) return null;

  const open = svgRef.indexOf(">", svgRef.indexOf("<svg"));
  const close = svgRef.lastIndexOf("</svg>");
  if (open < 0 || close < 0 || close <= open) return null;
  let inner = svgRef.slice(open + 1, close);

  // drop the opaque full-bleed background rect (the CAD screen colour)
  inner = inner.replace(
    new RegExp(`<rect fill="${HEX.source}" x="0" y="0" width="${vbw}" height="${vbh}"[^/>]*/>`),
    "",
  );
  inner = namespaced(monochrome(sanitized(inner)), `${defId}-`);
  return { id: defId, def: `<g id="${defId}">${inner}</g>`, minx, miny, vbw, vbh };
}

/**
 * One placement of a defined part: a `<use>` mapping the definition's viewBox
 * onto `box` (the UNROTATED part size at the element position), rotated by
 * `rotDeg` about the ROTATED footprint's centre `(fcx, fcy)` — identical
 * placement semantics to the editor's canvas overlay.
 */
export function placePartUse(
  d: PartDef, box: EmbedBox, rotDeg: number, fcx: number, fcy: number,
): string {
  const t = [
    `translate(${fcx} ${fcy})`,
    rotDeg % 360 !== 0 ? `rotate(${rotDeg % 360})` : "",
    `scale(${box.w / d.vbw} ${box.h / d.vbh})`,
    `translate(${-(d.minx + d.vbw / 2)} ${-(d.miny + d.vbh / 2)})`,
  ].filter(Boolean).join(" ");
  // both href forms: SVG2 for browsers, xlink for older parsers (svg2pdf et al.)
  return `<use href="#${d.id}" xlink:href="#${d.id}" transform="${t}"/>`;
}
