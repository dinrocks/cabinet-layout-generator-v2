/**
 * The top bar: project name, file/history/view/export groups, status chips and the
 * account cluster. Extracted verbatim from App.tsx (ROADMAP #8) — view only; all
 * state stays in App / useCloudProjects and arrives as props.
 */
import type { LayoutModel } from "../model/types";
import type { useAuth } from "../auth/AuthContext";
import { cloudEnabled } from "../lib/supabaseClient";
import { timeAgo } from "../lib/timeAgo";
import { clampZoom } from "./zoom";
import type { DxfScale } from "../service/dxfClient";
import type { Paper } from "../render/page";
import type { Status } from "../store/useCloudProjects";

interface Props {
  model: LayoutModel;
  auth: ReturnType<typeof useAuth>;
  ready: boolean;
  dirty: boolean;
  status: Status;
  busy: boolean;
  lastSaved: { name: string | null; at: string } | null;
  cloudBusy: boolean;
  svc: "checking" | "online" | "offline";
  dxfScale: DxfScale;
  paper: Paper;
  zoom: number;
  alignEnabled: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onRename: (name: string) => void;
  onNew: () => void;
  onOpenProjects: () => void;
  onSave: () => void;
  onDuplicate: () => void;
  onDownload: () => void;
  onOpenFile: () => void;
  onBundle: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onZoom: (z: number) => void;
  onFit: () => void;
  onAlign: (on: boolean) => void;
  onCheckSvc: () => void;
  onDxfScale: (s: DxfScale) => void;
  onPaper: (p: Paper) => void;
  onExportDxf: () => void;
  onPdf: () => void;
  onPng: () => void;
  onSvg: () => void;
  onBom: () => void;
}

export default function Toolbar({
  model, auth, ready, dirty, status, busy, lastSaved, cloudBusy, svc, dxfScale, paper,
  zoom, alignEnabled, canUndo, canRedo,
  onRename, onNew, onOpenProjects, onSave, onDuplicate, onDownload, onOpenFile, onBundle,
  onUndo, onRedo, onZoom, onFit, onAlign, onCheckSvc, onDxfScale, onPaper,
  onExportDxf, onPdf, onPng, onSvg, onBom,
}: Props) {
  return (
    <header className="topbar">
      <strong>Cabinet Layout Generator</strong>
      <span className="muted">
        <span className="projname-field" title="Click to rename this project">
          <span className="projname-ico" aria-hidden="true">✎</span>
          <input className="projname" value={model.project.name} placeholder="Untitled project"
            onChange={(e) => onRename(e.target.value)} aria-label="Project name" />
        </span>
        <span className="dim">· {model.plate.width_mm}×{model.plate.height_mm} mm</span>
        {lastSaved && (
          <span className="savedby" title={`Last saved ${new Date(lastSaved.at).toLocaleString()}`}>
            · saved by {lastSaved.name || "—"} {timeAgo(lastSaved.at)}
          </span>
        )}
      </span>

      <div className="toolbar">
        {/* File */}
        <span className="group">
          <button type="button" title="New layout" onClick={onNew}>New</button>
          {ready && <button type="button" title="Open a saved layout" onClick={onOpenProjects}>Open…</button>}
          {ready && <button type="button" title="Save to the cloud" disabled={cloudBusy} onClick={onSave}>Save</button>}
          {ready && <button type="button" className="ghost" title="Save the current layout as a new project (a copy) and switch to it" disabled={cloudBusy} onClick={onDuplicate}>Duplicate</button>}
          <button type="button" className="ghost icon" title="Download layout as JSON" onClick={onDownload}>⬇</button>
          <button type="button" className="ghost icon" title="Open a layout JSON file" onClick={onOpenFile}>⬆</button>
          <button type="button" className="ghost" disabled={busy}
            title="Portable bundle: one ZIP with the layout JSON + every placed equipment DXF (nothing trapped in the cloud). Needs the DXF service for uploaded parts."
            onClick={onBundle}>Bundle</button>
        </span>
        {/* History */}
        <span className="group">
          <button type="button" onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">↶</button>
          <button type="button" onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">↷</button>
        </span>
        {/* View */}
        <span className="group">
          <button type="button" className="icon" title="Zoom out" onClick={() => onZoom(clampZoom(zoom / 1.25))}>−</button>
          <span className="zoompct" title="Current zoom">{Math.round(zoom * 100)}%</span>
          <button type="button" className="icon" title="Zoom in" onClick={() => onZoom(clampZoom(zoom * 1.25))}>+</button>
          <button type="button" className="ghost" title="Fit to view" onClick={onFit}>Fit</button>
          <label className="field" title="Snap a dragged part adjacent to its neighbour with the 0.1mm gap, aligned to the rail centerline">
            <input type="checkbox" checked={alignEnabled} onChange={(e) => onAlign(e.target.checked)} />
            Align
          </label>
        </span>
        {/* Export — DXF */}
        <span className="group">
          <button type="button" className={`svc svc-${svc}`} onClick={onCheckSvc}
            title={
              svc === "online" ? "ezdxf service online — DXF upload/export available (click to re-check)"
                : svc === "offline" ? "ezdxf service offline — DXF disabled; PDF/PNG/SVG still work (click to retry)"
                  : "checking ezdxf service…"
            }>
            <span className="dot" /> DXF service: {svc}
          </button>
          <label className="field">DXF
            <select value={dxfScale} onChange={(e) => onDxfScale(e.target.value as DxfScale)}>
              <option value="1:1">1:1</option><option value="1:100">1:100</option>
            </select>
          </label>
          <button type="button" disabled={busy} onClick={onExportDxf}>Export DXF</button>
        </span>
        {/* Export — page + BOM */}
        <span className="group">
          <label className="field">Paper
            <select value={paper} onChange={(e) => onPaper(e.target.value as Paper)}>
              <option value="A4">A4</option><option value="A3">A3</option>
            </select>
          </label>
          <button type="button" className="ghost" disabled={busy} onClick={onPdf}>PDF</button>
          <button type="button" className="ghost" disabled={busy} onClick={onPng}>PNG</button>
          <button type="button" className="ghost" disabled={busy} onClick={onSvg}>SVG</button>
          <button type="button" className="ghost" title="Bill of Materials — count placed parts by category, export CSV" onClick={onBom}>BOM</button>
        </span>
        {/* Right cluster: help · status · account (pushed right) */}
        <span className="group right">
          <button type="button" className="ghost" title="How to use this tool (opens in a new tab)"
            onClick={() => window.open("/guide.html", "_blank", "noopener")}>? Guide</button>
        </span>
        {dirty && <span className="status dirty" title="Unsaved changes — Save (cloud) or ⬇ (file)">● unsaved</span>}
        {status.kind === "busy" && <span className="status">… {status.label}</span>}
        {status.kind === "done" && !dirty && <span className="status ok">✓ {status.label}</span>}
        {status.kind === "error" && <span className="status err" title={status.message}>✗ {status.message}</span>}
        <span className="group">
          {cloudEnabled && ready && auth.profile ? (
            <span className="acct">
              <span className="name" title={auth.email ?? ""}>{auth.profile.display_name || auth.email}</span>
              <button type="button" onClick={auth.signOut}>Sign out</button>
            </span>
          ) : !cloudEnabled ? (
            <span className="acct mode" title="Cloud sign-in not configured — running locally">Local mode</span>
          ) : null}
        </span>
      </div>
    </header>
  );
}
