/**
 * 右侧属性面板：元件、线槽、组合、标签、安装板、图签、行高与校验。
 * 保留原有业务逻辑，仅中文化面向用户的文字。
 */
import { useMemo } from "react";
import type { Library, RectLibItem, LayoutModel } from "../model/types";
import { STOPPER_BANDS, byName } from "../model/library";
import { validate } from "../model/validate";
import { detectRows, setRowHeight, centerRowDevices, packRow, type RowResizeMode } from "../model/rows";
import {
  updateElement, updateDuct, updateGroup, updateLabel,
  setRotation, fitDuctWidth, explodeGroup, addLabel, addElement,
} from "../model/edit";
import { selectRow } from "../model/marquee";
import type { Selection } from "./FabricStage";

export interface InsertTarget { kind: "element" | "group"; id: string; name: string }

interface Props {
  model: LayoutModel;
  library: Library;
  set: (m: LayoutModel) => void;
  setLibrary: React.Dispatch<React.SetStateAction<Library>>;
  selections: Selection[];
  setSelections: (s: Selection[]) => void;
  rowMode: RowResizeMode;
  setRowMode: (m: RowResizeMode) => void;
  deleteSelected: () => void;
  setLibBomField: (libKey: string, patch: { manufacturer?: string; model?: string; description?: string }) => void;
  onInsertFor: (t: InsertTarget) => void;
}

