/**
 * Cloud persistence for layouts (Supabase `projects` table). Each layout is stored
 * as one `jsonb` blob (anti-lock-in). All functions no-op/return empty when cloud
 * isn't configured — callers fall back to the local-file path (localFile.ts).
 */
import { supabase } from "../lib/supabaseClient";
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

export interface ProjectSummary {
  id: string;
  name: string;
  panel_tag: string;
  rev: string;
  updated_at: string;
  owner_name: string | null;
  updated_by_name: string | null; // who saved it last (multi-user safety)
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
  owner: Embed;
  updater: Embed;
}

/** List the team's saved layouts (shared), newest first. */
export async function listProjects(): Promise<ProjectSummary[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("projects")
    .select("id,name,panel_tag,rev,updated_at,owner:profiles!projects_owner_fkey(display_name),updater:profiles!projects_updated_by_fkey(display_name)")
    .order("updated_at", { ascending: false });
  if (error || !data) return [];
  return (data as unknown as RawSummary[]).map((r) => ({
    id: r.id, name: r.name, panel_tag: r.panel_tag, rev: r.rev, updated_at: r.updated_at,
    owner_name: embedName(r.owner), updated_by_name: embedName(r.updater),
  }));
}

export interface LoadedProject {
  model: LayoutModel;
  /** the project's non-seed library items, to merge over SEED_LIBRARY on open */
  library: Library;
  /** server version at load — the base for the stale-save guard */
  updatedAt: string;
  updatedByName: string | null;
}

/** Load a layout + its carried library; stamps project.id with the row id. */
export async function loadProject(id: string): Promise<LoadedProject | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from("projects")
    .select("layout,library,updated_at,updater:profiles!projects_updated_by_fkey(display_name)")
    .eq("id", id).maybeSingle();
  if (error || !data) return null;
  const row = data as { layout: LayoutModel; library: Library | null; updated_at: string; updater: Embed };
  row.layout.project.id = id;
  return { model: row.layout, library: row.library ?? {}, updatedAt: row.updated_at, updatedByName: embedName(row.updater) };
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
    library: projectLocal(library, sharedKeys),
    updated_by: userId,
    updated_at: now,
  };
  if (existingId && UUID_RE.test(existingId)) {
    let q = supabase.from("projects").update(row).eq("id", existingId);
    if (baseUpdatedAt) q = q.eq("updated_at", baseUpdatedAt); // compare-and-set guard
    const { data, error } = await q.select("id").maybeSingle();
    if (error) return { error: error.message };
    if (data) return { id: (data as { id: string }).id, updatedAt: now };
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
  return { id: (data as { id: string }).id, updatedAt: now };
}

export async function deleteProject(id: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from("projects").delete().eq("id", id);
  return !error;
}
