/**
 * Read-only share-link viewer (Phase 3): rendered instead of the app when the URL
 * carries ?share=<token>. Anonymous — fetches the layout through the exact-token
 * RPC, renders it with THE renderer (toSvg, so it matches the editor and exports
 * exactly), and offers the in-browser PDF/PNG sheet downloads. No editing, no
 * DXF, no service dependency.
 */
import { useEffect, useState } from "react";
import type { LayoutModel, Library } from "../model/types";
import { loadSharedProject } from "../store/projectStore";
import { cloudEnabled } from "../lib/supabaseClient";
import { renderToSvg } from "../render/toSvg";
import { downloadPdf, downloadPng, downloadBomPdf } from "../export/inBrowser";
import type { Paper } from "../render/page";
import { timeAgo } from "../lib/timeAgo";

type State =
  | { kind: "loading" }
  | { kind: "invalid" }
  | { kind: "ready"; name: string; model: LayoutModel; library: Library; updatedAt: string };

const wrap: React.CSSProperties = { maxWidth: 1100, margin: "0 auto", padding: "18px 22px", fontFamily: "Arial, Helvetica, sans-serif" };

export default function ShareViewer({ token }: { token: string }) {
  // no cloud configured → a share token can never resolve
  const [state, setState] = useState<State>(cloudEnabled ? { kind: "loading" } : { kind: "invalid" });
  const [paper, setPaper] = useState<Paper>("A3");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!cloudEnabled) return;
    loadSharedProject(token).then((res) => {
      if (!alive) return;
      setState(res ? { kind: "ready", ...res } : { kind: "invalid" });
    });
    return () => { alive = false; };
  }, [token]);

  if (state.kind === "loading") return <div style={wrap}><p>Loading shared layout…</p></div>;
  if (state.kind === "invalid") {
    return (
      <div style={wrap}>
        <h2>This link isn't valid</h2>
        <p>The share link is wrong, or it was revoked by the project's team.</p>
      </div>
    );
  }

  const { name, model, library, updatedAt } = state;
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  return (
    <div style={wrap}>
      <header style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", borderBottom: "1px solid #e4e7ec", paddingBottom: 10, marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>{name || "Untitled"}</h2>
        <span style={{ color: "#6b7280", fontSize: 14 }}>
          read-only shared view · {model.plate.width_mm}×{model.plate.height_mm} mm · saved {timeAgo(updatedAt)}
        </span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <label style={{ fontSize: 14, color: "#374151" }}>Paper{" "}
            <select value={paper} onChange={(e) => setPaper(e.target.value as Paper)}>
              <option value="A4">A4</option><option value="A3">A3</option>
            </select>
          </label>
          <button type="button" disabled={busy} onClick={() => run(() => downloadPdf(model, library, paper))}>PDF</button>
          <button type="button" disabled={busy} onClick={() => run(() => downloadPng(model, library, paper))}>PNG</button>
          <button type="button" disabled={busy} onClick={() => run(() => downloadBomPdf(model, library, paper))}>BOM PDF</button>
        </span>
      </header>
      <div
        style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8, padding: 12, overflow: "auto" }}
        // the same deterministic renderer as the editor/exports — nothing re-drawn
        dangerouslySetInnerHTML={{ __html: renderToSvg(model, library, { unitsPerMm: 1 }).replace("<svg ", `<svg style="width:100%;height:auto" `) }}
      />
      <p style={{ color: "#6b7280", fontSize: 13 }}>
        Shared from Cabinet Layout Generator — this link always shows the latest saved version.
      </p>
    </div>
  );
}
