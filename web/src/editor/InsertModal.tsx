import { useState, useEffect } from "react";
import { BANDS, byName } from "../model/library";
import type { Library } from "../model/types";

interface Props {
  library: Library;
  anchorName: string;
  onInsert: (libKey: string, side: "left" | "right", count: number) => void;
  onCancel: () => void;
}

export default function InsertModal({ library, anchorName, onInsert, onCancel }: Props) {
  const items = Object.values(library).filter((it) => !(it.source === "rect" && it.label_plate)).sort(byName);
  const [libKey, setLibKey] = useState(items[0]?.lib_key ?? "");
  const [side, setSide] = useState<"left" | "right">("right");
  const [count, setCount] = useState(1);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h3>在“{anchorName}”旁插入元器件</h3>
        <p className="bom-note">
          新元件会沿当前行紧邻插入，该侧后续元件将自动平移，无需手动多选移动。
        </p>

        <label className="prow">
          <span className="plabel">元器件</span>
          <select value={libKey} onChange={(e) => setLibKey(e.target.value)}>
            {BANDS.map((b) => {
              const group = items.filter((it) => it.band === b.band);
              if (group.length === 0) return null;
              return (
                <optgroup key={b.band} label={`${b.band}. ${b.name}`}>
                  {group.map((it) => <option key={it.lib_key} value={it.lib_key}>{it.name || "（未命名）"}</option>)}
                </optgroup>
              );
            })}
            {items.some((it) => it.band == null) && (
              <optgroup label="未分类">
                {items.filter((it) => it.band == null).map((it) => (
                  <option key={it.lib_key} value={it.lib_key}>{it.name || "（未命名）"}</option>
                ))}
              </optgroup>
            )}
          </select>
        </label>

        <label className="prow">
          <span className="plabel">方向</span>
          <span className="pval">
            <label><input type="radio" name="ins-side" checked={side === "left"} onChange={() => setSide("left")} /> ⬅ 左侧</label>
            <label><input type="radio" name="ins-side" checked={side === "right"} onChange={() => setSide("right")} /> 右侧 ➡</label>
          </span>
        </label>

        <label className="prow">
          <span className="plabel">数量</span>
          <input type="number" min={1} value={count}
            onChange={(e) => setCount(Math.max(1, parseInt(e.target.value) || 1))} />
        </label>

        <div className="modal-actions">
          <button type="button" className="danger" onClick={onCancel}>取消</button>
          <button type="button" disabled={!libKey} onClick={() => onInsert(libKey, side, count)}>
            插入 ×{count}
          </button>
        </div>
      </div>
    </div>
  );
}
