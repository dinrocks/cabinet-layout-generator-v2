/**
 * Embed an uploaded part's SVG (the ezdxf render captured at upload, `svg_ref`)
 * into the export drawing, so PDF/PNG/SVG show the part's REAL vector linework —
 * like a monochrome CAD plot — instead of a bare footprint rectangle.
 *
 * The service SVG comes ezdxf-styled for a dark screen: an opaque background
 * rect and CAD colours (often white strokes) via document-global classes
 * (`.C1{…}`). Embedding therefore:
 *   1. strips the XML prolog and the full-bleed background rect,
 *   2. maps every stroke/fill colour to print black — EXCEPT white fills, which
 *      are masks (wipeouts) and stay white (same rule as a monochrome plot),
 *   3. namespaces classes and ids per instance so two parts can't collide,
 *   4. maps the viewBox onto the part's unrotated box, rotated about the
 *      footprint centre (identical placement semantics to the editor overlay).
 *
 * Pure string→string, unit-tested; parse failure returns null and the caller
 * keeps the plain rectangle (never a broken drawing).
 */

export interface EmbedBox { x: number; y: number; w: number; h: number }

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

/** Strip anything executable. svg_ref normally comes from our own service, but a
 *  layout JSON can be hand-edited and imported (⬆) — and shared layouts render in
 *  ANONYMOUS viewers' browsers (share links), so treat it as untrusted markup:
 *  no scripts, no event-handler attributes, no foreignObject, no js: URLs. */
function sanitized(s: string): string {
  return s
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/((?:xlink:)?href\s*=\s*")\s*javascript:[^"]*(")/gi, "$1#$2");
}

/** Prefix ezdxf's `C<n>` class names and any `id="…"` refs with the instance ns. */
function namespaced(s: string, ns: string): string {
  return s
    .replace(/\.C(\d+)\s*\{/g, `.${ns}C$1 {`)
    .replace(/class="C(\d+)"/g, `class="${ns}C$1"`)
    .replace(/id="/g, `id="${ns}`)
    .replace(/url\(#/g, `url(#${ns}`)
    .replace(/href="#/g, `href="#${ns}`);
}

/**
 * The part SVG as an embeddable `<g>` positioned on `box` (the UNROTATED part
 * size at the element position), rotated by `rotDeg` about the ROTATED
 * footprint's centre `(fcx, fcy)`. Returns null when svgRef can't be parsed.
 */
export function embedPartSvg(
  svgRef: string, ns: string, box: EmbedBox, rotDeg: number, fcx: number, fcy: number,
): string | null {
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
  inner = namespaced(monochrome(sanitized(inner)), ns);

  // centre-based mapping (same semantics as the editor's canvas overlay):
  // scale the viewBox onto the unrotated box, then rotate about the footprint centre
  const t = [
    `translate(${fcx} ${fcy})`,
    rotDeg % 360 !== 0 ? `rotate(${rotDeg % 360})` : "",
    `scale(${box.w / vbw} ${box.h / vbh})`,
    `translate(${-(minx + vbw / 2)} ${-(miny + vbh / 2)})`,
  ].filter(Boolean).join(" ");
  return `<g transform="${t}">${inner}</g>`;
}
