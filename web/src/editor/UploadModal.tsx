import { useState, useEffect } from "react";
import { BANDS } from "../model/library";
import type { UploadResult } from "../service/dxfClient";

export interface BomMeta {
  manufacturer: string;
  model: string;
  description: string;
}

interface Props {
  result: UploadResult;
  defaultName: string;
  canShare: boolean;
  onConfirm: (name: string, shared: boolean, band: number, meta: BomMeta, railOffsetMm: number) => void;
  onCancel: () => void;
}

export default function UploadModal({ result, defaultName, canShare, onConfirm, onCancel }: Props) {
  const [name, setName] = useState(defaultName);
  const [shared, setShared] = useState(false);
  const [band, setBand] = useState<number>(BANDS[0].band);
  const [manufacturer, setManufacturer] = useState("");
  const [model, setModel] = useState("");
  const [description, setDescription] = useState("");
  const [railOffset, setRailOffset] = useState<number>(result.rail_offset_mm ?? result.height_mm / 2);

  const confirm = () => {
    if (name.trim()) onConfirm(name.trim(), canShare && shared, band, {
      manufacturer: manufacturer.trim(), model: model.trim(), description: description.trim(),
    }, railOffset);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h3>确认上传的元器件</h3>

        <div className="upload-preview" dangerouslySetInnerHTML={{ __html: result.svg }} />

        <p className="measured">
          实测尺寸 <strong>{result.width_mm} × {result.height_mm} mm</strong>
        </p>
        {!result.units_confirmed && (
          <p className="warn-units">
            ⚠ 未识别到毫米单位（检测到：{result.units}）。请确认显示尺寸正确后再继续。
          </p>
        )}

        <label className="prow">
          <span className="plabel">DIN导轨线（距顶部 mm）</span>
          <input type="number" step={0.5} value={railOffset} onChange={(e) => setRailOffset(Number(e.target.value))} />
        </label>
        <p className="rail-note">
          {result.rail_from_origin
            ? "使用 DXF 原点 (0,0) 作为 DIN 导轨基准。同一排元件会按此线对齐，使导轨卡扣保持在同一高度。"
            : "默认使用元件中心线（DXF 原点不在外轮廓内）。请将此值设为实际 DIN 导轨线位置，以便同排元件正确对齐。"}
        </p>

        <label className="prow">
          <span className="plabel">元器件名称</span>
          <input type="text" value={name} autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") confirm(); }} />
        </label>

        <label className="prow">
          <span className="plabel">分类</span>
          <select value={band} onChange={(e) => setBand(Number(e.target.value))}>
            {BANDS.map((b) => <option key={b.band} value={b.band}>{b.band}. {b.name}</option>)}
          </select>
        </label>

        <p className="bom-fields-head">BOM 信息 <span>（可选，将显示在材料清单中，之后仍可修改）</span></p>
        <label className="prow">
          <span className="plabel">制造商</span>
          <input type="text" value={manufacturer} placeholder="例如：明纬" onChange={(e) => setManufacturer(e.target.value)} />
        </label>
        <label className="prow">
          <span className="plabel">型号</span>
          <input type="text" value={model} placeholder="例如：NDR-120-24" onChange={(e) => setModel(e.target.value)} />
        </label>
        <label className="prow prow-col">
          <span className="plabel">说明</span>
          <textarea className="bom-desc" value={description} rows={2}
            placeholder="完整规格说明，例如：微型断路器，2P，16A，AC 230/400V，分断能力 6kA"
            onChange={(e) => {
              setDescription(e.target.value);
              e.currentTarget.style.height = "auto";
              e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 240)}px`;
            }} />
        </label>

        {canShare && (
          <label className="share-opt">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
            <span>加入<strong>共享元器件库</strong> — 永久保存，所有项目均可使用。</span>
          </label>
        )}

        <div className="modal-actions">
          <button type="button" className="danger" onClick={onCancel}>取消</button>
          <button type="button" disabled={!name.trim()} onClick={confirm}>
            {canShare && shared ? "加入共享元器件库" : "加入当前项目"}
          </button>
        </div>
      </div>
    </div>
  );
}
