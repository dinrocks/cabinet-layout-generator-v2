/**
 * BOM (Bill of Materials) — a deterministic parts count from the layout model,
 * shaped to the shop-drawing BOM: ITEM NO. (the equipment tags) · DESCRIPTION ·
 * MANUFACTURER · MODEL · QTY.
 *
 * Pure + testable (CLAUDE.md §5): no Fabric/DOM. It counts exactly what is placed
 * and surfaces only human-entered part data — it never invents a part, a quantity,
 * or a manufacturer/model (CLAUDE.md §0). Unentered fields render as "-".
 *
 * Rules:
 *  - Each placed element counts 1; a set (group) of N counts N (its auto-tags
 *    B101..B1NN are expanded into the tag list).
 *  - Parts aggregate by library identity; every contributing element's `tag` is
 *    collected into ITEM NO. (e.g. "FAN01, FAN02").
 *  - Label plates are minted per-instance, so they collapse into ONE "Label for
 *    stopper" line (qty = number placed).
 *  - `confirm` (an unconfirmed size estimate) is flagged per row.
 */
import type { LayoutModel, Library, LibItem } from "./types";
import { BANDS } from "./library";
import { stepTag } from "./edit";

export interface BomRow {
  /** Aggregation identity: a part's `lib_key`, or `__label__` for all label plates. */
  key: string;
  /** Equipment tags of every instance (the ITEM NO. column), sorted + de-duped. */
  tags: string[];
  /** Long spec line (item.description, else the short name). */
  description: string;
  manufacturer: string; // "" when not entered (renders as "-")
  model: string; // ""
  /** Category label (a BANDS name), "Labels", or "Uncategorized". */
  category: string;
  band: number | null;
  qty: number;
  /** True if any contributing item's size is an unconfirmed estimate. */
  confirm: boolean;
}

export interface Bom {
  rows: BomRow[]; // sorted by band (uncategorised last) then description
  totalParts: number; // Σ qty
}

const LABEL_KEY = "__label__";

function isLabelPlate(item: LibItem): boolean {
  return item.source === "rect" && item.label_plate === true;
}

const bandName = (band: number | null | undefined): string | null =>
  BANDS.find((b) => b.band === band)?.name ?? null;

/** Aggregate the placed parts (elements + set members) into a Bill of Materials. */
export function buildBom(model: LayoutModel, library: Library): Bom {
  const byKey = new Map<string, BomRow>();

  const tally = (libKey: string, qty: number, tags: string[]): void => {
    const item = library[libKey];
    if (!item || qty <= 0) return; // unresolved keys are flagged by validate(), not here
    const label = isLabelPlate(item);
    const key = label ? LABEL_KEY : libKey;
    const clean = tags.filter((t) => t && t.trim());
    const row = byKey.get(key);
    if (row) {
      row.qty += qty;
      row.confirm = row.confirm || !!item.confirm;
      for (const t of clean) if (!row.tags.includes(t)) row.tags.push(t);
      return;
    }
    const band = label ? null : item.band ?? null;
    byKey.set(key, {
      key,
      tags: [...new Set(clean)],
      description: label ? "Label for stopper" : item.description || item.name || "(unnamed)",
      manufacturer: label ? "" : item.manufacturer ?? "",
      model: label ? "" : item.model ?? "",
      category: label ? "Labels" : bandName(band) ?? "Uncategorized",
      band,
      qty,
      confirm: !!item.confirm,
    });
  };

  for (const e of model.elements) tally(e.lib_key, 1, [e.tag]);
  for (const g of model.groups) {
    const tags = g.tag_start ? Array.from({ length: g.count }, (_, i) => stepTag(g.tag_start!, i * g.tag_step)) : [];
    tally(g.lib_key, g.count, tags);
  }

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  for (const row of byKey.values()) row.tags.sort((a, b) => collator.compare(a, b));

  const rows = [...byKey.values()].sort((a, b) => {
    const ba = a.band ?? Number.MAX_SAFE_INTEGER;
    const bb = b.band ?? Number.MAX_SAFE_INTEGER;
    if (ba !== bb) return ba - bb;
    return a.description.localeCompare(b.description);
  });
  return { rows, totalParts: rows.reduce((s, r) => s + r.qty, 0) };
}

/** The ITEM NO. cell: the tags joined, or "-" when none were assigned. */
export function itemNo(row: BomRow): string {
  return row.tags.length ? row.tags.join(", ") : "-";
}

const dash = (s: string) => (s && s.trim() ? s : "-");

/** The BOM as CSV (header + one row per part). Excel-friendly (CRLF, quoted cells). */
export function bomToCsv(bom: Bom): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = ["Item No,Description,Manufacturer,Model,Qty"];
  for (const r of bom.rows) {
    lines.push(
      [esc(itemNo(r)), esc(dash(r.description)), esc(dash(r.manufacturer)), esc(dash(r.model)), String(r.qty)].join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}
