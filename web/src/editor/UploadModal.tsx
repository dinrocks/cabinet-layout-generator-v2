/**
 * Equipment upload confirm dialog (SKILL.md §3.1).
 *
 * Shows the SVG the service rendered (the picture) + the measured size; the
 * engineer picks a CATEGORY and CONFIRMs before the part joins the library, or
 * Cancels. When signed in, a checkbox offers to add it to the SHARED library.
 */
import { useState, useEffect } from "react";
import { BANDS } from "../model/library";
import type { UploadResult } from "../service/dxfClient";

/** BOM part data captured at upload (all optional — blank stays "-" in the BOM). */
export interface BomMeta {
  manufacturer: string;
  model: string;
  description: string;
}

interface Props {
  result: UploadResult;
  defaultName: string;
  /** true when signed in (cloud), so the part can be shared. */
  canShare: boolean;
  onConfirm: (name: string, shared: boolean, band: number, meta: BomMeta, railOffsetMm: number) => void;
  onCancel: () => void;
}

export default function UploadModal({ result, defaultName, canShare, onConfirm, onCancel }: Props) {
  const [name, setName] = useState(defaultName);
  const [shared, setShared] = useState(false);
  const [band, setBand] = useState<number>(BANDS[0].band);
  const [manufacturer, setManufacturer] = useState("");
  const [model, setModel] = useState("");
  const [description, setDescription] = useState("");
  // rail datum: prefer the DXF origin (from the service); else default to the centre
  const [railOffset, setRailOffset] = useState<number>(result.rail_offset_mm ?? result.height_mm / 2);
  const confirm = () => {
    if (name.trim()) onConfirm(name.trim(), canShare && shared, band, {
      manufacturer: manufacturer.trim(), model: model.trim(), description: description.trim(),
    }, railOffset);
  };

  // Esc closes (a deliberate keypress) — but a click outside does NOT, so a mis-click
  // never discards what you've typed.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);


  return (
    <div className="modal-overlay">
      <div className="modal">
        <h3>Confirm uploaded part</h3>

        <div className="upload-preview" dangerouslySetInnerHTML={{ __html: result.svg }} />

        <p className="measured">
          Measured <strong>{result.width_mm} × {result.height_mm} mm</strong>
        </p>
        {!result.units_confirmed && (
          <p className="warn-units">
            ⚠ Units not detected as mm (got: {result.units}). Confirm only if the size looks right.
          </p>
        )}

        <label className="prow">
          <span className="plabel">Rail line (mm from top)</span>
          <input type="number" step={0.5} value={railOffset} onChange={(e) => setRailOffset(Number(e.target.value))} />
        </label>
        <p className="rail-note">
          {result.rail_from_origin
            ? "From the DXF origin (0,0) — the DIN-rail datum. Devices in a row align on this line so their rail hooks match."
            : "Default: the part's centre (the DXF 0,0 wasn't inside the outline). Set this to the rail line so devices align by the rail."}
        </p>

        <label className="prow">
          <span className="plabel">Name</span>
          <input type="text" value={name} autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") confirm(); }} />
        </label>

        <label className="prow">
          <span className="plabel">Category</span>
          <select value={band} onChange={(e) => setBand(Number(e.target.value))}>
            {BANDS.map((b) => <option key={b.band} value={b.band}>{b.band}. {b.name}</option>)}
          </select>
        </label>

        <p className="bom-fields-head">BOM details <span>(optional — shown in the Bill of Materials; editable later)</span></p>
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
            placeholder="Full spec line — defaults to the name. e.g. MINIATURE CIRCUIT BREAKER PL9X, 2 POLES, 16A, RATED AC 230/400V, RATED BREAKING CAPACITY 6KA"
            onChange={(e) => {
              setDescription(e.target.value);
              e.currentTarget.style.height = "auto";
              e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 240)}px`;
            }} />
        </label>

        {canShare && (
          <label className="share-opt">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
            <span>Add to the <strong>shared library</strong> — keep it permanently, usable in every project by everyone.</span>
          </label>
        )}

        <div className="modal-actions">
          <button type="button" className="danger" onClick={onCancel}>Cancel</button>
          <button type="button" disabled={!name.trim()} onClick={confirm}>
            {canShare && shared ? "Add to shared library" : "Add to this project"}
          </button>
        </div>
      </div>
    </div>
  );
}
