import { useState, useEffect } from "react";
import { BANDS } from "../model/library";
import type { LibItem } from "../model/types";

export interface PartEdit {
  name: string;
  band: number;
  manufacturer: string;
  model: string;
  description: string;
  railOffsetMm: number;
}

interface Props {
  item: LibItem;
  shared: boolean;
  onSave: (patch: PartEdit) => void;
  onCancel: () => void;
}

export default function EditPartModal({ item, shared, onSave, onCancel }: Props) {
  const [name, setName] = useState(item.name);
  const [band, setBand] = useState<number>(item.band ?? BANDS[0].band);
  const [manufacturer, setManufacturer] = useState(item.manufacturer ?? "");
  const [model, setModel] = useState(item.model ?? "");
  const [description, setDescription] = useState(item.description ?? "");
  const [railOffset, setRailOffset] = useState<number>(item.rail_offset_mm ?? item.height_mm / 2);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const save = () => {
    if (name.trim()) onSave({
      name: name.trim(), band, manufacturer: manufacturer.trim(), model: model.trim(),
      description: description.trim(), railOffsetMm: railOffset,
    });
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h3>编辑元器件</h3>

        <p className="measured">
          尺寸 <strong>{item.width_mm} × {item.height_mm} mm</strong>
          {item.source === "dxf" ? "（来自上传的 DXF）" : ""}
        </p>

        <label className="prow">
          <span className="plabel">元器件名称</span>
          <input type="text" value={name} autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") save(); }} />
        </label>

        <label className="prow">
          <span className="plabel">分类</span>
          <select value={band} onChange={(e) => setBand(Number(e.target.value))}>
            {BANDS.map((b) => <option key={b.band} value={b.band}>{b.band}. {b.name}</option>)}
          </select>
        </label>

        <label className="prow">
          <span className="plabel">DIN导轨线（距顶部 mm）</span>
          <input type="number" step={0.5} value={railOffset} onChange={(e) => setRailOffset(Number(e.target.value))} />
        </label>
        <p className="rail-note">
          从元件顶部到 DIN 导轨中心线的距离。同一排元件按此基准对齐，使卡扣处于同一高度。
          如需按中心对齐，可设为 {(item.height_mm / 2).toFixed(1)} mm。
        </p>

        <p className="bom-fields-head">BOM 信息 <span>（显示在材料清单中）</span></p>
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
            placeholder="填写完整规格说明；留空时可使用元器件名称。"
            onChange={(e) => {
              setDescription(e.target.value);
              e.currentTarget.style.height = "auto";
              e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 240)}px`;
            }} />
        </label>

        {shared && <p className="bom-note">此元件位于共享元器件库，保存后会更新给所有用户（仅管理员）。</p>}

        <div className="modal-actions">
          <button type="button" className="danger" onClick={onCancel}>取消</button>
          <button type="button" disabled={!name.trim()} onClick={save}>保存</button>
        </div>
      </div>
    </div>
  );
}
