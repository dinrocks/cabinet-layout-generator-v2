import { useEffect, useMemo, useRef, useState } from "react";
import { newModel } from "./model/factory";
import { BANDS, STOPPER_BANDS, byName } from "./model/library";
import type { Library, DxfLibItem, RectLibItem, LayoutModel } from "./model/types";
import { validate } from "./model/validate";
import { useAuth } from "./auth/AuthContext";
import { cloudEnabled } from "./lib/supabaseClient";
import {
  listProjects, loadProject, saveProject, deleteProject, projectLocal,
  listRevisions, loadRevision, getProjectVersion,
  listFolders, createFolder, renameFolder, deleteFolder, moveProject,
  type ProjectSummary, type RevisionSummary, type Folder,
} from "./store/projectStore";
import RevisionsModal from "./editor/RevisionsModal";
import { downloadLayout, pickLayoutFile } from "./store/localFile";
import { saveDraft, loadDraft, clearDraft } from "./store/draft";
import { listLibraryItems, addLibraryItem, updateLibraryItem, deleteLibraryItem } from "./store/libraryStore";
import { findOverlaps, tightClearances } from "./model/overlap";
import { detectRows, setRowHeight, centerRowDevices, packRow, type RowResizeMode } from "./model/rows";
import {
  addElement, moveEntity, setRotation, deleteEntity,
  updateElement, updateDuct, updateGroup, addSet, addDuct, fitDuctWidth, explodeGroup, addLabel, updateLabel, ductDimsFromBox,
  type EntityKind,
} from "./model/edit";
import { useHistory } from "./editor/useHistory";
import FabricStage, { type Selection } from "./editor/FabricStage";
import { clampZoom } from "./editor/zoom";
import UploadModal, { type BomMeta } from "./editor/UploadModal";
import BomModal from "./editor/BomModal";
import EditPartModal, { type PartEdit } from "./editor/EditPartModal";
import InsertModal from "./editor/InsertModal";
import { insertBeside } from "./model/insert";
import { selectRow } from "./model/marquee";
import { exportDxf, uploadDxf, ping, type DxfScale, type UploadResult } from "./service/dxfClient";
import { downloadSvg, downloadPng, downloadPdf } from "./export/inBrowser";
import type { Paper } from "./render/page";
import "./App.css";

type Status =
  | { kind: "idle" }
  | { kind: "busy"; label: string }
  | { kind: "done"; label: string }
  | { kind: "error"; message: string };

type Upload =
  | { status: "idle" }
  | { status: "uploading" }
  | { status: "confirm"; result: UploadResult; name: string }
  | { status: "error"; message: string };

