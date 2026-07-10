/**
 * The left palette: DXF upload (button + drag-drop), the category bands, the
 * Objects block (ducts / custom part) and the Add-a-set form. Extracted verbatim
 * from App.tsx (ROADMAP #8). The add-set form's own field state lives here; the
 * library itself and the upload lifecycle stay in App.
 */
import { useRef, useState } from "react";
import { BANDS, byName } from "../model/library";
import type { Library } from "../model/types";
import type { UploadResult } from "../service/dxfClient";

export type Upload =
  | { status: "idle" }
  | { status: "uploading" }
  | { status: "confirm"; result: UploadResult; name: string }
  | { status: "error"; message: string };

export interface SetSpec {
  libKey: string;
  count: number;
  tagStart: string;
  capStart: string; // "" = no cap
  capEnd: string;
}

interface Props {
  library: Library;
  upload: Upload;
  svcOffline: boolean;
  onUploadFile: (f: File) => void;
  onUploadError: (message: string) => void;
  onDismissUploadError: () => void;
  onAddPart: (libKey: string) => void;
  onEditPart: (libKey: string) => void;
  onDeletePart: (libKey: string) => void;
  onAddDuct: (orientation: "horizontal" | "vertical") => void;
  onAddCustomPart: () => void;
  onAddSet: (spec: SetSpec) => void;
}

export default function LibrarySidebar({
  library, upload, svcOffline,
  onUploadFile, onUploadError, onDismissUploadError,
  onAddPart, onEditPart, onDeletePart, onAddDuct, onAddCustomPart, onAddSet,
}: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Add-Set form state
  const [setLibKey, setSetLibKey] = useState("term_degson_2c_2_5");
  const [setCount, setSetCount] = useState(12);
  const [setTagStart, setSetTagStart] = useState("B101");
  const [setCapStart, setSetCapStart] = useState(""); // "" = no cap
  const [setCapEnd, setSetCapEnd] = useState("");

  function acceptDroppedFile(files: FileList) {
    const f = [...files].find((file) => file.name.toLowerCase().endsWith(".dxf"));
    if (f) onUploadFile(f);
    else onUploadError("Please drop a single .dxf file.");
  }

  return (
    <aside className="library">
      <h3>Library</h3>

      <input ref={fileRef} type="file" accept=".dxf" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadFile(f); e.target.value = ""; }} />
      <button type="button" className={`upload-btn${dragOver ? " dragover" : ""}`} disabled={upload.status === "uploading"}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); acceptDroppedFile(e.dataTransfer.files); }}>
        {upload.status === "uploading" ? "Uploading… (waking service)"
          : dragOver ? "⬇ Drop .dxf here"
            : "⬆ Upload equipment DXF (or drop a .dxf here)"}
      </button>
      {upload.status === "error" && (
        <p className="upload-err">Upload failed: {upload.message} <button type="button" onClick={onDismissUploadError}>dismiss</button></p>
      )}
      {svcOffline && upload.status !== "error" && (
        <p className="upload-hint">⚠ DXF service offline — start it (port 8000) to upload/export. PDF/PNG/SVG work without it.</p>
      )}

      {BANDS.map((band) => {
        const items = Object.values(library).filter((it) => it.band === band.band).sort(byName);
        return (
          <div key={band.band} className="band">
            <div className="band-name">{band.band}. {band.name}</div>
            {items.map((it) => (
              <div key={it.lib_key} className="lib-row">
                <button type="button" className="lib-item" title={`${it.name || "(unnamed)"} · ${it.width_mm}×${it.height_mm} mm — click or drag to add`}
                  draggable onDragStart={(e) => e.dataTransfer.setData("text/lib-key", it.lib_key)}
                  onClick={() => onAddPart(it.lib_key)}>
                  {it.name || "(unnamed)"}{it.confirm ? " *" : ""}
                </button>
                <button type="button" className="lib-mini" title="Edit part (name, category, BOM details)" onClick={() => onEditPart(it.lib_key)}>✎</button>
                <button type="button" className="lib-mini" title="Delete from library" onClick={() => onDeletePart(it.lib_key)}>✕</button>
              </div>
            ))}
            {items.length === 0 && <p className="band-empty">— empty —</p>}
          </div>
        );
      })}
      <div className="addset">
        <div className="band-name">Objects</div>
        <button type="button" className="lib-item" onClick={() => onAddDuct("horizontal")}>+ Wire duct (row)</button>
        <button type="button" className="lib-item" onClick={() => onAddDuct("vertical")}>+ Wire duct (vertical)</button>
        <button type="button" className="lib-item" title="A blank device you size and name yourself (for parts without a CAD file)" onClick={onAddCustomPart}>+ Custom part</button>
      </div>

      <div className="addset">
        <div className="band-name">Add a set</div>
        <select value={setLibKey} onChange={(e) => setSetLibKey(e.target.value)}>
          {Object.values(library).sort(byName).map((it) => <option key={it.lib_key} value={it.lib_key}>{it.name}</option>)}
        </select>
        <div className="addset-row">
          <label>× <input type="number" min={1} value={setCount} onChange={(e) => setSetCount(Math.max(1, parseInt(e.target.value) || 1))} /></label>
          <label>tag <input type="text" value={setTagStart} onChange={(e) => setSetTagStart(e.target.value)} placeholder="B101" /></label>
        </div>
        {/* optional caps flanking the run (e.g. an end cover on a terminal strip) */}
        <label className="addset-cap">start
          <select value={setCapStart} onChange={(e) => setSetCapStart(e.target.value)}>
            <option value="">— none —</option>
            {Object.values(library).filter((it) => !(it.source === "rect" && it.label_plate)).sort(byName)
              .map((it) => <option key={it.lib_key} value={it.lib_key}>{it.name || "(unnamed)"}</option>)}
          </select>
        </label>
        <label className="addset-cap">end
          <select value={setCapEnd} onChange={(e) => setSetCapEnd(e.target.value)}>
            <option value="">— none —</option>
            {Object.values(library).filter((it) => !(it.source === "rect" && it.label_plate)).sort(byName)
              .map((it) => <option key={it.lib_key} value={it.lib_key}>{it.name || "(unnamed)"}</option>)}
          </select>
        </label>
        <button type="button" className="lib-item"
          onClick={() => onAddSet({ libKey: setLibKey, count: setCount, tagStart: setTagStart, capStart: setCapStart, capEnd: setCapEnd })}>
          Add set ×{setCount}
        </button>
      </div>

      <p className="muted small">* size is an unconfirmed estimate (replace via datasheet/DXF upload).</p>
    </aside>
  );
}
