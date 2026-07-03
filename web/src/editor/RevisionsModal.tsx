/**
 * Project history (RISK_REVIEW R1) — the last ~20 saves of a project, newest
 * first. Restoring loads that version into the editor as UNSAVED work (nothing
 * on the server changes until the user hits Save, which then goes through the
 * normal stale-save guard). Deliberate close only (Close / Esc).
 */
import { useEffect } from "react";
import type { RevisionSummary } from "../store/projectStore";

interface Props {
  projectName: string;
  revisions: RevisionSummary[];
  busy: boolean;
  onRestore: (revId: string) => void;
  onClose: () => void;
}

export default function RevisionsModal({ projectName, revisions, busy, onRestore, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h3>History — {projectName || "Untitled"}</h3>
        <p className="bom-note">
          Every Save keeps a copy here (the last 20). Restore loads that version into the editor as
          <strong> unsaved</strong> work — press Save afterwards to make it the live version.
        </p>
        {revisions.length === 0 ? (
          <p className="bom-empty">No history yet — it starts recording from the next Save.</p>
        ) : (
          <ul className="plist">
            {revisions.map((r, i) => (
              <li key={r.id}>
                <button type="button" className="plist-open" disabled={busy} onClick={() => onRestore(r.id)}>
                  <span className="pn">{i === 0 ? "Latest save" : `${i} save${i > 1 ? "s" : ""} back`}{r.name !== projectName ? ` · "${r.name}"` : ""}</span>
                  <span className="pm">saved by {r.saved_by_name ?? "—"} · {new Date(r.saved_at).toLocaleString()}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
