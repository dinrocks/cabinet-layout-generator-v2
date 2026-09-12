/**
 * 左侧元器件库：DXF上传、分类元件、线槽、自定义元件和成组添加。
 * 保留原有逻辑，仅中文化面向用户的文字。
 */
import { useRef, useState } from "react";
import { BANDS, byName } from "../model/library";
import type { Library } from "../model/types";
import type { UploadResult } from "../service/dxfClient";

export type Upload =
  | { status: "idle" }
  | { status: "uploading" }
  | { status: "confirm"; result: UploadResult; name: string }
  | { status: "error"; message: string };

export interface SetSpec {
  libKey: string;
  count: number;
  tagStart: string;
  capStart: string;
  capEnd: string;
}

interface Props {
  library: Library;
  upload: Upload;
  svcOffline: boolean;
  onUploadFile: (f: File) => void;
  onUploadError: (message: string) => void;
  onDismissUploadError: () => void;
  onAddPart: (libKey: string) => void;
  onEditPart: (libKey: string) => void;
  onDeletePart: (libKey: string) => void;
  onAddDuct: (orientation: "horizontal" | "vertical") => void;
  onAddCustomPart: () => void;
  onAddSet: (spec: SetSpec) => void;
}

export default function LibrarySidebar({
  library, upload, svcOffline,
  onUploadFile, onUploadError, onDismissUploadError,
  onAddPart, onEditPart, onDeletePart, onAddDuct, onAddCustomPart, onAddSet,
}: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [setLibKey, setSetLibKey] = useState("term_degson_2c_2_5");
  const [setCount, setSetCount] = useState(12);
  const [setTagStart, setSetTagStart] = useState("B101");
  const [setCapStart, setSetCapStart] = useState("");
  const [setCapEnd, setSetCapEnd] = useState("");

  function acceptDroppedFile(files: FileList) {
    const f = [...files].find((file) => file.name.toLowerCase().endsWith(".dxf"));
    if (f) onUploadFile(f);
    else onUploadError("请拖入一个 .dxf 文件。");
  }

  return (
    <aside className="library">
      <h3>元器件库</h3>

      <input ref={fileRef} type="file" accept=".dxf" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadFile(f); e.target.value = ""; }} />
      <button type="button" className={`upload-btn${dragOver ? " dragover" : ""}`} disabled={upload.status === "uploading"}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); acceptDroppedFile(e.dataTransfer.files); }}>
        {upload.status === "uploading" ? "正在上传…（启动DXF服务）"
          : dragOver ? "⬇ 将 .dxf 文件拖到这里"
            : "⬆ 上传元器件 DXF（也可直接拖入）"}
      </button>
      {upload.status === "error" && (
        <p className="upload-err">上传失败：{upload.message} <button type="button" onClick={onDismissUploadError}>关闭</button></p>
      )}
      {svcOffline && upload.status !== "error" && (
        <p className="upload-hint">⚠ DXF服务离线——请启动8000端口服务后再上传/导出DXF。PDF/PNG/SVG仍可正常使用。</p>
      )}

      {BANDS.map((band) => {
        const items = Object.values(library).filter((it) => it.band === band.band).sort(byName);
        return (
          <div key={band.band} className="band">
            <div className="band-name">{band.band}. {band.name}</div>
            {items.map((it) => (
              <div key={it.lib_key} className="lib-row">
                <button type="button" className="lib-item" title={`${it.name || "（未命名）"} · ${it.width_mm}×${it.height_mm} mm — 点击或拖动即可添加`}
                  draggable onDragStart={(e) => e.dataTransfer.setData("text/lib-key", it.lib_key)}
                  onClick={() => onAddPart(it.lib_key)}>
                  {it.name || "（未命名）"}{it.confirm ? " *" : ""}
                </button>
                <button type="button" className="lib-mini" title="编辑元件名称、分类和BOM信息" onClick={() => onEditPart(it.lib_key)}>✎</button>
                <button type="button" className="lib-mini" title="从元器件库删除" onClick={() => onDeletePart(it.lib_key)}>✕</button>
              </div>
            ))}
            {items.length === 0 && <p className="band-empty">— 暂无元件 —</p>}
          </div>
        );
      })}

      <div className="addset">
        <div className="band-name">辅助对象</div>
        <button type="button" className="lib-item" onClick={() => onAddDuct("horizontal")}>+ 横向线槽</button>
        <button type="button" className="lib-item" onClick={() => onAddDuct("vertical")}>+ 纵向线槽</button>
        <button type="button" className="lib-item" title="创建一个可自行设置名称和尺寸的空白元件，适用于暂无CAD文件的元器件" onClick={onAddCustomPart}>+ 自定义元件</button>
      </div>

      <div className="addset">
        <div className="band-name">批量添加</div>
        <select value={setLibKey} onChange={(e) => setSetLibKey(e.target.value)}>
          {Object.values(library).sort(byName).map((it) => <option key={it.lib_key} value={it.lib_key}>{it.name}</option>)}
        </select>
        <div className="addset-row">
          <label>数量 × <input type="number" min={1} value={setCount} onChange={(e) => setSetCount(Math.max(1, parseInt(e.target.value) || 1))} /></label>
          <label>起始标号 <input type="text" value={setTagStart} onChange={(e) => setSetTagStart(e.target.value)} placeholder="B101" /></label>
        </div>
        <label className="addset-cap">起始端附件
          <select value={setCapStart} onChange={(e) => setSetCapStart(e.target.value)}>
            <option value="">— 无 —</option>
            {Object.values(library).filter((it) => !(it.source === "rect" && it.label_plate)).sort(byName)
              .map((it) => <option key={it.lib_key} value={it.lib_key}>{it.name || "（未命名）"}</option>)}
          </select>
        </label>
        <label className="addset-cap">末端附件
          <select value={setCapEnd} onChange={(e) => setSetCapEnd(e.target.value)}>
            <option value="">— 无 —</option>
            {Object.values(library).filter((it) => !(it.source === "rect" && it.label_plate)).sort(byName)
              .map((it) => <option key={it.lib_key} value={it.lib_key}>{it.name || "（未命名）"}</option>)}
          </select>
        </label>
        <button type="button" className="lib-item"
          onClick={() => onAddSet({ libKey: setLibKey, count: setCount, tagStart: setTagStart, capStart: setCapStart, capEnd: setCapEnd })}>
          批量添加 ×{setCount}
        </button>
      </div>

      <p className="muted small">* 表示尺寸为未确认估算值，正式使用前请按数据手册、实测尺寸或DXF文件确认。</p>
    </aside>
  );
}
