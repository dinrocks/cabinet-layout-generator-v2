/**
 * Cloud persistence for layouts (Supabase `projects` table). Each layout is stored
 * as one `jsonb` blob (anti-lock-in). All functions no-op/return empty when cloud
 * isn't configured — callers fall back to the local-file path (localFile.ts).
 */
import { supabase } from "../lib/supabaseClient";
import { rowToItem, type LibraryRow } from "./libraryStore";
import { SEED_LIBRARY } from "../model/library";
import type { LayoutModel, Library } from "../model/types";

/**
 * The library items a project must carry itself: everything that's neither in the
 * static seed nor in the shared catalog (i.e. custom parts + project-local uploads).
 * Shared parts come from `library_items` on load, so they're not duplicated here.
 */
export function projectLocal(library: Library, sharedKeys: ReadonlySet<string>): Library {
  return Object.fromEntries(
    Object.entries(library).filter(([k]) => !(k in SEED_LIBRARY) && !sharedKeys.has(k)),
  );
}

/** Every lib_key the model actually places (elements, sets, and set caps). */
function referencedKeys(model: LayoutModel): Set<string> {
  const s = new Set<string>();
  for (const e of model.elements) s.add(e.lib_key);
  for (const g of model.groups) {
    s.add(g.lib_key);
    if (g.cap_start_key) s.add(g.cap_start_key);
    if (g.cap_end_key) s.add(g.cap_end_key);
  }
  return s;
}

/**
 * Project-local library for saving, minus **orphaned per-instance items** — the
 * `label_plate`/`custom` parts minted at placement that nothing references any
 * more (they accumulate forever otherwise; RISK_REVIEW R6). Uploaded DXF parts are
 * always kept, even unplaced, so an upload-then-save-before-placing never loses them.
 */
export function cleanProjectLocal(model: LayoutModel, library: Library, sharedKeys: ReadonlySet<string>): Library {
  const used = referencedKeys(model);
  return Object.fromEntries(
    Object.entries(projectLocal(library, sharedKeys)).filter(([k, it]) => {
      const perInstance = it.source === "rect" && (it.label_plate === true || it.custom === true);
      return !perInstance || used.has(k);
    }),
  );
}

export interface ProjectSummary {
  id: string;
  name: string;
  panel_tag: string;
  rev: string;
  updated_at: string;
  owner_name: string | null;
  updated_by_name: string | null; // who saved it last (multi-user safety)
  folder_id: string | null;       // grouping folder (null = Unfiled)
}

export interface Folder {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A PostgREST embed can come back as an object or a 1-element array; flatten it. */
type Embed = { display_name: string | null } | { display_name: string | null }[] | null;
const embedName = (e: Embed): string | null => (Array.isArray(e) ? e[0] : e)?.display_name ?? null;

interface RawSummary {
  id: string;
  name: string;
  panel_tag: string;
  rev: string;
  updated_at: string;
  folder_id: string | null;
  owner: Embed;
  updater: Embed;
}

/** List the team's saved layouts (shared), newest first. */
export async function listProjects(): Promise<ProjectSummary[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("projects")
    .select("id,name,panel_tag,rev,updated_at,folder_id,owner:profiles!projects_owner_fkey(display_name),updater:profiles!projects_updated_by_fkey(display_name)")
    .order("updated_at", { ascending: false });
  if (error || !data) return [];
  return (data as unknown as RawSummary[]).map((r) => ({
    id: r.id, name: r.name, panel_tag: r.panel_tag, rev: r.rev, updated_at: r.updated_at,
    folder_id: r.folder_id ?? null, owner_name: embedName(r.owner), updated_by_name: embedName(r.updater),
  }));
}

/** The team's folders (shared). */
export async function listFolders(): Promise<Folder[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("folders").select("id,name,created_at,updated_at");
  if (error || !data) return [];
  return data as Folder[];
}

/** Create a folder; returns its id (or null on failure). */
export async function createFolder(name: string, userId: string): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from("folders").insert({ name, owner: userId }).select("id").single();
  return error ? null : (data as { id: string }).id;
}

export async function renameFolder(id: string, name: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from("folders").update({ name, updated_at: new Date().toISOString() }).eq("id", id);
  return !error;
}

/** Delete a folder — its layouts are un-filed (folder_id → null via ON DELETE SET NULL). */
export async function deleteFolder(id: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from("folders").delete().eq("id", id);
  return !error;
}

/** Move a layout into a folder (or out to Unfiled with null). */
export async function moveProject(projectId: string, folderId: string | null): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from("projects").update({ folder_id: folderId }).eq("id", projectId);
  return !error;
}

