/**
 * The right panel: per-entity editors (element / duct / set / label), the plate +
 * title-block fields, row heights and the validation list. Extracted verbatim from
 * App.tsx (ROADMAP #8). Selection-derived values, rows and validation are computed
 * here; the model, library and selection state live in App.
 */
import { useMemo } from "react";
import type { Library, RectLibItem, LayoutModel } from "../model/types";
import { STOPPER_BANDS, byName } from "../model/library";
import { validate } from "../model/validate";
import { detectRows, setRowHeight, centerRowDevices, packRow, type RowResizeMode } from "../model/rows";
import {
  updateElement, updateDuct, updateGroup, updateLabel,
  setRotation, fitDuctWidth, explodeGroup, addLabel, addElement,
} from "../model/edit";
import { selectRow } from "../model/marquee";
import type { Selection } from "./FabricStage";

export interface InsertTarget { kind: "element" | "group"; id: string; name: string }

interface Props {
  model: LayoutModel;
  library: Library;
  set: (m: LayoutModel) => void;
  setLibrary: React.Dispatch<React.SetStateAction<Library>>;
  selections: Selection[];
  setSelections: (s: Selection[]) => void;
  rowMode: RowResizeMode;
  setRowMode: (m: RowResizeMode) => void;
  deleteSelected: () => void;
  setLibBomField: (libKey: string, patch: { manufacturer?: string; model?: string; description?: string }) => void;
  onInsertFor: (t: InsertTarget) => void;
}

