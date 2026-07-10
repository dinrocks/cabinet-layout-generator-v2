/**
 * Cloud project state + handlers (Phase 2): open/save/duplicate/delete, folders,
 * revision history, and the stale-save guard. Extracted verbatim from App.tsx
 * (ROADMAP #8) — pure code movement, no behaviour change. The hook owns which
 * cloud row is open and everything behind the Open dialog; the editor model and
 * library state stay in App and are passed in.
 */
import { useState } from "react";
import type { LayoutModel, Library } from "../model/types";
import { validate } from "../model/validate";
import {
  listProjects, loadProject, saveProject, deleteProject, projectLocal,
  listRevisions, loadRevision, getProjectVersion,
  listFolders, createFolder, renameFolder, deleteFolder, moveProject,
  type ProjectSummary, type RevisionSummary, type Folder,
} from "./projectStore";
import { clearDraft } from "./draft";
import type { Selection } from "../editor/FabricStage";
import type { useAuth } from "../auth/AuthContext";

export type Status =
  | { kind: "idle" }
  | { kind: "busy"; label: string }
  | { kind: "done"; label: string }
  | { kind: "error"; message: string };

export interface HistoryTarget { id: string; name: string; revs: RevisionSummary[] }

interface Args {
  auth: ReturnType<typeof useAuth>;
  ready: boolean;
  model: LayoutModel;
  library: Library;
  sharedLib: Library;
  sharedKeys: Set<string>;
  dirty: boolean;
  snapshot: string;
  set: (m: LayoutModel) => void;
  setLibrary: (l: Library) => void;
  setSelections: (s: Selection[]) => void;
  setStatus: (s: Status) => void;
  setCleanSnap: (s: string) => void;
}

export function useCloudProjects({
  auth, ready, model, library, sharedLib, sharedKeys, dirty, snapshot,
  set, setLibrary, setSelections, setStatus, setCleanSnap,
}: Args) {
  const [projectId, setProjectId] = useState<string | null>(null); // cloud row id of the open project
  const [baseUpdatedAt, setBaseUpdatedAt] = useState<string | null>(null); // loaded server version (stale-save guard)
  const [lastSaved, setLastSaved] = useState<{ name: string | null; at: string } | null>(null);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [projectList, setProjectList] = useState<ProjectSummary[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null); // open project's folder
  const [cloudBusy, setCloudBusy] = useState(false);
  const [historyFor, setHistoryFor] = useState<HistoryTarget | null>(null);

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

  /** New/blank project adopted in App: forget which cloud row was open. */
  function detachProject() {
    setProjectId(null);
    setCurrentFolderId(null);
  }

  return {
    projectId, lastSaved, projectsOpen, setProjectsOpen, projectList, folders,
    collapsedFolders, currentFolderId, cloudBusy, historyFor, setHistoryFor,
    applyLoaded, openProjectsModal, doOpenCloud, doSaveCloud, doDuplicateCurrent,
    doDuplicateFromList, openHistory, doRestoreRevision, doDeleteCloud,
    doNewFolder, doRenameFolder, doDeleteFolder, doMoveProject, toggleFolder,
    detachProject,
  };
}
