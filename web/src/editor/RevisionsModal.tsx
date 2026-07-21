/**
 * Project history: restorable saves (RISK_REVIEW R1, top) + the activity/audit
 * trail (who did what, when — created/saved/shared/…). Restoring loads a version
 * into the editor as UNSAVED work (nothing on the server changes until Save, which
 * then runs the stale-save guard). Deliberate close only (Close / Esc).
 */
import { useEffect } from "react";
import type { RevisionSummary, ProjectEvent, EventAction } from "../store/projectStore";

interface Props {
  projectName: string;
  revisions: RevisionSummary[];
  events: ProjectEvent[];
  busy: boolean;
  onRestore: (revId: string) => void;
  onClose: () => void;
}

const ACTION_LABEL: Record<EventAction, string> = {
  created: "created", saved: "saved", duplicated: "duplicated",
  deleted: "deleted", shared: "shared a link", unshared: "revoked the link",
};

export default function RevisionsModal({ projectName, revisions, events, busy, onRestore, onClose }: Props) {
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
          <p className="bom-empty">No saved versions yet — it starts recording from the next Save.</p>
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

        <p className="bom-fields-head">Activity <span>(who did what — read-only)</span></p>
        {events.length === 0 ? (
          <p className="bom-empty">No activity recorded yet.</p>
        ) : (
          <ul className="activity">
            {events.map((e) => (
              <li key={e.id}>
                <span className="act-who">{e.actor_name ?? "—"}</span>
                {" "}<span className="act-what">{ACTION_LABEL[e.action] ?? e.action}</span>
                {e.detail ? <span className="act-detail"> · {e.detail}</span> : null}
                <span className="act-when" title={new Date(e.at).toLocaleString()}> · {new Date(e.at).toLocaleString()}</span>
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