export default function PropertiesPanel({
  model, library, set, setLibrary, selections, setSelections,
  rowMode, setRowMode, deleteSelected, setLibBomField, onInsertFor,
}: Props) {
  const issues = useMemo(() => validate(model, library), [model, library]);
  const rows = useMemo(() => detectRows(model), [model]);

  // exactly-one selection drives the per-entity editor; >1 shows a multi panel
  const single = selections.length === 1 ? selections[0] : null;
  const multi = selections.length > 1;
  const selEl = single?.kind === "element" ? model.elements.find((e) => e.id === single.id) ?? null : null;
  const selItem = selEl ? library[selEl.lib_key] : undefined;
  const selIsLabel = selItem?.source === "rect" && selItem.label_plate === true;
  const selDuct = single?.kind === "duct" ? model.ducts.find((d) => d.id === single.id) ?? null : null;
  const selGroup = single?.kind === "group" ? model.groups.find((g) => g.id === single.id) ?? null : null;
  const selLabel = single?.kind === "label" ? model.labels.find((l) => l.id === single.id) ?? null : null;

  function rotateSelected() {
    if (!single || (single.kind !== "element" && single.kind !== "group")) return;
    const cur = selEl?.rot_deg ?? selGroup?.rot_deg ?? 0;
    set(setRotation(model, single.kind, single.id, cur + 90));
  }

  function addPartLabel(kind: "element" | "group", refId: string) {
    const { model: m2, id } = addLabel(model, kind, refId);
    set(m2);
    setSelections([{ id, kind: "label" }]);
  }

  /**
   * Add a same-size label plate onto the selected stopper (a part in a Stopper /
   * Slim-Stopper category) as a LOCKED PAIR: they move / rotate / delete together
   * but stay two parts (1 stopper + 1 label). The label is selected so you can type
   * its marker straight away.
   */
  function addLabelPlate() {
    if (!selEl) return;
    const stopper = library[selEl.lib_key];
    if (!stopper) return;
    const lkey = `lbl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const labelItem: RectLibItem = {
      lib_key: lkey, source: "rect", name: "", label_plate: true,
      width_mm: stopper.width_mm, height_mm: stopper.height_mm,
    };
    const lib2 = { ...library, [lkey]: labelItem };
    const pid = `pair_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const r = addElement(model, lkey, lib2, selEl.x_mm, selEl.y_mm);
    let m = updateElement(r.model, selEl.id, { pair_id: pid });
    m = updateElement(m, r.id, { pair_id: pid, rot_deg: selEl.rot_deg });
    setLibrary(lib2);
    set(m);
    setSelections([{ id: r.id, kind: "element" }]);
  }

  return (
    <aside className="panel">
      {multi ? (
        <>
          <h3>{selections.length} objects selected</h3>
          <p className="muted small">
            Shift+drag to sweep more (left→right = fully inside; right→left = touching), Shift-click to
            add/remove one, Ctrl+A = all, Esc = clear. Arrow keys nudge (Shift = 10mm), Delete removes all.
          </p>
          <button type="button" className="danger" onClick={deleteSelected}>Delete {selections.length} objects</button>
        </>
      ) : selEl ? (
        <>
          <h3>Element</h3>
          {(() => {
            const it = library[selEl.lib_key];
            if (it && it.source === "rect" && it.custom) {
              const patch = (p: Partial<RectLibItem>) =>
                setLibrary((l) => ({ ...l, [selEl.lib_key]: { ...(l[selEl.lib_key] as RectLibItem), ...p } }));
              return (
                <>
                  <Field label="Part No" value={it.name} onChange={(v) => patch({ name: v })} />
                  <Num label="Width (mm)" value={it.width_mm} onChange={(v) => patch({ width_mm: v })} />
                  <Num label="Height (mm)" value={it.height_mm} onChange={(v) => patch({ height_mm: v })} />
                </>
              );
            }
            return <Row label="Library"><span className="ro">{it?.name ?? selEl.lib_key}</span></Row>;
          })()}
          <Field label="Tag" value={selEl.tag} onChange={(v) => set(updateElement(model, selEl.id, { tag: v }))} />
          <Num label="X (mm)" value={selEl.x_mm} onChange={(v) => set(updateElement(model, selEl.id, { x_mm: v }))} />
          <Num label="Y (mm)" value={selEl.y_mm} onChange={(v) => set(updateElement(model, selEl.id, { y_mm: v }))} />
          <Num label="Gap before (mm)" value={selEl.gap_before_mm} step={0.1} onChange={(v) => set(updateElement(model, selEl.id, { gap_before_mm: v }))} />
          <Num label="Duct clearance (mm)" value={selEl.clearance_to_duct_mm} step={0.5} onChange={(v) => set(updateElement(model, selEl.id, { clearance_to_duct_mm: v }))} />
          <Num label="Rail offset (mm)" step={0.5}
            value={library[selEl.lib_key]?.rail_offset_mm ?? ((library[selEl.lib_key]?.height_mm ?? 0) / 2)}
            onChange={(v) => setLibrary((l) => ({ ...l, [selEl.lib_key]: { ...l[selEl.lib_key], rail_offset_mm: v } }))} />
          <Row label="Rotation"><span className="ro">{selEl.rot_deg}°</span> <button type="button" onClick={rotateSelected}>+90°</button></Row>
          {selItem && !selIsLabel && (
            <>
              <p className="bom-fields-head">BOM details <span>(shown in the Bill of Materials)</span></p>
              <Field label="Manufacturer" value={selItem.manufacturer ?? ""} onChange={(v) => setLibBomField(selEl.lib_key, { manufacturer: v })} />
              <Field label="Model" value={selItem.model ?? ""} onChange={(v) => setLibBomField(selEl.lib_key, { model: v })} />
              <Field label="Description" value={selItem.description ?? ""} onChange={(v) => setLibBomField(selEl.lib_key, { description: v })} />
            </>
          )}
          <div className="panel-actions">
            <button type="button" title="Insert a part beside this one — the row shifts open automatically"
              onClick={() => onInsertFor({ kind: "element", id: selEl.id, name: library[selEl.lib_key]?.name ?? selEl.lib_key })}>⇤⇥ Insert beside…</button>
            <button type="button" title="Select every device on this rail line (then arrow-nudge or delete the pack)"
              onClick={() => setSelections(selectRow(model, library, { id: selEl.id, kind: "element" }))}>⬌ Select row</button>
            {STOPPER_BANDS.has(library[selEl.lib_key]?.band ?? -1) && (
              <button type="button" title="Drop a same-size label plate on this stopper (locked pair)" onClick={addLabelPlate}>Add label plate</button>
            )}
            <button type="button" onClick={() => addPartLabel("element", selEl.id)}>+ Label</button>
            <button type="button" className="danger" onClick={deleteSelected}>Delete</button>
          </div>
        </>
      ) : selDuct ? (
        <>
          <h3>Wire duct</h3>
          <Num label="X (mm)" value={selDuct.x_mm} onChange={(v) => set(updateDuct(model, selDuct.id, { x_mm: v }))} />
          <Num label="Y (mm)" value={selDuct.y_mm} onChange={(v) => set(updateDuct(model, selDuct.id, { y_mm: v }))} />
          <Num label="Length (mm)" value={selDuct.length_mm} onChange={(v) => set(updateDuct(model, selDuct.id, { length_mm: v }))} />
          <Num label="Width (mm)" value={selDuct.width_mm} onChange={(v) => set(updateDuct(model, selDuct.id, { width_mm: v }))} />
          <Num label="Label H (mm)" value={selDuct.label_h_mm} onChange={(v) => set(updateDuct(model, selDuct.id, { label_h_mm: v }))} />
          <div className="panel-actions">
            {selDuct.rot_deg % 180 === 0 && (
              <button type="button" title="Re-span this duct exactly between the side ducts" onClick={() => set(fitDuctWidth(model, selDuct.id))}>Fit width</button>
            )}
            <button type="button" className="danger" onClick={deleteSelected}>Delete</button>
          </div>
        </>
      ) : selGroup ? (
        <>
          <h3>Set ×{selGroup.count}</h3>
          <Row label="Library"><span className="ro">{library[selGroup.lib_key]?.name ?? selGroup.lib_key}</span></Row>
          <Num label="X (mm)" value={selGroup.x_mm} onChange={(v) => set({ ...model, groups: model.groups.map((g) => g.id === selGroup.id ? { ...g, x_mm: v } : g) })} />
          <Num label="Y (mm)" value={selGroup.y_mm} onChange={(v) => set({ ...model, groups: model.groups.map((g) => g.id === selGroup.id ? { ...g, y_mm: v } : g) })} />
          <Num label="Count" value={selGroup.count} onChange={(v) => set({ ...model, groups: model.groups.map((g) => g.id === selGroup.id ? { ...g, count: Math.max(1, Math.floor(v)) } : g) })} />
          <Num label="Internal gap (mm)" value={selGroup.internal_gap_mm} step={0.1} onChange={(v) => set({ ...model, groups: model.groups.map((g) => g.id === selGroup.id ? { ...g, internal_gap_mm: v } : g) })} />
          <Row label="Rotation"><span className="ro">{selGroup.rot_deg}°</span> <button type="button" onClick={rotateSelected}>+90°</button></Row>
          {/* caps flanking the run (end covers etc.) — editable on an existing set */}
          <Row label="Start cap">
            <select value={selGroup.cap_start_key ?? ""} onChange={(e) => set(updateGroup(model, selGroup.id, { cap_start_key: e.target.value || null }))}>
              <option value="">— none —</option>
              {Object.values(library).filter((it) => !(it.source === "rect" && it.label_plate)).sort(byName)
                .map((it) => <option key={it.lib_key} value={it.lib_key}>{it.name || "(unnamed)"}</option>)}
            </select>
          </Row>
          <Row label="End cap">
            <select value={selGroup.cap_end_key ?? ""} onChange={(e) => set(updateGroup(model, selGroup.id, { cap_end_key: e.target.value || null }))}>
              <option value="">— none —</option>
              {Object.values(library).filter((it) => !(it.source === "rect" && it.label_plate)).sort(byName)
                .map((it) => <option key={it.lib_key} value={it.lib_key}>{it.name || "(unnamed)"}</option>)}
            </select>
          </Row>
          <div className="panel-actions">
            <button type="button" title="Insert a part beside this set — the row shifts open automatically"
              onClick={() => onInsertFor({ kind: "group", id: selGroup.id, name: `set ${library[selGroup.lib_key]?.name ?? selGroup.lib_key}` })}>⇤⇥ Insert beside…</button>
            <button type="button" title="Select every device on this rail line (then arrow-nudge or delete the pack)"
              onClick={() => setSelections(selectRow(model, library, { id: selGroup.id, kind: "group" }))}>⬌ Select row</button>
            <button type="button" onClick={() => addPartLabel("group", selGroup.id)}>+ Label</button>
            <button type="button" onClick={() => { set(explodeGroup(model, selGroup.id, library)); setSelections([]); }}>Explode</button>
            <button type="button" className="danger" onClick={deleteSelected}>Delete</button>
          </div>
        </>
      ) : selLabel ? (
        <>
          <h3>Label</h3>
          <Field label="Text" value={selLabel.text} onChange={(v) => set(updateLabel(model, selLabel.id, { text: v }))} />
          <Row label="Anchored to"><span className="ro">{selLabel.anchor}</span></Row>
          <p className="muted small">Drag the label on the plate to reposition it relative to its part.</p>
          <button type="button" className="danger" onClick={deleteSelected}>Delete</button>
        </>
      ) : (
        <>
          <h3>Plate</h3>
          <Num label="Width (mm)" value={model.plate.width_mm} onChange={(v) => v > 0 && set({ ...model, plate: { ...model.plate, width_mm: v } })} />
          <Num label="Height (mm)" value={model.plate.height_mm} onChange={(v) => v > 0 && set({ ...model, plate: { ...model.plate, height_mm: v } })} />
          <p className="muted small">Adjust the mounting-plate size, then press <strong>Fit</strong> to recenter the view. Select an item to edit it, or click/drag a library part to add one.</p>

          <h3 className="mt">Title block</h3>
          <p className="muted small">Prints on the PDF/PNG sheet and the DXF "A3 SHEET" layout. Blank fields stay blank.</p>
          {(() => {
            const setProj = (patch: Partial<LayoutModel["project"]>) =>
              set({ ...model, project: { ...model.project, ...patch } });
            return (
              <>
                <Field label="Title line 2" value={model.project.title2 ?? ""} onChange={(v) => setProj({ title2: v })} />
                <Field label="Project no." value={model.project.project_no ?? ""} onChange={(v) => setProj({ project_no: v })} />
                <Field label="Drawing no." value={model.project.drawing_no ?? ""} onChange={(v) => setProj({ drawing_no: v })} />
                <Field label="Sheet" value={model.project.sheet_no ?? ""} onChange={(v) => setProj({ sheet_no: v })} />
                <Field label="Rev" value={model.project.rev} onChange={(v) => setProj({ rev: v })} />
                <Field label="Rev date" value={model.project.date ?? ""} onChange={(v) => setProj({ date: v })} />
                <Field label="Rev description" value={model.project.rev_desc ?? ""} onChange={(v) => setProj({ rev_desc: v })} />
                <Field label="By" value={model.project.by ?? ""} onChange={(v) => setProj({ by: v })} />
                <Field label="Chk" value={model.project.chk ?? ""} onChange={(v) => setProj({ chk: v })} />
                <Field label="Eng" value={model.project.eng ?? ""} onChange={(v) => setProj({ eng: v })} />
                <Field label="Appr" value={model.project.appr ?? ""} onChange={(v) => setProj({ appr: v })} />
                <Field label="Client" value={model.project.client ?? ""} onChange={(v) => setProj({ client: v })} />
                <Field label="Designer" value={model.project.designer ?? ""} onChange={(v) => setProj({ designer: v })} />
              </>
            );
          })()}

          {rows.length > 0 && (
            <>
              <h3 className="mt">Rows ({rows.length})</h3>
              <Row label="Resize mode">
                <select value={rowMode} onChange={(e) => setRowMode(e.target.value as RowResizeMode)}>
                  <option value="push">Push below</option>
                  <option value="borrow">Borrow from next</option>
                </select>
              </Row>
              <p className="muted small">
                {rowMode === "push"
                  ? "Push below: the duct below moves and everything beneath shifts (plate unchanged; bottom content may go off-plate)."
                  : "Borrow from next: the next row shrinks/grows by the same amount, keeping the total height fixed."}
              </p>
              {rows.map((r, i) => (
                <div key={i} className="prow">
                  <span className="plabel">Row {i + 1} (mm)</span>
                  <span className="pval">
                    <input type="number" step={5} value={r.height}
                      onChange={(e) => { const v = parseFloat(e.target.value); if (!Number.isNaN(v) && v > 0) set(setRowHeight(model, i, v, rowMode)); }} />
                    <button type="button" title="Auto-pack this row from the left duct" onClick={() => set(packRow(model, library, i).model)}>Pack</button>
                    <button type="button" title="Centre this row's devices vertically" onClick={() => set(centerRowDevices(model, library, i))}>↕</button>
                  </span>
                </div>
              ))}
            </>
          )}
        </>
      )}

      <h3 className="mt">Validation</h3>
      {issues.length === 0 ? <p className="ok">No issues — model is clean.</p> : (
        <ul className="issues">
          {issues.map((i, n) => <li key={n} className={i.level}><code>{i.code}</code> {i.message}</li>)}
        </ul>
      )}
    </aside>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="prow"><span className="plabel">{label}</span><span className="pval">{children}</span></div>;
}
function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <Row label={label}><input type="text" value={value} onChange={(e) => onChange(e.target.value)} /></Row>;
}
function Num({ label, value, step = 1, onChange }: { label: string; value: number; step?: number; onChange: (v: number) => void }) {
  return <Row label={label}><input type="number" step={step} value={value} onChange={(e) => { const n = parseFloat(e.target.value); if (!Number.isNaN(n)) onChange(n); }} /></Row>;
}
