/**
 * "Insert beside…" dialog — pick a part, a side and a quantity; the caller opens
 * the row (shifting everything downstream) and drops the part(s) in, rail-aligned
 * to the anchor. Replaces the shift+click-a-dozen-slim-parts workflow.
 * Deliberate close only (Insert / Cancel / Esc).
 */
import { useState, useEffect } from "react";
import { BANDS } from "../model/library";
import type { Library } from "../model/types";

interface Props {
  library: Library;
  /** display name of the anchor the insert is relative to */
  anchorName: string;
  onInsert: (libKey: string, side: "left" | "right", count: number) => void;
  onCancel: () => void;
}

export default function InsertModal({ library, anchorName, onInsert, onCancel }: Props) {
  const items = Object.values(library).filter((it) => !(it.source === "rect" && it.label_plate));
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
        <h3>Insert beside “{anchorName}”</h3>
        <p className="bom-note">
          The new part drops in flush with the row; everything on that side shifts over automatically —
          no multi-select needed.
        </p>

        <label className="prow">
          <span className="plabel">Part</span>
          <select value={libKey} onChange={(e) => setLibKey(e.target.value)}>
            {BANDS.map((b) => {
              const group = items.filter((it) => it.band === b.band);
              if (group.length === 0) return null;
              return (
                <optgroup key={b.band} label={`${b.band}. ${b.name}`}>
                  {group.map((it) => <option key={it.lib_key} value={it.lib_key}>{it.name || "(unnamed)"}</option>)}
                </optgroup>
              );
            })}
            {items.some((it) => it.band == null) && (
              <optgroup label="Uncategorized">
                {items.filter((it) => it.band == null).map((it) => (
                  <option key={it.lib_key} value={it.lib_key}>{it.name || "(unnamed)"}</option>
                ))}
              </optgroup>
            )}
          </select>
        </label>

        <label className="prow">
          <span className="plabel">Side</span>
          <span className="pval">
            <label><input type="radio" name="ins-side" checked={side === "left"} onChange={() => setSide("left")} /> ⬅ left</label>
            <label><input type="radio" name="ins-side" checked={side === "right"} onChange={() => setSide("right")} /> right ➡</label>
          </span>
        </label>

        <label className="prow">
          <span className="plabel">Quantity</span>
          <input type="number" min={1} value={count}
            onChange={(e) => setCount(Math.max(1, parseInt(e.target.value) || 1))} />
        </label>

        <div className="modal-actions">
          <button type="button" className="danger" onClick={onCancel}>Cancel</button>
          <button type="button" disabled={!libKey} onClick={() => onInsert(libKey, side, count)}>
            Insert ×{count}
          </button>
        </div>
      </div>
    </div>
  );
}
