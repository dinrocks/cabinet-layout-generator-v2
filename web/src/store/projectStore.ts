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
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RawSummary {
  id: string;
  name: string;
  panel_tag: string;
  rev: string;
  updated_at: string;
  owner: { display_name: string | null } | { display_name: string | null }[] | null;
}

/** List the team's saved layouts (shared), newest first. */
export async function listProjects(): Promise<ProjectSummary[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("projects")
    .select("id,name,panel_tag,rev,updated_at,owner:profiles!projects_owner_fkey(display_name)")
    .order("updated_at", { ascending: false });
  if (error || !data) return [];
  return (data as unknown as RawSummary[]).map((r) => {
    const o = Array.isArray(r.owner) ? r.owner[0] : r.owner;
    return { id: r.id, name: r.name, panel_tag: r.panel_tag, rev: r.rev, updated_at: r.updated_at, owner_name: o?.display_name ?? null };
  });
}

export interface LoadedProject {
  model: LayoutModel;
  /** the project's non-seed library items, to merge over SEED_LIBRARY on open */
  library: Library;
}

/** Load a layout + its carried library; stamps project.id with the row id. */
export async function loadProject(id: string): Promise<LoadedProject | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from("projects").select("layout,library").eq("id", id).maybeSingle();
  if (error || !data) return null;
  const row = data as { layout: LayoutModel; library: Library | null };
  row.layout.project.id = id;
  return { model: row.layout, library: row.library ?? {} };
}

export type SaveResult = { id: string } | { error: string };

/**
 * Save a layout. `existingId` (the cloud row id of the currently-open project, or
 * null for a fresh one) decides update vs insert — kept separate from the model so
 * adopting a new id never pollutes undo history. Returns the row id to remember.
 */
export async function saveProject(model: LayoutModel, library: Library, sharedKeys: ReadonlySet<string>, userId: string, existingId: string | null): Promise<SaveResult> {
  if (!supabase) return { error: "offline" };
  const p = model.project;
  const row = {
    name: p.name || "Untitled",
    panel_tag: p.panel_tag ?? "",
    rev: p.rev || "A",
    layout: model,
    library: projectLocal(library, sharedKeys),
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };
  if (existingId && UUID_RE.test(existingId)) {
    const { data, error } = await supabase.from("projects").update(row).eq("id", existingId).select("id").maybeSingle();
    if (error) return { error: error.message };
    if (data) return { id: (data as { id: string }).id };
    // the row was deleted out from under us → fall through to insert a fresh one
  }
  const { data, error } = await supabase.from("projects").insert({ ...row, owner: userId }).select("id").single();
  if (error) return { error: error.message };
  return { id: (data as { id: string }).id };
}

export async function deleteProject(id: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from("projects").delete().eq("id", id);
  return !error;
}
