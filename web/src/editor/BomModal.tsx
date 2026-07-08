/**
 * BOM (Bill of Materials) dialog. The top table is the deterministic parts count
 * from the layout (model/bom.ts) — read-only. Below it, "manual BOM-only items"
 * (cabinet, name plates, lamp, fans, outlets) that aren't drawn on the plate but
 * belong on the sheet; those are editable and merge into the table + CSV. All BOM
 * data is human-entered — nothing invented (CLAUDE.md §0/§5).
 */
import { useEffect, useMemo, useState } from "react";
import type { LayoutModel, Library, BomExtra } from "../model/types";
import { buildBom, bomToCsv, itemNo } from "../model/bom";
import { downloadBomPdf } from "../export/inBrowser";
import type { Paper } from "../render/page";

const dash = (s: string) => (s && s.trim() ? s : "-");
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

interface Props {
  model: LayoutModel;
  library: Library;
  extras: BomExtra[];
  paper: Paper;
  onChangeExtras: (extras: BomExtra[]) => void;
  onClose: () => void;
}

export default function BomModal({ model, library, extras, paper, onChangeExtras, onClose }: Props) {
  const bom = useMemo(() => buildBom(model, library), [model, library]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const addExtra = () =>
    onChangeExtras([...extras, { id: uid(), item_no: "", description: "", manufacturer: "", model: "", qty: 1 }]);
  const patchExtra = (id: string, p: Partial<BomExtra>) =>
    onChangeExtras(extras.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const removeExtra = (id: string) => onChangeExtras(extras.filter((x) => x.id !== id));

  const downloadCsv = () => {
    const blob = new Blob([bomToCsv(bom)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(model.project.name || "layout").replace(/\s+/g, "_")}_BOM.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const downloadPdf = async () => {
    setBusy(true);
    try {
      await downloadBomPdf(model, library, paper);
    } catch (e) {
      alert(`BOM PDF failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal bom-modal">
        <h3>Bill of Materials</h3>

        {bom.rows.length === 0 ? (
          <p className="bom-empty">Nothing yet — place equipment on the plate, or add a manual item below.</p>
        ) : (
          <table className="bom-table">
            <thead>
              <tr>
                <th>Item No.</th><th>Description</th><th>Manufacturer</th><th>Model</th><th className="num">Qty</th>
              </tr>
            </thead>
            <tbody>
              {bom.rows.map((r) => (
                <tr key={r.key}>
                  <td className="bom-itemno">{itemNo(r)}</td>
                  <td>
                    {dash(r.description)}
                    {r.confirm && <span className="bom-est" title="Unconfirmed size estimate — verify against datasheet"> *</span>}
                  </td>
                  <td>{dash(r.manufacturer)}</td>
                  <td>{dash(r.model)}</td>
                  <td className="num">{r.qty}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={4}>Total parts</td><td className="num">{bom.totalParts}</td></tr>
            </tfoot>
          </table>
        )}

        <p className="bom-fields-head">
          Manual BOM-only items <span>(not on the plate — cabinet, name plates, lamp, fans, outlets)</span>
        </p>
        <table className="bom-table bom-extras-table">
          <thead>
            <tr>
              <th>Item No.</th><th>Description</th><th>Manufacturer</th><th>Model</th><th className="num">Qty</th><th />
            </tr>
          </thead>
          <tbody>
            {extras.map((x) => (
              <tr key={x.id}>
                <td><input value={x.item_no} placeholder="1 / FAN01" onChange={(e) => patchExtra(x.id, { item_no: e.target.value })} /></td>
                <td><input value={x.description} placeholder="e.g. RTU CABINET STEEL SHEET…" onChange={(e) => patchExtra(x.id, { description: e.target.value })} /></td>
                <td><input value={x.manufacturer} placeholder="LOCAL" onChange={(e) => patchExtra(x.id, { manufacturer: e.target.value })} /></td>
                <td><input value={x.model} onChange={(e) => patchExtra(x.id, { model: e.target.value })} /></td>
                <td className="num"><input type="number" min={0} value={x.qty} onChange={(e) => patchExtra(x.id, { qty: Math.max(0, Number(e.target.value) || 0) })} /></td>
                <td><button type="button" className="lib-mini" title="Remove" onClick={() => removeExtra(x.id)}>✕</button></td>
              </tr>
            ))}
            {extras.length === 0 && (
              <tr><td colSpan={6} className="bom-empty">None yet — add the cabinet, name plates, fans, etc.</td></tr>
            )}
          </tbody>
        </table>
        <button type="button" className="ghost bom-add" onClick={addExtra}>+ Add BOM-only item</button>

        <p className="bom-note">
          Device rows are counted from the plate. "-" = not entered (fill it in on the part). * = unconfirmed
          size estimate — verify against the datasheet before ordering.
        </p>

        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose}>Close</button>
          <button type="button" className="ghost" disabled={bom.rows.length === 0} onClick={downloadCsv}>Download CSV</button>
          <button type="button" disabled={bom.rows.length === 0 || busy} onClick={() => void downloadPdf()}>
            {busy ? "Making PDF…" : `PDF sheet (${paper})`}
          </button>
        </div>
      </div>
    </div>
  );
}
