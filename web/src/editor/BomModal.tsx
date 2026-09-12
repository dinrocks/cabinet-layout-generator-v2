import { useEffect, useMemo, useState } from "react";
import type { LayoutModel, Library, BomExtra } from "../model/types";
import { buildBom, bomToCsv, itemNo } from "../model/bom";
import { downloadBomPdf } from "../export/inBrowser";
import type { Paper } from "../render/page";

const dash = (s: string) => (s && s.trim() ? s : "-");
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

interface Props {
  model: LayoutModel;
  library: Library;
  extras: BomExtra[];
  paper: Paper;
  onChangeExtras: (extras: BomExtra[]) => void;
  onClose: () => void;
}

export default function BomModal({ model, library, extras, paper, onChangeExtras, onClose }: Props) {
  const bom = useMemo(() => buildBom(model, library), [model, library]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const addExtra = () =>
    onChangeExtras([...extras, { id: uid(), item_no: "", description: "", manufacturer: "", model: "", qty: 1 }]);
  const patchExtra = (id: string, p: Partial<BomExtra>) =>
    onChangeExtras(extras.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const removeExtra = (id: string) => onChangeExtras(extras.filter((x) => x.id !== id));

  const downloadCsv = () => {
    const blob = new Blob([bomToCsv(bom)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(model.project.name || "layout").replace(/\s+/g, "_")}_BOM.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const downloadPdf = async () => {
    setBusy(true);
    try {
      await downloadBomPdf(model, library, paper);
    } catch (e) {
      alert(`BOM PDF 生成失败：${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal bom-modal">
        <h3>材料清单（BOM）</h3>

        {bom.rows.length === 0 ? (
          <p className="bom-empty">当前没有材料。请先在安装板上放置元器件，或在下方手动添加 BOM 项目。</p>
        ) : (
          <table className="bom-table">
            <thead>
              <tr>
                <th>项目号</th><th>说明</th><th>制造商</th><th>型号</th><th className="num">数量</th>
              </tr>
            </thead>
            <tbody>
              {bom.rows.map((r) => (
                <tr key={r.key}>
                  <td className="bom-itemno">{itemNo(r)}</td>
                  <td>
                    {dash(r.description)}
                    {r.confirm && <span className="bom-est" title="尺寸为未确认估算值，请按数据手册或实物核对"> *</span>}
                  </td>
                  <td>{dash(r.manufacturer)}</td>
                  <td>{dash(r.model)}</td>
                  <td className="num">{r.qty}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={4}>元件总数</td><td className="num">{bom.totalParts}</td></tr>
            </tfoot>
          </table>
        )}

        <p className="bom-fields-head">
          手动添加的 BOM 项目 <span>（不绘制在安装板上，例如柜体、铭牌、指示灯、风扇、插座）</span>
        </p>
        <table className="bom-table bom-extras-table">
          <thead>
            <tr>
              <th>项目号</th><th>说明</th><th>制造商</th><th>型号</th><th className="num">数量</th><th />
            </tr>
          </thead>
          <tbody>
            {extras.map((x) => (
              <tr key={x.id}>
                <td><input value={x.item_no} placeholder="1 / FAN01" onChange={(e) => patchExtra(x.id, { item_no: e.target.value })} /></td>
                <td><input value={x.description} placeholder="例如：控制柜、风扇、铭牌…" onChange={(e) => patchExtra(x.id, { description: e.target.value })} /></td>
                <td><input value={x.manufacturer} placeholder="制造商" onChange={(e) => patchExtra(x.id, { manufacturer: e.target.value })} /></td>
                <td><input value={x.model} onChange={(e) => patchExtra(x.id, { model: e.target.value })} /></td>
                <td className="num"><input type="number" min={0} value={x.qty} onChange={(e) => patchExtra(x.id, { qty: Math.max(0, Number(e.target.value) || 0) })} /></td>
                <td><button type="button" className="lib-mini" title="删除" onClick={() => removeExtra(x.id)}>✕</button></td>
              </tr>
            ))}
            {extras.length === 0 && (
              <tr><td colSpan={6} className="bom-empty">暂无手动项目，可添加柜体、铭牌、风扇等。</td></tr>
            )}
          </tbody>
        </table>
        <button type="button" className="ghost bom-add" onClick={addExtra}>+ 添加仅 BOM 项目</button>

        <p className="bom-note">
          安装板上的元件会自动统计。“-”表示尚未填写，可在元器件属性中补充；“*”表示尺寸尚未确认，采购前请按数据手册或实物核对。
        </p>

        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose}>关闭</button>
          <button type="button" className="ghost" disabled={bom.rows.length === 0} onClick={downloadCsv}>下载 CSV</button>
          <button type="button" disabled={bom.rows.length === 0 || busy} onClick={() => void downloadPdf()}>
            {busy ? "正在生成 PDF…" : `生成 PDF 表格（${paper}）`}
          </button>
        </div>
      </div>
    </div>
  );
}