/** Compact relative time for the "saved by … <when>" chip ("just now", "5m", "2h", or a date). */
function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

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
  const [dragOver, setDragOver] = useState(false);
  const [rowEdit, setRowEdit] = useState<{ index: number; x: number; y: number; value: number } | null>(null);
  const [rowMode, setRowMode] = useState<RowResizeMode>("push");
  const fileRef = useRef<HTMLInputElement | null>(null);

  // ── Phase 2: auth + cloud-saved projects ───────────────────────────────────
  const auth = useAuth();
  const ready = auth.status === "ready"; // signed in + allow-listed
  const [projectId, setProjectId] = useState<string | null>(null); // cloud row id of the open project
  const [baseUpdatedAt, setBaseUpdatedAt] = useState<string | null>(null); // loaded server version (stale-save guard)
  const [lastSaved, setLastSaved] = useState<{ name: string | null; at: string } | null>(null);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [projectList, setProjectList] = useState<ProjectSummary[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null); // open project's folder
  const [cloudBusy, setCloudBusy] = useState(false);
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
    const t = setTimeout(() => saveDraft(model, projectLocal(library, sharedKeys), projectId), 2000);
    return () => clearTimeout(t);
  }, [dirty, model, library, sharedKeys, projectId]);

  /** Validate a loaded model (against seed + shared + its project-local parts), then adopt it.
   *  `keepDirty` is for restoring a DRAFT: the restored state is still unsaved work,
   *  so it must stay dirty (leave-warning + draft keep refreshing) until a real save. */
  function applyLoaded(m: LayoutModel | undefined, projectLocalLib: Library, cloudId: string | null,
    opts: { keepDirty?: boolean; meta?: { updatedAt: string; updatedByName: string | null } } = {}): boolean {
    if (!m || !m.project || !m.plate || !Array.isArray(m.elements)) {
      setStatus({ kind: "error", message: "That file isn't a valid layout." });
      return false;
    }
    const lib: Library = { ...sharedLib, ...projectLocalLib };
    const errors = validate(m, lib).filter((i) => i.level === "error");
    if (errors.length) { setStatus({ kind: "error", message: `Layout rejected: ${errors[0].message}` }); return false; }
    setLibrary(lib);
    set(m);
    setSelections([]);
    setProjectId(cloudId);
    // remember the loaded server version (null for a local file / draft → no guard)
    setBaseUpdatedAt(opts.meta?.updatedAt ?? null);
    setLastSaved(opts.meta ? { name: opts.meta.updatedByName, at: opts.meta.updatedAt } : null);
    if (!opts.keepDirty) {
      // same serialization as the `snapshot` memo, built from the adopted values
      setCleanSnap(JSON.stringify({ m, l: projectLocal(lib, sharedKeys) }));
      clearDraft();
    }
    return true;
  }

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
        applyLoaded(d.model, d.library, d.projectId, { keepDirty: true });
      } else {
        clearDraft();
      }
    }, 0);
  });

  async function openProjectsModal() {
    setProjectsOpen(true);
    const [projs, folds] = await Promise.all([listProjects(), listFolders()]);
    setProjectList(projs);
    setFolders(folds);
  }
  const refreshProjects = async () => setProjectList(await listProjects());

  async function doOpenCloud(id: string) {
    if (dirty && !window.confirm("Open another layout? Unsaved changes here will be lost.")) return;
    setCloudBusy(true);
    const res = await loadProject(id);
    setCloudBusy(false);
    if (!res) { setStatus({ kind: "error", message: "Couldn't load that layout." }); return; }
    if (applyLoaded(res.model, res.library, id, { meta: { updatedAt: res.updatedAt, updatedByName: res.updatedByName } })) {
      setCurrentFolderId(res.folderId);
      setProjectsOpen(false);
      setStatus({ kind: "done", label: "Opened" });
    }
  }

  const doSaveCloud = () => saveCloud(baseUpdatedAt);

  /** Save to the cloud, guarding against a stale overwrite. `base` = the version we
   *  believe is on the server; on a conflict the user can overwrite (re-save with the
   *  server's version as the new base) or abort (keep editing, nothing lost). */
  async function saveCloud(base: string | null) {
    if (!ready || !auth.profile) return;
    setCloudBusy(true);
    const r = await saveProject(model, library, sharedKeys, auth.profile.id, projectId, base);
    setCloudBusy(false);
    if ("error" in r) { setStatus({ kind: "error", message: `Save failed: ${r.error}` }); return; }
    if ("conflict" in r) {
      const who = r.conflict.updatedByName || "someone";
      const when = new Date(r.conflict.updatedAt).toLocaleString();
      const overwrite = window.confirm(
        `⚠ "${who}" saved this project at ${when}, after you opened it.\n\n` +
        `OK  = overwrite their version with yours (their changes are lost).\n` +
        `Cancel = keep your work in the editor without saving — you can ⬇ download it, or Open theirs.`,
      );
      if (overwrite) await saveCloud(r.conflict.updatedAt); // base now matches → succeeds
      else setStatus({ kind: "error", message: `Not saved — ${who} has a newer version.` });
      return;
    }
    setProjectId(r.id);
    setBaseUpdatedAt(r.updatedAt);
    setLastSaved({ name: auth.profile.display_name || auth.email, at: r.updatedAt });
    setStatus({ kind: "done", label: "Saved" });
    setCleanSnap(snapshot); // what we just saved is the new clean baseline
    clearDraft();
  }

  /** Fork the CURRENT editor state (incl. unsaved edits) into a new cloud project and
   *  switch onto the copy — the original row is left untouched. */
  async function doDuplicateCurrent() {
    if (!ready || !auth.profile) return;
    const input = window.prompt("Name for the copy", `Copy of ${model.project.name || "Untitled"}`);
    if (input == null) return; // cancelled
    const name = input.trim() || `Copy of ${model.project.name || "Untitled"}`;
    const copy = { ...model, project: { ...model.project, name } };
    setCloudBusy(true);
    const r = await saveProject(copy, library, sharedKeys, auth.profile.id, null, null); // null id → insert
    setCloudBusy(false);
    if ("error" in r) { setStatus({ kind: "error", message: `Copy failed: ${r.error}` }); return; }
    if ("conflict" in r) return; // impossible on insert, but keeps the union exhaustive
    if (currentFolderId) await moveProject(r.id, currentFolderId); // copy lands in the same folder
    set(copy); // adopt the renamed model; editor is now on the copy
    setProjectId(r.id);
    setBaseUpdatedAt(r.updatedAt);
    setLastSaved({ name: auth.profile.display_name || auth.email, at: r.updatedAt });
    setStatus({ kind: "done", label: "Duplicated" });
    setCleanSnap(JSON.stringify({ m: copy, l: projectLocal(library, sharedKeys) })); // the saved copy is clean
    clearDraft();
  }

  /** Copy a saved project (from the Open list) into a new row WITHOUT opening it. */
  async function doDuplicateFromList(p: ProjectSummary) {
    if (!auth.profile) return;
    const input = window.prompt("Name for the copy", `Copy of ${p.name || "Untitled"}`);
    if (input == null) return;
    const name = input.trim() || `Copy of ${p.name || "Untitled"}`;
    setCloudBusy(true);
    const src = await loadProject(p.id);
    if (!src) { setCloudBusy(false); setStatus({ kind: "error", message: "Couldn't read that layout to copy." }); return; }
    const copy = { ...src.model, project: { ...src.model.project, name } };
    const r = await saveProject(copy, src.library, sharedKeys, auth.profile.id, null, null);
    if (!("error" in r || "conflict" in r) && p.folder_id) await moveProject(r.id, p.folder_id); // same folder
    setCloudBusy(false);
    if ("error" in r || "conflict" in r) { setStatus({ kind: "error", message: "Copy failed." }); return; }
    setStatus({ kind: "done", label: "Copied" });
    await refreshProjects(); // show the copy (newest first)
  }

  /** Open a project's save history (last ~20 revisions). */
  async function openHistory(p: ProjectSummary) {
    setCloudBusy(true);
    const revs = await listRevisions(p.id);
    setCloudBusy(false);
    setHistoryFor({ id: p.id, name: p.name, revs });
  }

  /** Load a revision into the editor as UNSAVED work — the server is untouched
   *  until the user Saves (which then runs the normal stale-save guard). */
  async function doRestoreRevision(revId: string) {
    if (!historyFor) return;
    if (dirty && !window.confirm("Load this revision? Unsaved changes here will be lost.")) return;
    setCloudBusy(true);
    const rev = await loadRevision(revId);
    const live = await getProjectVersion(historyFor.id); // base for the save guard
    setCloudBusy(false);
    if (!rev) { setStatus({ kind: "error", message: "Couldn't load that revision." }); return; }
    if (applyLoaded(rev.model, rev.library, historyFor.id, { keepDirty: true, meta: live ?? undefined })) {
      setHistoryFor(null);
      setProjectsOpen(false);
    }
  }

  async function doDeleteCloud(id: string) {
    if (!window.confirm("Delete this layout for everyone? Its saved history is deleted with it.")) return;
    setCloudBusy(true);
    const ok = await deleteProject(id);
    setCloudBusy(false);
    if (!ok) { setStatus({ kind: "error", message: "Delete failed." }); return; }
    if (id === projectId) setProjectId(null);
    await refreshProjects();
  }

  // ── folders ──────────────────────────────────────────────────────────────
  async function doNewFolder() {
    if (!auth.profile) return;
    const input = window.prompt("New folder name", "New folder");
    if (input == null || !input.trim()) return;
    setCloudBusy(true);
    const id = await createFolder(input.trim(), auth.profile.id);
    setCloudBusy(false);
    if (!id) { setStatus({ kind: "error", message: "Couldn't create the folder." }); return; }
    setFolders(await listFolders());
  }
  async function doRenameFolder(f: Folder) {
    const input = window.prompt("Rename folder", f.name);
    if (input == null || !input.trim() || input.trim() === f.name) return;
    setCloudBusy(true);
    const ok = await renameFolder(f.id, input.trim());
    setCloudBusy(false);
    if (!ok) { setStatus({ kind: "error", message: "Rename failed." }); return; }
    setFolders(await listFolders());
  }
  async function doDeleteFolder(f: Folder, count: number) {
    if (!window.confirm(count > 0
      ? `Delete folder "${f.name}"? Its ${count} layout${count > 1 ? "s" : ""} are kept and moved to Unfiled.`
      : `Delete folder "${f.name}"?`)) return;
    setCloudBusy(true);
    const ok = await deleteFolder(f.id);
    setCloudBusy(false);
    if (!ok) { setStatus({ kind: "error", message: "Delete failed (owner/admin only)." }); return; }
    const [folds] = await Promise.all([listFolders(), refreshProjects()]);
    setFolders(folds);
  }
  /** Move a layout into a folder (or Unfiled with null); refresh the grouped list. */
  async function doMoveProject(projectId2: string, folderId: string | null) {
    setCloudBusy(true);
    const ok = await moveProject(projectId2, folderId);
    setCloudBusy(false);
    if (!ok) { setStatus({ kind: "error", message: "Move failed." }); return; }
    if (projectId2 === projectId) setCurrentFolderId(folderId); // keep the open project in sync
    await refreshProjects();
  }
  const toggleFolder = (id: string) => setCollapsedFolders((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  function doNewProject() {
    // only nag when there actually is unsaved work
    if (dirty && !window.confirm("Start a new layout? Unsaved changes will be lost.")) return;
    const fresh = newModel("Untitled", "tall_floor");
    setLibrary({ ...sharedLib }); // keep the shared catalog available
    set(fresh);
    setSelections([]);
    setProjectId(null);
    setCurrentFolderId(null);
    setCleanSnap(JSON.stringify({ m: fresh, l: {} })); // blank = clean
    clearDraft();
  }

  async function doOpenFile() {
    if (dirty && !window.confirm("Open another layout? Unsaved changes here will be lost.")) return;
    const res = await pickLayoutFile();
    if (!res) { setStatus({ kind: "error", message: "Couldn't read that file." }); return; }
    applyLoaded(res.model, res.library, null);
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

  function acceptDroppedFile(files: FileList) {
    const f = [...files].find((file) => file.name.toLowerCase().endsWith(".dxf"));
    if (f) handleFile(f);
    else setUpload({ status: "error", message: "Please drop a single .dxf file." });
  }

  // live ezdxf-service availability (DXF upload/export need it; PDF/PNG/SVG don't)
  const [svc, setSvc] = useState<"checking" | "online" | "offline">("checking");
  const [showBom, setShowBom] = useState(false);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [insertFor, setInsertFor] = useState<{ kind: "element" | "group"; id: string; name: string } | null>(null);
  const [historyFor, setHistoryFor] = useState<{ id: string; name: string; revs: RevisionSummary[] } | null>(null);
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

  const issues = useMemo(() => validate(model, library), [model, library]);
  const overlapIds = useMemo(() => findOverlaps(model, library).ids, [model, library]);
  const tightIds = useMemo(() => tightClearances(model, library), [model, library]);
  const rows = useMemo(() => detectRows(model), [model]);

  // exactly-one selection drives the per-entity editor; >1 shows a multi panel
  const single = selections.length === 1 ? selections[0] : null;
  const multi = selections.length > 1;
  const selectedIds = useMemo(() => selections.map((s) => s.id), [selections]);
  const selEl = single?.kind === "element" ? model.elements.find((e) => e.id === single.id) ?? null : null;
  const selItem = selEl ? library[selEl.lib_key] : undefined;
  const selIsLabel = selItem?.source === "rect" && selItem.label_plate === true;
  const selDuct = single?.kind === "duct" ? model.ducts.find((d) => d.id === single.id) ?? null : null;
  const selGroup = single?.kind === "group" ? model.groups.find((g) => g.id === single.id) ?? null : null;
  const selLabel = single?.kind === "label" ? model.labels.find((l) => l.id === single.id) ?? null : null;

  /** Click on an entity: additive (Shift) toggles it; otherwise selects just it. */
  function selectEntity(meta: Selection, additive: boolean) {
    setSelections((cur) => {
      if (!additive) return [meta];
      return cur.some((s) => s.id === meta.id) ? cur.filter((s) => s.id !== meta.id) : [...cur, meta];
    });
  }

  // Add-Set form state
  const [setLibKey, setSetLibKey] = useState("term_degson_2c_2_5");
  const [setCount, setSetCount] = useState(12);
  const [setTagStart, setSetTagStart] = useState("B101");
  const [setCapStart, setSetCapStart] = useState(""); // "" = no cap
  const [setCapEnd, setSetCapEnd] = useState("");

  /** Insert part(s) beside the anchor, auto-shifting the row open (model/insert.ts). */
  function doInsertBeside(libKey: string, side: "left" | "right", count: number) {
    if (!insertFor) return;
    const r = insertBeside(model, library, { kind: insertFor.kind, id: insertFor.id }, side, libKey, count);
    setInsertFor(null);
    if (!r) { setStatus({ kind: "error", message: "Couldn't insert — part or anchor not found." }); return; }
    set(r.model);
    setSelections([{ id: r.ids[0], kind: "element" }]);
  }

  function addPartLabel(kind: "element" | "group", refId: string) {
    const { model: m2, id } = addLabel(model, kind, refId);
    set(m2);
    setSelections([{ id, kind: "label" }]);
  }
  function doAddSet() {
    const { model: m2, id } = addSet(model, setLibKey, setCount, {
      tag_start: setTagStart || null,
      cap_start_key: setCapStart || null,
      cap_end_key: setCapEnd || null,
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
  function rotateSelected() {
    if (!single || (single.kind !== "element" && single.kind !== "group")) return;
    const cur = selEl?.rot_deg ?? selGroup?.rot_deg ?? 0;
    set(setRotation(model, single.kind, single.id, cur + 90));
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
      <header className="topbar">
        <strong>Cabinet Layout Generator</strong>
        <span className="muted">
          <span className="projname-field" title="Click to rename this project">
            <span className="projname-ico" aria-hidden="true">✎</span>
            <input className="projname" value={model.project.name} placeholder="Untitled project"
              onChange={(e) => renameProject(e.target.value)} aria-label="Project name" />
          </span>
          <span className="dim">· {model.plate.width_mm}×{model.plate.height_mm} mm</span>
          {lastSaved && (
            <span className="savedby" title={`Last saved ${new Date(lastSaved.at).toLocaleString()}`}>
              · saved by {lastSaved.name || "—"} {timeAgo(lastSaved.at)}
            </span>
          )}
        </span>

        <div className="toolbar">
          {/* File */}
          <span className="group">
            <button type="button" title="New layout" onClick={doNewProject}>New</button>
            {ready && <button type="button" title="Open a saved layout" onClick={openProjectsModal}>Open…</button>}
            {ready && <button type="button" title="Save to the cloud" disabled={cloudBusy} onClick={doSaveCloud}>Save</button>}
            {ready && <button type="button" className="ghost" title="Save the current layout as a new project (a copy) and switch to it" disabled={cloudBusy} onClick={doDuplicateCurrent}>Duplicate</button>}
            <button type="button" className="ghost icon" title="Download layout as JSON" onClick={doDownload}>⬇</button>
            <button type="button" className="ghost icon" title="Open a layout JSON file" onClick={doOpenFile}>⬆</button>
          </span>
          {/* History */}
          <span className="group">
            <button type="button" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">↶</button>
            <button type="button" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">↷</button>
          </span>
          {/* View */}
          <span className="group">
            <button type="button" className="icon" title="Zoom out" onClick={() => setZoom((z) => clampZoom(z / 1.25))}>−</button>
            <span className="zoompct" title="Current zoom">{Math.round(zoom * 100)}%</span>
            <button type="button" className="icon" title="Zoom in" onClick={() => setZoom((z) => clampZoom(z * 1.25))}>+</button>
            <button type="button" className="ghost" title="Fit to view" onClick={() => setFitNonce((n) => n + 1)}>Fit</button>
            <label className="field" title="Snap a dragged part adjacent to its neighbour with the 0.1mm gap, aligned to the rail centerline">
              <input type="checkbox" checked={alignEnabled} onChange={(e) => setAlignEnabled(e.target.checked)} />
              Align
            </label>
          </span>
          {/* Export — DXF */}
          <span className="group">
            <button type="button" className={`svc svc-${svc}`} onClick={checkSvc}
              title={
                svc === "online" ? "ezdxf service online — DXF upload/export available (click to re-check)"
                  : svc === "offline" ? "ezdxf service offline — DXF disabled; PDF/PNG/SVG still work (click to retry)"
                    : "checking ezdxf service…"
              }>
              <span className="dot" /> DXF service: {svc}
            </button>
            <label className="field">DXF
              <select value={dxfScale} onChange={(e) => setDxfScale(e.target.value as DxfScale)}>
                <option value="1:1">1:1</option><option value="1:100">1:100</option>
              </select>
            </label>
            <button type="button" disabled={busy} onClick={() => run("DXF (waking service)", () => exportDxf(model, library, dxfScale))}>Export DXF</button>
          </span>
          {/* Export — page + BOM */}
          <span className="group">
            <label className="field">Paper
              <select value={paper} onChange={(e) => setPaper(e.target.value as Paper)}>
                <option value="A4">A4</option><option value="A3">A3</option>
              </select>
            </label>
            <button type="button" className="ghost" disabled={busy} onClick={() => run("PDF", () => downloadPdf(model, library, paper))}>PDF</button>
            <button type="button" className="ghost" disabled={busy} onClick={() => run("PNG", () => downloadPng(model, library, paper))}>PNG</button>
            <button type="button" className="ghost" disabled={busy} onClick={() => run("SVG", () => downloadSvg(model, library))}>SVG</button>
            <button type="button" className="ghost" title="Bill of Materials — count placed parts by category, export CSV" onClick={() => setShowBom(true)}>BOM</button>
          </span>
          {/* Right cluster: help · status · account (pushed right) */}
          <span className="group right">
            <button type="button" className="ghost" title="How to use this tool (opens in a new tab)"
              onClick={() => window.open("/guide.html", "_blank", "noopener")}>? Guide</button>
          </span>
          {dirty && <span className="status dirty" title="Unsaved changes — Save (cloud) or ⬇ (file)">● unsaved</span>}
          {status.kind === "busy" && <span className="status">… {status.label}</span>}
          {status.kind === "done" && !dirty && <span className="status ok">✓ {status.label}</span>}
          {status.kind === "error" && <span className="status err" title={status.message}>✗ {status.message}</span>}
          <span className="group">
            {cloudEnabled && ready && auth.profile ? (
              <span className="acct">
                <span className="name" title={auth.email ?? ""}>{auth.profile.display_name || auth.email}</span>
                <button type="button" onClick={auth.signOut}>Sign out</button>
              </span>
            ) : !cloudEnabled ? (
              <span className="acct mode" title="Cloud sign-in not configured — running locally">Local mode</span>
            ) : null}
          </span>
        </div>
      </header>

      <aside className="library">
        <h3>Library</h3>

        <input ref={fileRef} type="file" accept=".dxf" style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
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
          <p className="upload-err">Upload failed: {upload.message} <button type="button" onClick={() => setUpload({ status: "idle" })}>dismiss</button></p>
        )}
        {svc === "offline" && upload.status !== "error" && (
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
                    onClick={() => addPart(it.lib_key)}>
                    {it.name || "(unnamed)"}{it.confirm ? " *" : ""}
                  </button>
                  <button type="button" className="lib-mini" title="Edit part (name, category, BOM details)" onClick={() => setEditKey(it.lib_key)}>✎</button>
                  <button type="button" className="lib-mini" title="Delete from library" onClick={() => deleteLibraryPart(it.lib_key)}>✕</button>
                </div>
              ))}
              {items.length === 0 && <p className="band-empty">— empty —</p>}
            </div>
          );
        })}
        <div className="addset">
          <div className="band-name">Objects</div>
          <button type="button" className="lib-item" onClick={() => doAddDuct("horizontal")}>+ Wire duct (row)</button>
          <button type="button" className="lib-item" onClick={() => doAddDuct("vertical")}>+ Wire duct (vertical)</button>
          <button type="button" className="lib-item" title="A blank device you size and name yourself (for parts without a CAD file)" onClick={addCustomPart}>+ Custom part</button>
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
          <button type="button" className="lib-item" onClick={doAddSet}>Add set ×{setCount}</button>
        </div>

        <p className="muted small">* size is an unconfirmed estimate (replace via datasheet/DXF upload).</p>
      </aside>

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
                onClick={() => setInsertFor({ kind: "element", id: selEl.id, name: library[selEl.lib_key]?.name ?? selEl.lib_key })}>⇤⇥ Insert beside…</button>
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
                onClick={() => setInsertFor({ kind: "group", id: selGroup.id, name: `set ${library[selGroup.lib_key]?.name ?? selGroup.lib_key}` })}>⇤⇥ Insert beside…</button>
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

      {upload.status === "confirm" && (
        <UploadModal result={upload.result} defaultName={upload.name} canShare={ready}
          onConfirm={confirmUpload} onCancel={() => setUpload({ status: "idle" })} />
      )}

      {showBom && (
        <BomModal model={model} library={library}
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

      {historyFor && (
        <RevisionsModal projectName={historyFor.name} revisions={historyFor.revs} busy={cloudBusy}
          onRestore={doRestoreRevision} onClose={() => setHistoryFor(null)} />
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

      {projectsOpen && (
        <div className="modal-overlay" onClick={() => setProjectsOpen(false)}>
          <div className="modal projects-modal" onClick={(e) => e.stopPropagation()}>
            <div className="projects-head">
              <h3>Open a layout</h3>
              <button type="button" className="ghost" disabled={cloudBusy} onClick={doNewFolder}>+ New folder</button>
            </div>
            {projectList.length === 0 && folders.length === 0 ? (
              <p className="muted small">No saved layouts yet — Save one first.</p>
            ) : (() => {
              // group by folder; a group's "activity" = its newest layout (folders empty → own updated_at)
              const byFolder = new Map<string | null, ProjectSummary[]>();
              for (const p of projectList) {
                const arr = byFolder.get(p.folder_id) ?? [];
                arr.push(p); byFolder.set(p.folder_id, arr);
              }
              const groups = folders.map((f) => {
                const ps = byFolder.get(f.id) ?? [];
                return { key: f.id, folder: f, projects: ps,
                  activity: ps.length ? +new Date(ps[0].updated_at) : +new Date(f.updated_at) };
              });
              const loose = byFolder.get(null) ?? [];
              if (loose.length) groups.push({ key: "__unfiled__", folder: null as unknown as Folder, projects: loose, activity: +new Date(loose[0].updated_at) });
              groups.sort((a, b) => b.activity - a.activity);

              const projectRow = (p: ProjectSummary) => (
                <li key={p.id} className="plist-row">
                  <button type="button" className="plist-open" disabled={cloudBusy} onClick={() => doOpenCloud(p.id)}>
                    <span className="pn">{p.name || "Untitled"}</span>
                    <span className="pm" title={new Date(p.updated_at).toLocaleString()}>saved by {p.updated_by_name ?? p.owner_name ?? "—"} · {timeAgo(p.updated_at)}</span>
                  </button>
                  <select className="plist-move" value={p.folder_id ?? ""} disabled={cloudBusy}
                    title="Move to folder" onChange={(e) => doMoveProject(p.id, e.target.value || null)}>
                    <option value="">Unfiled</option>
                    {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                  <button type="button" className="dup" disabled={cloudBusy} title="History — restore an earlier save" onClick={() => openHistory(p)}>⟲</button>
                  <button type="button" className="dup" disabled={cloudBusy} title="Duplicate into a new project" onClick={() => doDuplicateFromList(p)}>⧉</button>
                  <button type="button" className="danger" disabled={cloudBusy} title="Delete" onClick={() => doDeleteCloud(p.id)}>✕</button>
                </li>
              );

              return (
                <ul className="plist folders">
                  {groups.map((g) => {
                    const collapsed = collapsedFolders.has(g.key);
                    return (
                      <li key={g.key} className="folder-group">
                        <div className="folder-head">
                          <button type="button" className="folder-toggle" onClick={() => toggleFolder(g.key)}>
                            <span className="caret">{collapsed ? "▸" : "▾"}</span>
                            {g.folder ? g.folder.name : "Unfiled"}
                            <span className="folder-count">{g.projects.length}</span>
                          </button>
                          {g.folder && (
                            <>
                              <button type="button" className="dup" disabled={cloudBusy} title="Rename folder" onClick={() => doRenameFolder(g.folder)}>✎</button>
                              <button type="button" className="danger" disabled={cloudBusy} title="Delete folder (layouts move to Unfiled)" onClick={() => doDeleteFolder(g.folder, g.projects.length)}>✕</button>
                            </>
                          )}
                        </div>
                        {!collapsed && (
                          g.projects.length
                            ? <ul className="plist folder-projects">{g.projects.map(projectRow)}</ul>
                            : <p className="folder-empty">— empty — move a layout here with its ▾</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              );
            })()}
            <div className="modal-actions"><button type="button" onClick={() => setProjectsOpen(false)}>Close</button></div>
          </div>
        </div>
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="prow"><span className="plabel">{label}</span><span className="pval">{children}</span></div>;
}
function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <Row label={label}><input type="text" value={value} onChange={(e) => onChange(e.target.value)} /></Row>;
}
function Num({ label, value, step = 1, onChange }: { label: string; value: number; step?: number; onChange: (v: number) => void }) {
  return <Row label={label}><input type="number" step={step} value={value} onChange={(e) => { const n = parseFloat(e.target.value); if (!Number.isNaN(n)) onChange(n); }} /></Row>;
}
