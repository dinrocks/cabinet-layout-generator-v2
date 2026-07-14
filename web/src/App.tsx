/**
 * The shell: editor state (model/history, library, selections, view) and the
 * wiring between the extracted pieces — Toolbar, LibrarySidebar, PropertiesPanel,
 * OpenDialog (ROADMAP #8) — plus the modals and the FabricStage canvas. Cloud
 * project state + handlers live in store/useCloudProjects.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { newModel } from "./model/factory";
import type { Library, DxfLibItem, RectLibItem } from "./model/types";
import { useAuth } from "./auth/AuthContext";
import { projectLocal } from "./store/projectStore";
import { useCloudProjects, type Status } from "./store/useCloudProjects";
import RevisionsModal from "./editor/RevisionsModal";
import { downloadLayout, pickLayoutFile } from "./store/localFile";
import { saveDraft, loadDraft, clearDraft } from "./store/draft";
import { listLibraryItems, addLibraryItem, updateLibraryItem, deleteLibraryItem } from "./store/libraryStore";
import { findOverlaps, tightClearances } from "./model/overlap";
import { setRowHeight, type RowResizeMode } from "./model/rows";
import {
  addElement, moveEntity, deleteEntity,
  updateElement, updateDuct, updateGroup, addSet, addDuct, updateLabel, ductDimsFromBox,
  type EntityKind,
} from "./model/edit";
import { useHistory } from "./editor/useHistory";
import FabricStage, { type Selection } from "./editor/FabricStage";
import Toolbar from "./editor/Toolbar";
import LibrarySidebar, { type Upload, type SetSpec } from "./editor/LibrarySidebar";
import PropertiesPanel, { type InsertTarget } from "./editor/PropertiesPanel";
import OpenDialog from "./editor/OpenDialog";
import UploadModal, { type BomMeta } from "./editor/UploadModal";
import BomModal from "./editor/BomModal";
import EditPartModal, { type PartEdit } from "./editor/EditPartModal";
import InsertModal from "./editor/InsertModal";
import { insertBeside } from "./model/insert";
import { exportDxf, uploadDxf, ping, type DxfScale } from "./service/dxfClient";
import { downloadSvg, downloadPng, downloadPdf } from "./export/inBrowser";
import { downloadBundle } from "./export/bundle";
import type { Paper } from "./render/page";
import "./App.css";

export default function App() {
  const { model, set, undo, redo, canUndo, canRedo } = useHistory(newModel("Untitled", "tall_floor"));
  const [library, setLibrary] = useState<Library>(() => ({})); // empty; populated by uploads
  const [selections, setSelections] = useState<Selection[]>([]);
  const [alignEnabled, setAlignEnabled] = useState(true); // rail-snap on drag
  const [zoom, setZoom] = useState(0.45); // px per mm (fit-to-view overrides on load)
  const [fitNonce, setFitNonce] = useState(0);
  const [dxfScale, setDxfScale] = useState<DxfScale>("1:100");
  const [paper, setPaper] = useState<Paper>("A3");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [upload, setUpload] = useState<Upload>({ status: "idle" });
  const [rowEdit, setRowEdit] = useState<{ index: number; x: number; y: number; value: number } | null>(null);
  const [rowMode, setRowMode] = useState<RowResizeMode>("push");

  // ── Phase 2: auth + cloud-saved projects ───────────────────────────────────
  const auth = useAuth();
  const ready = auth.status === "ready"; // signed in + allow-listed
  const [nameDraft, setNameDraft] = useState("");
  const [sharedLib, setSharedLib] = useState<Library>({}); // the shared equipment catalog (library_items)
  const [sharedLoaded, setSharedLoaded] = useState(false); // catalog fetch finished (gates draft restore)

  /** Load the shared library into state once signed in (everyone sees uploaded shared parts). */
  useEffect(() => {
    if (auth.status !== "ready") return;
    let alive = true;
    listLibraryItems().then((items) => {
      if (!alive) return;
      setSharedLib(items);
      setLibrary((l) => ({ ...l, ...items }));
      setSharedLoaded(true);
    });
    return () => { alive = false; };
  }, [auth.status]);

  // ── unsaved-changes guard (RISK_REVIEW R2) ──────────────────────────────────
  // "Dirty" = what a save would persist (model + project-local lib) differs from
  // the snapshot taken at the last save/open/new. Snapshot comparison means undo
  // back to the saved state reads as clean again.
  const sharedKeys = useMemo(() => new Set(Object.keys(sharedLib)), [sharedLib]);
  const snapshot = useMemo(
    () => JSON.stringify({ m: model, l: projectLocal(library, sharedKeys) }),
    [model, library, sharedKeys],
  );
  const [cleanSnap, setCleanSnap] = useState(snapshot); // baseline = the fresh blank
  const dirty = snapshot !== cleanSnap;

  // cloud project state + handlers (open/save/duplicate/folders/history)
  const cloud = useCloudProjects({
    auth, ready, model, library, sharedLib, sharedKeys, dirty, snapshot,
    set, setLibrary, setSelections, setStatus, setCleanSnap,
  });

  // browser leave-warning while dirty (close tab / back / reload)
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // crash-safe draft: while dirty, write a debounced working copy to localStorage
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => saveDraft(model, projectLocal(library, sharedKeys), cloud.projectId), 2000);
    return () => clearTimeout(t);
  }, [dirty, model, library, sharedKeys, cloud.projectId]);

  /** Offer to restore a crash/close draft once per session — after the shared
   *  catalog is in (when signed in), so validation can resolve shared parts.
   *  No dep array: it re-checks each render but the ref guards actual work. */
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    if (ready && !sharedLoaded) return; // wait for the catalog first
    restoredRef.current = true;
    const d = loadDraft();
    if (!d) return;
    // deferred so the app paints before the blocking confirm (and no setState
    // inside the synchronous effect body). No cleanup: the ref makes it once-only.
    window.setTimeout(() => {
      const when = new Date(d.savedAt).toLocaleString();
      if (window.confirm(`Restore your unsaved draft "${d.model?.project?.name || "Untitled"}" from ${when}?\n\n(Cancel discards the draft.)`)) {
        cloud.applyLoaded(d.model, d.library, d.projectId, { keepDirty: true });
      } else {
        clearDraft();
      }
    }, 0);
  });

  function doNewProject() {
    // only nag when there actually is unsaved work
    if (dirty && !window.confirm("Start a new layout? Unsaved changes will be lost.")) return;
    const fresh = newModel("Untitled", "tall_floor");
    setLibrary({ ...sharedLib }); // keep the shared catalog available
    set(fresh);
    setSelections([]);
    cloud.detachProject();
    setCleanSnap(JSON.stringify({ m: fresh, l: {} })); // blank = clean
    clearDraft();
  }

  async function doOpenFile() {
    if (dirty && !window.confirm("Open another layout? Unsaved changes here will be lost.")) return;
    const res = await pickLayoutFile();
    if (!res) { setStatus({ kind: "error", message: "Couldn't read that file." }); return; }
    cloud.applyLoaded(res.model, res.library, null);
  }

  /** Local JSON download doubles as the local-mode save — it clears the dirty state. */
  function doDownload() {
    downloadLayout(model, library);
    setCleanSnap(snapshot);
    clearDraft();
  }

  const renameProject = (name: string) => set({ ...model, project: { ...model.project, name } });

  function commitRowEdit(v: number) {
    if (rowEdit && v > 0) set(setRowHeight(model, rowEdit.index, v, rowMode));
    setRowEdit(null);
  }

  // live ezdxf-service availability (DXF upload/export need it; PDF/PNG/SVG don't)
  const [svc, setSvc] = useState<"checking" | "online" | "offline">("checking");
  const [showBom, setShowBom] = useState(false);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [insertFor, setInsertFor] = useState<InsertTarget | null>(null);
  const checkSvc = async () => {
    setSvc((s) => (s === "online" ? s : "checking"));
    setSvc((await ping()) ? "online" : "offline");
  };
  useEffect(() => {
    let alive = true;
    const run = async () => { const ok = await ping(); if (alive) setSvc(ok ? "online" : "offline"); };
    run();
    const t = setInterval(run, 20000); // re-check every 20s
    return () => { alive = false; clearInterval(t); };
  }, []);

  const overlapIds = useMemo(() => findOverlaps(model, library).ids, [model, library]);
  const tightIds = useMemo(() => tightClearances(model, library), [model, library]);
  const selectedIds = useMemo(() => selections.map((s) => s.id), [selections]);

  /** Click on an entity: additive (Shift) toggles it; otherwise selects just it. */
  function selectEntity(meta: Selection, additive: boolean) {
    setSelections((cur) => {
      if (!additive) return [meta];
      return cur.some((s) => s.id === meta.id) ? cur.filter((s) => s.id !== meta.id) : [...cur, meta];
    });
  }

  /** Insert part(s) beside the anchor, auto-shifting the row open (model/insert.ts). */
  function doInsertBeside(libKey: string, side: "left" | "right", count: number) {
    if (!insertFor) return;
    const r = insertBeside(model, library, { kind: insertFor.kind, id: insertFor.id }, side, libKey, count);
    setInsertFor(null);
    if (!r) { setStatus({ kind: "error", message: "Couldn't insert — part or anchor not found." }); return; }
    set(r.model);
    setSelections([{ id: r.ids[0], kind: "element" }]);
  }

  function doAddSet(spec: SetSpec) {
    const { model: m2, id } = addSet(model, spec.libKey, spec.count, {
      tag_start: spec.tagStart || null,
      cap_start_key: spec.capStart || null,
      cap_end_key: spec.capEnd || null,
    });
    set(m2);
    setSelections([{ id, kind: "group" }]);
  }
  function doAddDuct(orientation: "horizontal" | "vertical") {
    const { model: m2, id } = addDuct(model, orientation);
    set(m2);
    setSelections([{ id, kind: "duct" }]);
  }
  function dropPart(libKey: string, x: number, y: number) {
    const { model: m2, id } = addElement(model, libKey, library, x, y);
    set(m2);
    setSelections([{ id, kind: "element" }]);
  }
  function resizeDuct(id: string, x: number, y: number, boxW: number, boxH: number) {
    const d = model.ducts.find((dd) => dd.id === id);
    if (!d) return;
    const dims = ductDimsFromBox(d.rot_deg, boxW, boxH);
    set(updateDuct(model, id, { x_mm: +x.toFixed(2), y_mm: +y.toFixed(2), ...dims }));
  }

  /** Delete every selected object in one action. */
  function deleteSelected() {
    if (selections.length === 0) return;
    let m = model;
    for (const s of selections) m = deleteEntity(m, s.kind, s.id);
    set(m);
    setSelections([]);
  }
  /** Move every selected object by (dx,dy) mm — arrow-key nudge. */
  function nudge(dx: number, dy: number) {
    if (selections.length === 0) return;
    let m = model;
    const r = (n: number) => +n.toFixed(2);
    // selected elements + their locked pair-mates, deduped (so a pair moves once)
    const elIds = new Set<string>();
    for (const s of selections) if (s.kind === "element") {
      elIds.add(s.id);
      const e = m.elements.find((x) => x.id === s.id);
      if (e?.pair_id) for (const o of m.elements) if (o.pair_id === e.pair_id) elIds.add(o.id);
    }
    for (const id of elIds) { const e = m.elements.find((x) => x.id === id); if (e) m = updateElement(m, id, { x_mm: r(e.x_mm + dx), y_mm: r(e.y_mm + dy) }); }
    for (const s of selections) {
      if (s.kind === "duct") { const d = m.ducts.find((x) => x.id === s.id); if (d) m = updateDuct(m, s.id, { x_mm: r(d.x_mm + dx), y_mm: r(d.y_mm + dy) }); }
      else if (s.kind === "group") { const g = m.groups.find((x) => x.id === s.id); if (g) m = updateGroup(m, s.id, { x_mm: r(g.x_mm + dx), y_mm: r(g.y_mm + dy) }); }
      else if (s.kind === "label") { const l = m.labels.find((x) => x.id === s.id); if (l) m = updateLabel(m, s.id, { dx_mm: r(l.dx_mm + dx), dy_mm: r(l.dy_mm + dy) }); }
    }
    set(m);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA") return;
      const arrows: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
      };
      if ((e.key === "Delete" || e.key === "Backspace") && selections.length) { e.preventDefault(); deleteSelected(); }
      else if (arrows[e.key] && selections.length) {
        e.preventDefault();
        const stepMm = e.shiftKey ? 10 : 1; // Shift = coarse (10mm), otherwise 1mm
        nudge(arrows[e.key][0] * stepMm, arrows[e.key][1] * stepMm);
      } else if (e.key === "Escape" && selections.length) {
        setSelections([]);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        // select every device + label (ducts excluded — same rule as the marquee)
        e.preventDefault();
        setSelections([
          ...model.elements.map((el) => ({ id: el.id, kind: "element" as const })),
          ...model.groups.map((g) => ({ id: g.id, kind: "group" as const })),
          ...model.labels.map((l) => ({ id: l.id, kind: "label" as const })),
        ]);
      }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function run(label: string, fn: () => void | Promise<void>) {
    setStatus({ kind: "busy", label });
    try { await fn(); setStatus({ kind: "done", label }); }
    catch (e) { setStatus({ kind: "error", message: e instanceof Error ? e.message : String(e) }); }
  }
  const busy = status.kind === "busy";

  function addPart(libKey: string) {
    const { model: m2, id } = addElement(model, libKey, library);
    set(m2);
    setSelections([{ id, kind: "element" }]);
  }

  /** Save edits to a library part — name, category, and BOM fields (the same fields
   *  captured at upload). Updates the shared catalog too when the part is shared. */
  async function saveLibraryPart(libKey: string, patch: PartEdit) {
    setEditKey(null);
    const fields = {
      name: patch.name, band: patch.band,
      manufacturer: patch.manufacturer, model: patch.model, description: patch.description,
      rail_offset_mm: patch.railOffsetMm,
    };
    setLibrary((l) => ({ ...l, [libKey]: { ...l[libKey], ...fields } }));
    if (sharedLib[libKey]) {
      setSharedLib((s) => ({ ...s, [libKey]: { ...s[libKey], ...fields } }));
      if (!(await updateLibraryItem(libKey, fields)))
        setStatus({ kind: "error", message: "Saved locally, but the shared-library update was rejected (admin only)." });
    }
  }

  /** Edit a part's BOM fields (manufacturer/model/description). Updates the local
   *  library immediately; if the part is shared, persists to the catalog (admin RLS). */
  async function setLibBomField(libKey: string, patch: { manufacturer?: string; model?: string; description?: string }) {
    setLibrary((l) => ({ ...l, [libKey]: { ...l[libKey], ...patch } }));
    if (sharedLib[libKey]) {
      setSharedLib((s) => ({ ...s, [libKey]: { ...s[libKey], ...patch } }));
      if (!(await updateLibraryItem(libKey, patch)))
        setStatus({ kind: "error", message: "Saved locally, but the shared-library update was rejected (admin only)." });
    }
  }

  /** Remove a part from the library (and the shared catalog if shared — admin RLS). */
  async function deleteLibraryPart(libKey: string) {
    const shared = !!sharedLib[libKey];
    const inUse = model.elements.some((e) => e.lib_key === libKey)
      || model.groups.some((g) => g.lib_key === libKey || g.cap_start_key === libKey || g.cap_end_key === libKey);
    let msg = inUse ? "This part is placed in the current layout — deleting it leaves those items unresolved. " : "";
    msg += shared
      ? "It's a SHARED part and may also be used in other saved projects, whose placements would then break. Delete from the shared library for everyone?"
      : (inUse ? "Delete from the library anyway?" : "Delete this part from the library?");
    if (!window.confirm(msg)) return;
    setLibrary((l) => { const c = { ...l }; delete c[libKey]; return c; });
    if (sharedLib[libKey]) {
      setSharedLib((s) => { const c = { ...s }; delete c[libKey]; return c; });
      if (!(await deleteLibraryItem(libKey)))
        setStatus({ kind: "error", message: "Removed locally, but the shared-library delete was rejected (admin only)." });
    }
  }

  /**
   * A generic placeholder device (no CAD file yet): a per-instance rectangle the
   * engineer sizes and names in the panel. Each click makes its own library item
   * so editing one never touches another.
   */
  function addCustomPart() {
    const key = `custom_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const item: RectLibItem = { lib_key: key, source: "rect", name: "", width_mm: 60, height_mm: 60, confirm: false, custom: true };
    const lib2 = { ...library, [key]: item };
    setLibrary(lib2);
    const { model: m2, id } = addElement(model, key, lib2);
    set(m2);
    setSelections([{ id, kind: "element" }]);
  }

  async function handleFile(file: File) {
    setUpload({ status: "uploading" });
    try {
      const result = await uploadDxf(file);
      setUpload({ status: "confirm", result, name: file.name.replace(/\.dxf$/i, "") });
    } catch (e) {
      setUpload({ status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }
  async function confirmUpload(name: string, shared: boolean, band: number, meta: BomMeta, railOffsetMm: number) {
    if (upload.status !== "confirm") return;
    const key = `up_${Date.now().toString(36)}`;
    const item: DxfLibItem = {
      lib_key: key, name, source: "dxf", band,
      rail_offset_mm: railOffsetMm, // DIN-rail datum (from the DXF origin, or the user's value)
      ...(meta.manufacturer ? { manufacturer: meta.manufacturer } : {}),
      ...(meta.model ? { model: meta.model } : {}),
      ...(meta.description ? { description: meta.description } : {}),
      width_mm: upload.result.width_mm, height_mm: upload.result.height_mm,
      block_ref: upload.result.block_ref, svg_ref: upload.result.svg,
    };
    setLibrary((l) => ({ ...l, [key]: item })); // available in this project immediately
    setUpload({ status: "idle" });
    if (shared && ready && auth.profile) {
      const ok = await addLibraryItem(item, auth.profile.id);
      if (ok) setSharedLib((s) => ({ ...s, [key]: item }));
      else setStatus({ kind: "error", message: "Added here, but couldn't add to the shared library." });
    }
  }

  return (
    <div className="app">
      <Toolbar
        model={model} auth={auth} ready={ready} dirty={dirty} status={status} busy={busy}
        lastSaved={cloud.lastSaved} cloudBusy={cloud.cloudBusy} svc={svc}
        dxfScale={dxfScale} paper={paper} zoom={zoom} alignEnabled={alignEnabled}
        canUndo={canUndo} canRedo={canRedo}
        onRename={renameProject} onNew={doNewProject} onOpenProjects={cloud.openProjectsModal}
        onSave={cloud.doSaveCloud} onDuplicate={cloud.doDuplicateCurrent}
        onDownload={doDownload} onOpenFile={doOpenFile}
        onBundle={() => run("Bundle", () => downloadBundle(model, library))}
        onUndo={undo} onRedo={redo} onZoom={setZoom} onFit={() => setFitNonce((n) => n + 1)}
        onAlign={setAlignEnabled} onCheckSvc={checkSvc}
        onDxfScale={setDxfScale} onPaper={setPaper}
        onExportDxf={() => run("DXF (waking service)", () => exportDxf(model, library, dxfScale))}
        onPdf={() => run("PDF", () => downloadPdf(model, library, paper))}
        onPng={() => run("PNG", () => downloadPng(model, library, paper))}
        onSvg={() => run("SVG", () => downloadSvg(model, library))}
        onBom={() => setShowBom(true)}
      />

      <LibrarySidebar
        library={library} upload={upload} svcOffline={svc === "offline"}
        onUploadFile={handleFile}
        onUploadError={(message) => setUpload({ status: "error", message })}
        onDismissUploadError={() => setUpload({ status: "idle" })}
        onAddPart={addPart} onEditPart={setEditKey} onDeletePart={deleteLibraryPart}
        onAddDuct={doAddDuct} onAddCustomPart={addCustomPart} onAddSet={doAddSet}
      />

      <main className="stage">
        <div className="sheet">
          <FabricStage
            model={model} library={library} zoom={zoom} alignEnabled={alignEnabled}
            fitNonce={fitNonce} overlapIds={overlapIds} tightIds={tightIds}
            selectedIds={selectedIds}
            onSelectEntity={selectEntity}
            onClearSelection={() => setSelections([])}
            onMarquee={(sels) => setSelections((prev) => {
              const seen = new Set(prev.map((s) => s.id));
              return [...prev, ...sels.filter((s) => !seen.has(s.id))]; // union (additive sweeps)
            })}
            onMove={(kind: EntityKind, id, x, y) => set(moveEntity(model, kind, id, x, y))}
            onZoomChange={setZoom}
            onResizeDuct={resizeDuct}
            onDropPart={dropPart}
            onEditRow={(index, x, y, value) => setRowEdit({ index, x, y, value })}
          />
        </div>
      </main>

      <PropertiesPanel
        model={model} library={library} set={set} setLibrary={setLibrary}
        selections={selections} setSelections={setSelections}
        rowMode={rowMode} setRowMode={setRowMode}
        deleteSelected={deleteSelected} setLibBomField={setLibBomField}
        onInsertFor={setInsertFor}
      />

      {upload.status === "confirm" && (
        <UploadModal result={upload.result} defaultName={upload.name} canShare={ready}
          onConfirm={confirmUpload} onCancel={() => setUpload({ status: "idle" })} />
      )}

      {showBom && (
        <BomModal model={model} library={library} paper={paper}
          extras={model.bom_extras ?? []}
          onChangeExtras={(ex) => set({ ...model, bom_extras: ex })}
          onClose={() => setShowBom(false)} />
      )}

      {editKey && library[editKey] && (
        <EditPartModal item={library[editKey]} shared={!!sharedLib[editKey]}
          onSave={(p) => saveLibraryPart(editKey, p)} onCancel={() => setEditKey(null)} />
      )}

      {insertFor && (
        <InsertModal library={library} anchorName={insertFor.name}
          onInsert={doInsertBeside} onCancel={() => setInsertFor(null)} />
      )}

      {cloud.historyFor && (
        <RevisionsModal projectName={cloud.historyFor.name} revisions={cloud.historyFor.revs} busy={cloud.cloudBusy}
          onRestore={cloud.doRestoreRevision} onClose={() => cloud.setHistoryFor(null)} />
      )}

      {rowEdit && (
        <input className="rowedit" type="number" autoFocus defaultValue={rowEdit.value}
          style={{ left: rowEdit.x, top: rowEdit.y }}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRowEdit(parseFloat((e.target as HTMLInputElement).value));
            else if (e.key === "Escape") setRowEdit(null);
          }}
          onBlur={(e) => commitRowEdit(parseFloat(e.target.value))} />
      )}

      {cloud.projectsOpen && (
        <OpenDialog
          projectList={cloud.projectList} folders={cloud.folders}
          collapsedFolders={cloud.collapsedFolders} cloudBusy={cloud.cloudBusy}
          onClose={() => cloud.setProjectsOpen(false)}
          onOpen={cloud.doOpenCloud} onNewFolder={cloud.doNewFolder}
          onRenameFolder={cloud.doRenameFolder} onDeleteFolder={cloud.doDeleteFolder}
          onMove={cloud.doMoveProject} onToggleFolder={cloud.toggleFolder}
          onHistory={cloud.openHistory} onDuplicate={cloud.doDuplicateFromList}
          onDelete={cloud.doDeleteCloud}
        />
      )}

      {ready && auth.profile && !auth.profile.display_name && (
        <div className="namep-overlay">
          <div className="namep">
            <h3>Welcome 👋</h3>
            <p>Pick a display name your teammates will see on shared layouts.</p>
            <input autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} placeholder="e.g. Natchanon K."
              onKeyDown={(e) => { if (e.key === "Enter" && nameDraft.trim()) auth.setDisplayName(nameDraft.trim()); }} />
            <div className="row"><button type="button" disabled={!nameDraft.trim()} onClick={() => auth.setDisplayName(nameDraft.trim())}>Save</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
