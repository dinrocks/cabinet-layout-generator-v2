/**
 * Edit an existing library part — the same fields captured at upload (Name,
 * Category, and the BOM details Manufacturer / Model / Description), so a part can
 * be corrected or filled in later. Size is shown read-only (it comes from the DXF
 * / the part's definition, not free-edited — CLAUDE.md §2). Closes deliberately
 * (Save / Cancel / Esc), never on an outside click, so edits aren't lost.
 */
import { useState, useEffect } from "react";
import { BANDS } from "../model/library";
import type { LibItem } from "../model/types";

export interface PartEdit {
  name: string;
  band: number;
  manufacturer: string;
  model: string;
  description: string;
}

interface Props {
  item: LibItem;
  /** true when the part is in the shared catalog (so saving updates it for everyone). */
  shared: boolean;
  onSave: (patch: PartEdit) => void;
  onCancel: () => void;
}

export default function EditPartModal({ item, shared, onSave, onCancel }: Props) {
  const [name, setName] = useState(item.name);
  const [band, setBand] = useState<number>(item.band ?? BANDS[0].band);
  const [manufacturer, setManufacturer] = useState(item.manufacturer ?? "");
  const [model, setModel] = useState(item.model ?? "");
  const [description, setDescription] = useState(item.description ?? "");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const save = () => {
    if (name.trim()) onSave({
      name: name.trim(), band, manufacturer: manufacturer.trim(), model: model.trim(), description: description.trim(),
    });
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h3>Edit part</h3>

        <p className="measured">
          Size <strong>{item.width_mm} × {item.height_mm} mm</strong>
          {item.source === "dxf" ? " (from the uploaded DXF)" : ""}
        </p>

        <label className="prow">
          <span className="plabel">Name</span>
          <input type="text" value={name} autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") save(); }} />
        </label>

        <label className="prow">
          <span className="plabel">Category</span>
          <select value={band} onChange={(e) => setBand(Number(e.target.value))}>
            {BANDS.map((b) => <option key={b.band} value={b.band}>{b.band}. {b.name}</option>)}
          </select>
        </label>

        <p className="bom-fields-head">BOM details <span>(shown in the Bill of Materials)</span></p>
        <label className="prow">
          <span className="plabel">Manufacturer</span>
          <input type="text" value={manufacturer} placeholder="e.g. MEANWELL" onChange={(e) => setManufacturer(e.target.value)} />
        </label>
        <label className="prow">
          <span className="plabel">Model</span>
          <input type="text" value={model} placeholder="e.g. NDR-120-24" onChange={(e) => setModel(e.target.value)} />
        </label>
        <label className="prow prow-col">
          <span className="plabel">Description</span>
          <textarea className="bom-desc" value={description} rows={2}
            placeholder="Full spec line — defaults to the name."
            onChange={(e) => {
              setDescription(e.target.value);
              e.currentTarget.style.height = "auto";
              e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 240)}px`;
            }} />
        </label>

        {shared && <p className="bom-note">In the shared library — saving updates it for everyone (admin only).</p>}

        <div className="modal-actions">
          <button type="button" className="danger" onClick={onCancel}>Cancel</button>
          <button type="button" disabled={!name.trim()} onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}
