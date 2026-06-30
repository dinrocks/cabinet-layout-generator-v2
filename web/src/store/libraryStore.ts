/**
 * Shared equipment library (Supabase `library_items`). Uploaded-DXF parts a user
 * chooses to share live here so any project / teammate can use them. No-ops when
 * cloud isn't configured. Rows map 1:1 to a `DxfLibItem`.
 */
import { supabase } from "../lib/supabaseClient";
import type { DxfLibItem, Library } from "../model/types";

interface Row {
  lib_key: string;
  name: string;
  width_mm: number;
  height_mm: number;
  block_ref: string;
  svg_ref: string | null;
  rail_offset_mm: number | null;
  band: number | null;
  manufacturer: string | null;
  model: string | null;
  description: string | null;
}

/** All shared parts, keyed by lib_key, ready to merge into the library state. */
export async function listLibraryItems(): Promise<Library> {
  if (!supabase) return {};
  const { data, error } = await supabase
    .from("library_items")
    .select("lib_key,name,width_mm,height_mm,block_ref,svg_ref,rail_offset_mm,band,manufacturer,model,description");
  if (error || !data) return {};
  const out: Library = {};
  for (const r of data as Row[]) {
    const item: DxfLibItem = {
      lib_key: r.lib_key, source: "dxf", name: r.name,
      width_mm: r.width_mm, height_mm: r.height_mm,
      block_ref: r.block_ref, svg_ref: r.svg_ref ?? "",
    };
    if (r.rail_offset_mm != null) item.rail_offset_mm = r.rail_offset_mm;
    if (r.band != null) item.band = r.band;
    if (r.manufacturer) item.manufacturer = r.manufacturer;
    if (r.model) item.model = r.model;
    if (r.description) item.description = r.description;
    out[r.lib_key] = item;
  }
  return out;
}

/** Add an uploaded part to the shared catalog. Returns false on failure (e.g. RLS). */
export async function addLibraryItem(item: DxfLibItem, userId: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from("library_items").insert({
    lib_key: item.lib_key, name: item.name, source: "dxf",
    width_mm: item.width_mm, height_mm: item.height_mm,
    block_ref: item.block_ref, svg_ref: item.svg_ref ?? null,
    rail_offset_mm: item.rail_offset_mm ?? null, band: item.band ?? null,
    manufacturer: item.manufacturer ?? null, model: item.model ?? null, description: item.description ?? null,
    created_by: userId,
  });
  return !error;
}

/** Rename / recategorise / edit BOM fields of a shared part (admin-only, RLS). */
export async function updateLibraryItem(
  libKey: string,
  patch: { name?: string; band?: number; manufacturer?: string; model?: string; description?: string },
): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from("library_items").update(patch).eq("lib_key", libKey);
  return !error;
}

/** Remove a shared part (admin-only, enforced by RLS). */
export async function deleteLibraryItem(libKey: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from("library_items").delete().eq("lib_key", libKey);
  return !error;
}