export default function PropertiesPanel({
  model, library, set, setLibrary, selections, setSelections,
  rowMode, setRowMode, deleteSelected, setLibBomField, onInsertFor,
}: Props) {
  const issues = useMemo(() => validate(model, library), [model, library]);
  const rows = useMemo(() => detectRows(model), [model]);

  const single = selections.length === 1 ? selections[0] : null;
  const multi = selections.length > 1;
  const selEl = single?.kind === "element" ? model.elements.find((e) => e.id === single.id) ?? null : null;
  const selItem = selEl ? library[selEl.lib_key] : undefined;
  const selIsLabel = selItem?.source === "rect" && selItem.label_plate === true;
  const selDuct = single?.kind === "duct" ? model.ducts.find((d) => d.id === single.id) ?? null : null;
  const selGroup = single?.kind === "group" ? model.groups.find((g) => g.id === single.id) ?? null : null;
  const selLabel = single?.kind === "label" ? model.labels.find((l) => l.id === single.id) ?? null : null;

  function rotateSelected() {
    if (!single || (single.kind !== "element" && single.kind !== "group")) return;
    const cur = selEl?.rot_deg ?? selGroup?.rot_deg ?? 0;
    set(setRotation(model, single.kind, single.id, cur + 90));
  }

  function addPartLabel(kind: "element" | "group", refId: string) {
    const { model: m2, id } = addLabel(model, kind, refId);
    set(m2);
    setSelections([{ id, kind: "label" }]);
  }

  function addLabelPlate() {
    if (!selEl) return;
    const stopper = library[selEl.lib_key];
    if (!stopper) return;
    const lkey = `lbl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const labelItem: RectLibItem = {
      lib_key: lkey, source: "rect", name: "", label_plate: true,
      width_mm: stopper.width_mm, height_mm: stopper.height_mm,
    };
    const lib2 = { ...library, [lkey]: labelItem };
    const pid = `pair_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const r = addElement(model, lkey, lib2, selEl.x_mm, selEl.y_mm);
    let m = updateElement(r.model, selEl.id, { pair_id: pid });
    m = updateElement(m, r.id, { pair_id: pid, rot_deg: selEl.rot_deg });
    setLibrary(lib2);
    set(m);
    setSelections([{ id: r.id, kind: "element" }]);
  }

  return (
    <aside className="panel">
      {multi ? (
        <>
          <h3>已选择 {selections.length} 个对象</h3>
          <p className="muted small">
            Shift+拖动可框选更多对象（左→右需完全包含，右→左只需相交）；Shift+单击可增减单个对象；Ctrl+A全选；Esc清除选择。方向键微调，按住Shift时每次移动10mm，Delete删除全部已选对象。
          </p>
          <button type="button" className="danger" onClick={deleteSelected}>删除 {selections.length} 个对象</button>
        </>
      ) : selEl ? (
        <>
          <h3>元件</h3>
          {(() => {
            const it = library[selEl.lib_key];
            if (it && it.source === "rect" && it.custom) {
              const patch = (p: Partial<RectLibItem>) =>
                setLibrary((l) => ({ ...l, [selEl.lib_key]: { ...(l[selEl.lib_key] as RectLibItem), ...p } }));
              return (
                <>
                  <Field label="元件名称/料号" value={it.name} onChange={(v) => patch({ name: v })} />
                  <Num label="宽度 (mm)" value={it.width_mm} onChange={(v) => patch({ width_mm: v })} />
                  <Num label="高度 (mm)" value={it.height_mm} onChange={(v) => patch({ height_mm: v })} />
                </>
              );
            }
            return <Row label="元器件库"><span className="ro">{it?.name ?? selEl.lib_key}</span></Row>;
          })()}
          <Field label="标号" value={selEl.tag} onChange={(v) => set(updateElement(model, selEl.id, { tag: v }))} />
          <Num label="X坐标 (mm)" value={selEl.x_mm} onChange={(v) => set(updateElement(model, selEl.id, { x_mm: v }))} />
          <Num label="Y坐标 (mm)" value={selEl.y_mm} onChange={(v) => set(updateElement(model, selEl.id, { y_mm: v }))} />
          <Num label="前间距 (mm)" value={selEl.gap_before_mm} step={0.1} onChange={(v) => set(updateElement(model, selEl.id, { gap_before_mm: v }))} />
          <Num label="距线槽间隙 (mm)" value={selEl.clearance_to_duct_mm} step={0.5} onChange={(v) => set(updateElement(model, selEl.id, { clearance_to_duct_mm: v }))} />
          <Num label="导轨偏移 (mm)" step={0.5}
            value={library[selEl.lib_key]?.rail_offset_mm ?? ((library[selEl.lib_key]?.height_mm ?? 0) / 2)}
            onChange={(v) => setLibrary((l) => ({ ...l, [selEl.lib_key]: { ...l[selEl.lib_key], rail_offset_mm: v } }))} />
          <Row label="旋转"><span className="ro">{selEl.rot_deg}°</span> <button type="button" onClick={rotateSelected}>+90°</button></Row>
          {selItem && !selIsLabel && (
            <>
              <p className="bom-fields-head">BOM信息 <span>（显示在物料清单中）</span></p>
              <Field label="制造商" value={selItem.manufacturer ?? ""} onChange={(v) => setLibBomField(selEl.lib_key, { manufacturer: v })} />
              <Field label="型号" value={selItem.model ?? ""} onChange={(v) => setLibBomField(selEl.lib_key, { model: v })} />
              <Field label="说明" value={selItem.description ?? ""} onChange={(v) => setLibBomField(selEl.lib_key, { description: v })} />
            </>
          )}
          <div className="panel-actions">
            <button type="button" title="在此元件旁插入新元件，当前行会自动腾出空间"
              onClick={() => onInsertFor({ kind: "element", id: selEl.id, name: library[selEl.lib_key]?.name ?? selEl.lib_key })}>⇤⇥ 旁边插入…</button>
            <button type="button" title="选择同一导轨行上的全部设备"
              onClick={() => setSelections(selectRow(model, library, { id: selEl.id, kind: "element" }))}>⬌ 选择整行</button>
            {STOPPER_BANDS.has(library[selEl.lib_key]?.band ?? -1) && (
              <button type="button" title="在此挡块上叠加同尺寸标记牌，并锁定为一对" onClick={addLabelPlate}>添加标记牌</button>
            )}
            <button type="button" onClick={() => addPartLabel("element", selEl.id)}>+ 标签</button>
            <button type="button" className="danger" onClick={deleteSelected}>删除</button>
          </div>
        </>
      ) : selDuct ? (
        <>
          <h3>线槽</h3>
          <Num label="X坐标 (mm)" value={selDuct.x_mm} onChange={(v) => set(updateDuct(model, selDuct.id, { x_mm: v }))} />
          <Num label="Y坐标 (mm)" value={selDuct.y_mm} onChange={(v) => set(updateDuct(model, selDuct.id, { y_mm: v }))} />
          <Num label="长度 (mm)" value={selDuct.length_mm} onChange={(v) => set(updateDuct(model, selDuct.id, { length_mm: v }))} />
          <Num label="宽度 (mm)" value={selDuct.width_mm} onChange={(v) => set(updateDuct(model, selDuct.id, { width_mm: v }))} />
          <Num label="标注高度 (mm)" value={selDuct.label_h_mm} onChange={(v) => set(updateDuct(model, selDuct.id, { label_h_mm: v }))} />
          <div className="panel-actions">
            {selDuct.rot_deg % 180 === 0 && (
              <button type="button" title="将横向线槽自动延伸到两侧纵向线槽之间" onClick={() => set(fitDuctWidth(model, selDuct.id))}>自动适配宽度</button>
            )}
            <button type="button" className="danger" onClick={deleteSelected}>删除</button>
          </div>
        </>
      ) : selGroup ? (
        <>
          <h3>组合 ×{selGroup.count}</h3>
          <Row label="元器件库"><span className="ro">{library[selGroup.lib_key]?.name ?? selGroup.lib_key}</span></Row>
          <Num label="X坐标 (mm)" value={selGroup.x_mm} onChange={(v) => set({ ...model, groups: model.groups.map((g) => g.id === selGroup.id ? { ...g, x_mm: v } : g) })} />
          <Num label="Y坐标 (mm)" value={selGroup.y_mm} onChange={(v) => set({ ...model, groups: model.groups.map((g) => g.id === selGroup.id ? { ...g, y_mm: v } : g) })} />
          <Num label="数量" value={selGroup.count} onChange={(v) => set({ ...model, groups: model.groups.map((g) => g.id === selGroup.id ? { ...g, count: Math.max(1, Math.floor(v)) } : g) })} />
          <Num label="内部间距 (mm)" value={selGroup.internal_gap_mm} step={0.1} onChange={(v) => set({ ...model, groups: model.groups.map((g) => g.id === selGroup.id ? { ...g, internal_gap_mm: v } : g) })} />
          <Row label="旋转"><span className="ro">{selGroup.rot_deg}°</span> <button type="button" onClick={rotateSelected}>+90°</button></Row>
          <Row label="起始端附件">
            <select value={selGroup.cap_start_key ?? ""} onChange={(e) => set(updateGroup(model, selGroup.id, { cap_start_key: e.target.value || null }))}>
              <option value="">— 无 —</option>
              {Object.values(library).filter((it) => !(it.source === "rect" && it.label_plate)).sort(byName)
                .map((it) => <option key={it.lib_key} value={it.lib_key}>{it.name || "（未命名）"}</option>)}
            </select>
          </Row>
          <Row label="末端附件">
            <select value={selGroup.cap_end_key ?? ""} onChange={(e) => set(updateGroup(model, selGroup.id, { cap_end_key: e.target.value || null }))}>
              <option value="">— 无 —</option>
              {Object.values(library).filter((it) => !(it.source === "rect" && it.label_plate)).sort(byName)
                .map((it) => <option key={it.lib_key} value={it.lib_key}>{it.name || "（未命名）"}</option>)}
            </select>
          </Row>
          <div className="panel-actions">
            <button type="button" title="在此组合旁插入新元件，当前行会自动腾出空间"
              onClick={() => onInsertFor({ kind: "group", id: selGroup.id, name: `组合 ${library[selGroup.lib_key]?.name ?? selGroup.lib_key}` })}>⇤⇥ 旁边插入…</button>
            <button type="button" title="选择同一导轨行上的全部设备"
              onClick={() => setSelections(selectRow(model, library, { id: selGroup.id, kind: "group" }))}>⬌ 选择整行</button>
            <button type="button" onClick={() => addPartLabel("group", selGroup.id)}>+ 标签</button>
            <button type="button" onClick={() => { set(explodeGroup(model, selGroup.id, library)); setSelections([]); }}>拆分组合</button>
            <button type="button" className="danger" onClick={deleteSelected}>删除</button>
          </div>
        </>
      ) : selLabel ? (
        <>
          <h3>标签</h3>
          <Field label="文字" value={selLabel.text} onChange={(v) => set(updateLabel(model, selLabel.id, { text: v }))} />
          <Row label="绑定对象"><span className="ro">{selLabel.anchor}</span></Row>
          <p className="muted small">可直接在安装板上拖动标签，调整它相对于元件的位置。</p>
          <button type="button" className="danger" onClick={deleteSelected}>删除</button>
        </>
      ) : (
        <>
          <h3>安装板</h3>
          <Num label="宽度 (mm)" value={model.plate.width_mm} onChange={(v) => v > 0 && set({ ...model, plate: { ...model.plate, width_mm: v } })} />
          <Num label="高度 (mm)" value={model.plate.height_mm} onChange={(v) => v > 0 && set({ ...model, plate: { ...model.plate, height_mm: v } })} />
          <p className="muted small">调整安装板尺寸后，点击顶部<strong>适合</strong>重新居中显示。选择对象即可编辑，也可以从左侧元器件库点击或拖入元件。</p>

          <h3 className="mt">图签信息</h3>
          <p className="muted small">这些内容会显示在PDF/PNG图纸以及DXF图框中；留空的字段不会强制填写。</p>
          {(() => {
            const setProj = (patch: Partial<LayoutModel["project"]>) =>
              set({ ...model, project: { ...model.project, ...patch } });
            return (
              <>
                <Field label="副标题" value={model.project.title2 ?? ""} onChange={(v) => setProj({ title2: v })} />
                <Field label="项目编号" value={model.project.project_no ?? ""} onChange={(v) => setProj({ project_no: v })} />
                <Field label="图纸编号" value={model.project.drawing_no ?? ""} onChange={(v) => setProj({ drawing_no: v })} />
                <Field label="页码" value={model.project.sheet_no ?? ""} onChange={(v) => setProj({ sheet_no: v })} />
                <Field label="版本" value={model.project.rev} onChange={(v) => setProj({ rev: v })} />
                <Field label="修订日期" value={model.project.date ?? ""} onChange={(v) => setProj({ date: v })} />
                <Field label="修订说明" value={model.project.rev_desc ?? ""} onChange={(v) => setProj({ rev_desc: v })} />
                <Field label="绘图" value={model.project.by ?? ""} onChange={(v) => setProj({ by: v })} />
                <Field label="校对" value={model.project.chk ?? ""} onChange={(v) => setProj({ chk: v })} />
                <Field label="工程" value={model.project.eng ?? ""} onChange={(v) => setProj({ eng: v })} />
                <Field label="批准" value={model.project.appr ?? ""} onChange={(v) => setProj({ appr: v })} />
                <Field label="客户" value={model.project.client ?? ""} onChange={(v) => setProj({ client: v })} />
                <Field label="设计人员" value={model.project.designer ?? ""} onChange={(v) => setProj({ designer: v })} />
              </>
            );
          })()}

          {rows.length > 0 && (
            <>
              <h3 className="mt">布局行（{rows.length}）</h3>
              <Row label="调整模式">
                <select value={rowMode} onChange={(e) => setRowMode(e.target.value as RowResizeMode)}>
                  <option value="push">向下推移</option>
                  <option value="borrow">向下一行借空间</option>
                </select>
              </Row>
              <p className="muted small">
                {rowMode === "push"
                  ? "向下推移：下方线槽和其后的内容整体下移，安装板尺寸不变，最下方内容可能移出安装板。"
                  : "向下一行借空间：下一行同步缩小或增大相同尺寸，总高度保持不变。"}
              </p>
              {rows.map((r, i) => (
                <div key={i} className="prow">
                  <span className="plabel">第 {i + 1} 行高度 (mm)</span>
                  <span className="pval">
                    <input type="number" step={5} value={r.height}
                      onChange={(e) => { const v = parseFloat(e.target.value); if (!Number.isNaN(v) && v > 0) set(setRowHeight(model, i, v, rowMode)); }} />
                    <button type="button" title="从左侧线槽开始自动紧凑排列本行元件" onClick={() => set(packRow(model, library, i).model)}>自动排列</button>
                    <button type="button" title="将本行元件在垂直方向居中" onClick={() => set(centerRowDevices(model, library, i))}>↕</button>
                  </span>
                </div>
              ))}
            </>
          )}
        </>
      )}

      <h3 className="mt">布局校验</h3>
      {issues.length === 0 ? <p className="ok">未发现问题，当前布局通过校验。</p> : (
        <ul className="issues">
          {issues.map((i, n) => <li key={n} className={i.level}><code>{i.code}</code> {i.message}</li>)}
        </ul>
      )}
    </aside>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="prow"><span className="plabel">{label}</span><span className="pval">{children}</span></div>;
}
function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <Row label={label}><input type="text" value={value} onChange={(e) => onChange(e.target.value)} /></Row>;
}
function Num({ label, value, step = 1, onChange }: { label: string; value: number; step?: number; onChange: (v: number) => void }) {
  return <Row label={label}><input type="number" step={step} value={value} onChange={(e) => { const n = parseFloat(e.target.value); if (!Number.isNaN(n)) onChange(n); }} /></Row>;
}
