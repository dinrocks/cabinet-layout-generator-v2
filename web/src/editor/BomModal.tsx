/**
 * BOM (Bill of Materials) dialog — a deterministic parts count from the current
 * layout (model/bom.ts). Read-only: it counts what's placed and never edits. The
 * engineer reviews here and downloads a CSV for ordering. (CLAUDE.md §0/§5.)
 */
import { useMemo } from "react";
import type { LayoutModel, Library } from "../model/types";
import { buildBom, bomToCsv, itemNo } from "../model/bom";

const dash = (s: string) => (s && s.trim() ? s : "-");

interface Props {
  model: LayoutModel;
  library: Library;
  onClose: () => void;
}

export default function BomModal({ model, library, onClose }: Props) {
  const bom = useMemo(() => buildBom(model, library), [model, library]);

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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal bom-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Bill of Materials</h3>

        {bom.rows.length === 0 ? (
          <p className="bom-empty">No parts placed yet — add equipment to the plate first.</p>
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

        <p className="bom-note">
          ITEM NO. lists each part's equipment tags. "-" = not entered (add Manufacturer/Model/Description on the
          part). * = unconfirmed size estimate — verify against the datasheet before ordering.
        </p>

        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose}>Close</button>
          <button type="button" disabled={bom.rows.length === 0} onClick={downloadCsv}>Download CSV</button>
        </div>
      </div>
    </div>
  );
}