export interface LoadedProject {
  model: LayoutModel;
  /** the project's non-seed library items, to merge over SEED_LIBRARY on open */
  library: Library;
  /** server version at load — the base for the stale-save guard */
  updatedAt: string;
  updatedByName: string | null;
  folderId: string | null;
}

/** Load a layout + its carried library; stamps project.id with the row id. */
export async function loadProject(id: string): Promise<LoadedProject | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from("projects")
    .select("layout,library,updated_at,folder_id,updater:profiles!projects_updated_by_fkey(display_name)")
    .eq("id", id).maybeSingle();
  if (error || !data) return null;
  const row = data as { layout: LayoutModel; library: Library | null; updated_at: string; folder_id: string | null; updater: Embed };
  row.layout.project.id = id;
  return { model: row.layout, library: row.library ?? {}, updatedAt: row.updated_at, updatedByName: embedName(row.updater), folderId: row.folder_id ?? null };
}

export type SaveResult =
  | { id: string; updatedAt: string }
  | { error: string }
  /** someone else saved after we loaded — caller must warn (reload / overwrite). */
  | { conflict: { updatedAt: string; updatedByName: string | null } };

/**
 * Save a layout. `existingId` = the cloud row id of the open project (null = fresh).
 * `baseUpdatedAt` = the `updated_at` we loaded; when set, the update is a
 * compare-and-set (`.eq(updated_at, base)`) so a save that would silently clobber a
 * newer version returns `{ conflict }` instead. Pass the conflict's `updatedAt` back
 * as `baseUpdatedAt` to force an overwrite ("Save anyway"). Returns the new version.
 */
export async function saveProject(
  model: LayoutModel, library: Library, sharedKeys: ReadonlySet<string>,
  userId: string, existingId: string | null, baseUpdatedAt: string | null,
): Promise<SaveResult> {
  if (!supabase) return { error: "offline" };
  const p = model.project;
  const now = new Date().toISOString();
  const row = {
    name: p.name || "Untitled",
    panel_tag: p.panel_tag ?? "",
    rev: p.rev || "A",
    layout: model,
    library: cleanProjectLocal(model, library, sharedKeys),
    updated_by: userId,
    updated_at: now,
  };
  if (existingId && UUID_RE.test(existingId)) {
    let q = supabase.from("projects").update(row).eq("id", existingId);
    if (baseUpdatedAt) q = q.eq("updated_at", baseUpdatedAt); // compare-and-set guard
    const { data, error } = await q.select("id").maybeSingle();
    if (error) return { error: error.message };
    if (data) {
      await writeRevision(existingId, row, userId); // history, best-effort
      await logEvent(existingId, row.name, "saved"); // audit, best-effort
      return { id: (data as { id: string }).id, updatedAt: now };
    }
    // 0 rows matched: the row either changed under us (conflict) or was deleted.
    const { data: cur } = await supabase.from("projects")
      .select("updated_at,updater:profiles!projects_updated_by_fkey(display_name)")
      .eq("id", existingId).maybeSingle();
    if (cur) {
      const c = cur as { updated_at: string; updater: Embed };
      return { conflict: { updatedAt: c.updated_at, updatedByName: embedName(c.updater) } };
    }
    // row was deleted → fall through to insert a fresh one
  }
  const { data, error } = await supabase.from("projects").insert({ ...row, owner: userId }).select("id").single();
  if (error) return { error: error.message };
  const newId = (data as { id: string }).id;
  await writeRevision(newId, row, userId); // history, best-effort
  await logEvent(newId, row.name, "created"); // audit, best-effort
  return { id: newId, updatedAt: now };
}

export async function deleteProject(id: string): Promise<boolean> {
  if (!supabase) return false;
  // snapshot the name + log BEFORE the delete: the FK on-delete-set-null then nulls
  // the event's project_id, so the delete stays auditable with the name intact.
  const { data: cur } = await supabase.from("projects").select("name").eq("id", id).maybeSingle();
  const name = (cur as { name: string } | null)?.name ?? "Untitled";
  await logEvent(id, name, "deleted");
  const { error } = await supabase.from("projects").delete().eq("id", id);
  return !error;
}

// ── audit log: who did what, when (append-only project_events) ──────────────

export type EventAction = "created" | "saved" | "duplicated" | "deleted" | "shared" | "unshared";

export interface ProjectEvent {
  id: string;
  action: EventAction;
  detail: string | null;
  at: string;
  actor_name: string | null;
}

/** Append one activity event — best-effort (never fails the operation it records).
 *  The actor is resolved from the session so callers don't thread the user id. */
