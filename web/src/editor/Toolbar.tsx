/**
 * 顶部工具栏：项目名称、文件、历史、视图、导出、状态和账户。
 * 保留原有业务逻辑，仅中文化面向用户的文字。
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
  shareableId: string | null;
  onShare: () => void;
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
  onRename, onNew, onOpenProjects, onSave, onDuplicate, onDownload, onOpenFile, onBundle, shareableId, onShare,
  onUndo, onRedo, onZoom, onFit, onAlign, onCheckSvc, onDxfScale, onPaper,
  onExportDxf, onPdf, onPng, onSvg, onBom,
}: Props) {
  const svcText = svc === "online" ? "在线" : svc === "offline" ? "离线" : "检测中";

  return (
    <header className="topbar">
      <strong>电柜布局生成器</strong>
      <span className="muted">
        <span className="projname-field" title="点击可重命名当前项目">
          <span className="projname-ico" aria-hidden="true">✎</span>
          <input className="projname" value={model.project.name} placeholder="未命名项目"
            onChange={(e) => onRename(e.target.value)} aria-label="项目名称" />
        </span>
        <span className="dim">· {model.plate.width_mm}×{model.plate.height_mm} mm</span>
        {lastSaved && (
          <span className="savedby" title={`最后保存时间 ${new Date(lastSaved.at).toLocaleString()}`}>
            · {lastSaved.name || "—"} 保存于 {timeAgo(lastSaved.at)}
          </span>
        )}
      </span>

      <div className="toolbar">
        <span className="group">
          <button type="button" title="新建布局" onClick={onNew}>新建</button>
          {ready && <button type="button" title="打开已保存项目" onClick={onOpenProjects}>打开…</button>}
          {ready && <button type="button" title="保存到云端" disabled={cloudBusy} onClick={onSave}>保存</button>}
          {ready && <button type="button" className="ghost" title="另存为一个新项目并切换到副本" disabled={cloudBusy} onClick={onDuplicate}>复制项目</button>}
          {ready && (
            <button type="button" className="ghost" disabled={!shareableId || cloudBusy}
              title={shareableId
                ? "生成只读分享链接，可查看并导出最新版 PDF/PNG"
                : "请先保存到云端，再生成只读分享链接"}
              onClick={onShare}>分享</button>
          )}
          <button type="button" className="ghost icon" title="下载布局 JSON 文件" onClick={onDownload}>⬇</button>
          <button type="button" className="ghost icon" title="打开布局 JSON 文件" onClick={onOpenFile}>⬆</button>
          <button type="button" className="ghost" disabled={busy}
            title="打包导出：布局 JSON + 已使用元器件 DXF，一次生成 ZIP 文件"
            onClick={onBundle}>打包</button>
        </span>

        <span className="group">
          <button type="button" onClick={onUndo} disabled={!canUndo} title="撤销 (Ctrl+Z)">↶</button>
          <button type="button" onClick={onRedo} disabled={!canRedo} title="重做 (Ctrl+Shift+Z)">↷</button>
        </span>

        <span className="group">
          <button type="button" className="icon" title="缩小" onClick={() => onZoom(clampZoom(zoom / 1.25))}>−</button>
          <span className="zoompct" title="当前缩放比例">{Math.round(zoom * 100)}%</span>
          <button type="button" className="icon" title="放大" onClick={() => onZoom(clampZoom(zoom * 1.25))}>+</button>
          <button type="button" className="ghost" title="适合窗口" onClick={onFit}>适合</button>
          <label className="field" title="拖动元件时自动按0.1mm间隙吸附，并与导轨中心线对齐">
            <input type="checkbox" checked={alignEnabled} onChange={(e) => onAlign(e.target.checked)} />
            自动对齐
          </label>
        </span>

        <span className="group">
          <button type="button" className={`svc svc-${svc}`} onClick={onCheckSvc}
            title={
              svc === "online" ? "DXF 服务在线，可上传和导出 DXF，点击重新检测"
                : svc === "offline" ? "DXF 服务离线，DXF 上传/导出不可用；PDF/PNG/SVG 仍可使用"
                  : "正在检测 DXF 服务…"
            }>
            <span className="dot" /> DXF服务：{svcText}
          </button>
          <label className="field">DXF比例
            <select value={dxfScale} onChange={(e) => onDxfScale(e.target.value as DxfScale)}>
              <option value="1:1">1:1</option><option value="1:100">1:100</option>
            </select>
          </label>
          <button type="button" disabled={busy} onClick={onExportDxf}>导出DXF</button>
        </span>

        <span className="group">
          <label className="field">图纸
            <select value={paper} onChange={(e) => onPaper(e.target.value as Paper)}>
              <option value="A4">A4</option><option value="A3">A3</option>
            </select>
          </label>
          <button type="button" className="ghost" disabled={busy} onClick={onPdf}>PDF</button>
          <button type="button" className="ghost" disabled={busy} onClick={onPng}>PNG</button>
          <button type="button" className="ghost" disabled={busy} onClick={onSvg}>SVG</button>
          <button type="button" className="ghost" title="物料清单：按分类统计已放置元器件，并可导出CSV" onClick={onBom}>BOM清单</button>
        </span>

        <span className="group right">
          <button type="button" className="ghost" title="打开使用说明"
            onClick={() => window.open("/guide.html", "_blank", "noopener")}>? 帮助</button>
        </span>
        {dirty && <span className="status dirty" title="存在未保存修改，请保存到云端或下载文件">● 未保存</span>}
        {status.kind === "busy" && <span className="status">… {status.label}</span>}
        {status.kind === "done" && !dirty && <span className="status ok">✓ {status.label}</span>}
        {status.kind === "error" && <span className="status err" title={status.message}>✗ {status.message}</span>}
        <span className="group">
          {cloudEnabled && ready && auth.profile ? (
            <span className="acct">
              <span className="name" title={auth.email ?? ""}>{auth.profile.display_name || auth.email}</span>
              <button type="button" onClick={auth.signOut}>退出登录</button>
            </span>
          ) : !cloudEnabled ? (
            <span className="acct mode" title="未配置云端登录，当前使用本地模式">本地模式</span>
          ) : null}
        </span>
      </div>
    </header>
  );
}
