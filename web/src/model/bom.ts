/**
 * BOM (Bill of Materials) — a deterministic parts count from the layout model.
 *
 * Pure + testable (CLAUDE.md §5): no Fabric/DOM. It counts exactly what is placed
 * and never invents a part or a quantity (CLAUDE.md §0). Each placed element counts
 * 1; a set (group) of N counts N. Parts aggregate by library identity and group by
 * category (BANDS).
 *
 * Two domain rules:
 *  - Label plates are minted per-instance (a unique `lib_key`, blank name) but are
 *    interchangeable markers, so they collapse into ONE "Label for stopper" line
 *    (qty = number placed) — matching the "4 stoppers + 1 label" intent.
 *  - `confirm` (an unconfirmed size estimate) is surfaced per row so the reviewer
 *    sees what isn't datasheet-verified before ordering.
 */
import type { LayoutModel, Library, LibItem } from "./types";
import { BANDS } from "./library";

export interface BomRow {
  /** Aggregation identity: a part's `lib_key`, or `__label__` for all label plates. */
  key: string;
  name: string;
  /** Category label (a BANDS name), "Labels", or "Uncategorized". */
  category: string;
  band: number | null;
  qty: number;
  width_mm: number;
  height_mm: number;
  /** True if any contributing item's size is an unconfirmed estimate. */
  confirm: boolean;
}

export interface Bom {
  rows: BomRow[]; // sorted by band (uncategorised last) then name
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

  const tally = (libKey: string, qty: number): void => {
    const item = library[libKey];
    if (!item || qty <= 0) return; // unresolved keys are flagged by validate(), not here
    const label = isLabelPlate(item);
    const key = label ? LABEL_KEY : libKey;
    const existing = byKey.get(key);
    if (existing) {
      existing.qty += qty;
      existing.confirm = existing.confirm || !!item.confirm;
      return;
    }
    const band = label ? null : item.band ?? null;
    byKey.set(key, {
      key,
      name: label ? "Label for stopper" : item.name || "(unnamed)",
      category: label ? "Labels" : bandName(band) ?? "Uncategorized",
      band,
      qty,
      width_mm: item.width_mm,
      height_mm: item.height_mm,
      confirm: !!item.confirm,
    });
  };

  for (const e of model.elements) tally(e.lib_key, 1);
  for (const g of model.groups) tally(g.lib_key, g.count);

  const rows = [...byKey.values()].sort((a, b) => {
    const ba = a.band ?? Number.MAX_SAFE_INTEGER;
    const bb = b.band ?? Number.MAX_SAFE_INTEGER;
    if (ba !== bb) return ba - bb;
    return a.name.localeCompare(b.name);
  });
  return { rows, totalParts: rows.reduce((s, r) => s + r.qty, 0) };
}

/** The BOM as CSV (header + one row per part). Excel-friendly (CRLF, quoted cells). */
export function bomToCsv(bom: Bom): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = ["Category,Part,Qty,Width_mm,Height_mm,Unconfirmed"];
  for (const r of bom.rows) {
    lines.push(
      [esc(r.category), esc(r.name), String(r.qty), String(r.width_mm), String(r.height_mm), r.confirm ? "yes" : ""].join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}