async function logEvent(projectId: string | null, projectName: string, action: EventAction, detail?: string): Promise<void> {
  if (!supabase) return;
  try {
    const { data } = await supabase.auth.getSession();
    const actor = data.session?.user.id;
    if (!actor) return;
    await supabase.from("project_events").insert({
      project_id: projectId, project_name: projectName || "Untitled", actor, action, detail: detail ?? null,
    });
  } catch {
    /* audit is best-effort */
  }
}

/** A project's activity trail, newest first. */
export async function listProjectEvents(projectId: string, limit = 50): Promise<ProjectEvent[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("project_events")
    .select("id,action,detail,at,actor:profiles!project_events_actor_fkey(display_name)")
    .eq("project_id", projectId)
    .order("at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return (data as unknown as Array<{ id: string; action: EventAction; detail: string | null; at: string; actor: Embed }>)
    .map((r) => ({ id: r.id, action: r.action, detail: r.detail, at: r.at, actor_name: embedName(r.actor) }));
}

// ── revisions (RISK_REVIEW R1): every save also appends here; DB trims to ~20 ──

export interface RevisionSummary {
  id: string;
  name: string;
  saved_at: string;
  saved_by_name: string | null;
}

/** Best-effort: a failed revision write must never fail the save itself. */
async function writeRevision(projectId: string, row: { name: string; layout: LayoutModel; library: Library }, userId: string): Promise<void> {
  if (!supabase) return;
  await supabase.from("project_revisions").insert({
    project_id: projectId, name: row.name, layout: row.layout, library: row.library, saved_by: userId,
  });
}

/** A project's saved revisions, newest first. */
export async function listRevisions(projectId: string): Promise<RevisionSummary[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("project_revisions")
    .select("id,name,saved_at,saver:profiles!project_revisions_saved_by_fkey(display_name)")
    .eq("project_id", projectId)
    .order("saved_at", { ascending: false });
  if (error || !data) return [];
  return (data as unknown as Array<{ id: string; name: string; saved_at: string; saver: Embed }>).map((r) => ({
    id: r.id, name: r.name, saved_at: r.saved_at, saved_by_name: embedName(r.saver),
  }));
}

/** The content of one revision (to load into the editor as unsaved work). */
export async function loadRevision(revId: string): Promise<{ model: LayoutModel; library: Library } | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from("project_revisions").select("layout,library").eq("id", revId).maybeSingle();
  if (error || !data) return null;
  const row = data as { layout: LayoutModel; library: Library | null };
  return { model: row.layout, library: row.library ?? {} };
}

/** The live row's current version (base for the stale-save guard after a restore). */
export async function getProjectVersion(id: string): Promise<{ updatedAt: string; updatedByName: string | null } | null> {
  if (!supabase) return null;
  const { data } = await supabase.from("projects")
    .select("updated_at,updater:profiles!projects_updated_by_fkey(display_name)")
    .eq("id", id).maybeSingle();
  if (!data) return null;
  const r = data as { updated_at: string; updater: Embed };
  return { updatedAt: r.updated_at, updatedByName: embedName(r.updater) };
}

// ── Phase 3: read-only share links ──────────────────────────────────────────

/** The project's current share token (null = not shared). Members only (RLS). */
export async function getShareToken(projectId: string): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from("projects").select("share_token").eq("id", projectId).single();
  if (error || !data) return null;
  return (data as { share_token: string | null }).share_token;
}

/** Set (share) or clear (revoke) the token. Members only (RLS update policy). */
export async function setShareToken(projectId: string, token: string | null): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from("projects").update({ share_token: token }).eq("id", projectId);
  if (!error) {
    const { data: cur } = await supabase.from("projects").select("name").eq("id", projectId).maybeSingle();
    await logEvent(projectId, (cur as { name: string } | null)?.name ?? "Untitled", token ? "shared" : "unshared");
  }
  return !error;
}

/** Anonymous exact-token fetch via the shared_project RPC (the ONLY open door).
 *  Returns null for an unknown/revoked token. `catalog` = the shared library_items
 *  the layout references (viewers can't read the members-only catalog directly). */
export async function loadSharedProject(token: string):
  Promise<{ name: string; model: LayoutModel; library: Library; updatedAt: string } | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("shared_project", { token });
  const row = (Array.isArray(data) ? data[0] : data) as
    | { name: string; layout: LayoutModel; library: Library | null; catalog: Record<string, LibraryRow> | null; updated_at: string }
    | undefined;
  if (error || !row?.layout) return null;
  const catalog: Library = Object.fromEntries(
    Object.entries(row.catalog ?? {}).map(([k, r]) => [k, rowToItem(r)]),
  );
  return {
    name: row.name, model: row.layout,
    library: { ...catalog, ...(row.library ?? {}) },
    updatedAt: row.updated_at,
  };
}
