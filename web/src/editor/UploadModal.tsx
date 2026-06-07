/**
 * Equipment upload confirm dialog (SKILL.md §3.1).
 *
 * Shows the SVG the service rendered (the picture) + the measured size; the
 * engineer CONFIRMs before the part joins the library, or Cancels. When signed in,
 * a checkbox offers to add it to the SHARED library (permanent, usable in every
 * project) vs. keep it to this project only.
 */
import { useState } from "react";
import type { UploadResult } from "../service/dxfClient";

interface Props {
  result: UploadResult;
  defaultName: string;
  /** true when signed in (cloud), so the part can be shared. */
  canShare: boolean;
  onConfirm: (name: string, shared: boolean) => void;
  onCancel: () => void;
}

export default function UploadModal({ result, defaultName, canShare, onConfirm, onCancel }: Props) {
  const [name, setName] = useState(defaultName);
  const [shared, setShared] = useState(false);
  const confirm = () => { if (name.trim()) onConfirm(name.trim(), canShare && shared); };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
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
          <span className="plabel">Name</span>
          <input type="text" value={name} autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") confirm(); }} />
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
