/**
 * Crash-safe working copy in localStorage (RISK_REVIEW R2). While the layout has
 * unsaved changes, App writes a debounced draft here; on the next launch the user
 * is offered a restore. Best-effort by design — quota or private-mode failures are
 * swallowed (the real persistence is the cloud save / JSON download). Cleared on
 * save, open, and New. Stores only the PROJECT-LOCAL library items (shared parts
 * rehydrate from the `library_items` catalog on sign-in, same as a cloud open).
 */
import type { LayoutModel, Library } from "../model/types";

const KEY = "clg.draft.v1";

export interface Draft {
  model: LayoutModel;
  /** Project-local items only (custom parts, non-shared uploads). */
  library: Library;
  /** Cloud row id of the project being edited, if any. */
  projectId: string | null;
  savedAt: string; // ISO timestamp of the draft write
}

export function saveDraft(model: LayoutModel, library: Library, projectId: string | null): void {
  try {
    const d: Draft = { model, library, projectId, savedAt: new Date().toISOString() };
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* quota exceeded / storage unavailable — the draft is best-effort */
  }
}

export function loadDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    // minimal shape check; a corrupt draft is treated as absent
    return d && d.model && d.model.plate ? d : null;
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
