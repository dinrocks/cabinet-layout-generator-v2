/**
 * Share-link dialog for the OPEN cloud project: create the link (generates the
 * token), copy it, or revoke it (clears the token — the link dies instantly).
 * The link shows the latest SAVED version, read-only (share/ShareViewer.tsx).
 */
import { useEffect, useState } from "react";
import { getShareToken, setShareToken } from "../store/projectStore";
import { newShareToken, shareUrl } from "../lib/shareToken";

interface Props {
  projectId: string;
  projectName: string;
  onClose: () => void;
}

export default function ShareModal({ projectId, projectName, onClose }: Props) {
  const [token, setToken] = useState<string | null | "loading">("loading");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    getShareToken(projectId).then((t) => { if (alive) setToken(t); });
    return () => { alive = false; };
  }, [projectId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function create() {
    setBusy(true);
    const t = newShareToken();
    const ok = await setShareToken(projectId, t);
    setBusy(false);
    if (ok) setToken(t);
  }
  async function revoke() {
    if (!window.confirm("Revoke this link? Anyone holding it loses access immediately.")) return;
    setBusy(true);
    const ok = await setShareToken(projectId, null);
    setBusy(false);
    if (ok) { setToken(null); setCopied(false); }
  }
  async function copy(t: string) {
    await navigator.clipboard.writeText(shareUrl(t));
    setCopied(true);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Share “{projectName || "Untitled"}”</h3>
        {token === "loading" ? (
          <p className="muted small">Checking…</p>
        ) : token ? (
          <>
            <p className="muted small">
              Anyone with this link can <b>view and print</b> the latest saved version — no sign-in,
              no editing, no DXF. Revoke it any time.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <input readOnly value={shareUrl(token)} style={{ flex: 1 }} onFocus={(e) => e.target.select()} />
              <button type="button" onClick={() => copy(token)}>{copied ? "✓ Copied" : "Copy"}</button>
            </div>
            <div className="modal-actions">
              <button type="button" className="danger" disabled={busy} onClick={revoke}>Revoke link</button>
              <button type="button" onClick={onClose}>Close</button>
            </div>
          </>
        ) : (
          <>
            <p className="muted small">
              Create a read-only link for people outside the team (client, boss, panel shop): they see
              the latest saved version and can download the PDF/PNG sheets — nothing else.
            </p>
            <div className="modal-actions">
              <button type="button" className="ghost" onClick={onClose}>Cancel</button>
              <button type="button" disabled={busy} onClick={create}>Create link</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
