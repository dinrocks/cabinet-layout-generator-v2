import { useEffect } from "react";
import type { RevisionSummary, ProjectEvent, EventAction } from "../store/projectStore";

interface Props {
  projectName: string;
  revisions: RevisionSummary[];
  events: ProjectEvent[];
  busy: boolean;
  onRestore: (revId: string) => void;
  onClose: () => void;
}

const ACTION_LABEL: Record<EventAction, string> = {
  created: "新建了项目", saved: "保存了项目", duplicated: "复制了项目",
  deleted: "删除了项目", shared: "创建了分享链接", unshared: "撤销了分享链接",
};

export default function RevisionsModal({ projectName, revisions, events, busy, onRestore, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h3>历史记录 — {projectName || "未命名"}</h3>
        <p className="bom-note">
          每次保存都会在这里保留一个版本（最多 20 个）。恢复版本会先作为<strong>未保存</strong>内容载入编辑器，
          确认无误后再点击“保存”才会成为当前正式版本。
        </p>
        {revisions.length === 0 ? (
          <p className="bom-empty">还没有历史版本，从下一次保存开始记录。</p>
        ) : (
          <ul className="plist">
            {revisions.map((r, i) => (
              <li key={r.id}>
                <button type="button" className="plist-open" disabled={busy} onClick={() => onRestore(r.id)}>
                  <span className="pn">{i === 0 ? "最新保存版本" : `往前第 ${i} 个保存版本`}{r.name !== projectName ? ` · “${r.name}”` : ""}</span>
                  <span className="pm">保存者：{r.saved_by_name ?? "—"} · {new Date(r.saved_at).toLocaleString()}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="bom-fields-head">操作记录 <span>（只读）</span></p>
        {events.length === 0 ? (
          <p className="bom-empty">暂无操作记录。</p>
        ) : (
          <ul className="activity">
            {events.map((e) => (
              <li key={e.id}>
                <span className="act-who">{e.actor_name ?? "—"}</span>
                {" "}<span className="act-what">{ACTION_LABEL[e.action] ?? e.action}</span>
                {e.detail ? <span className="act-detail"> · {e.detail}</span> : null}
                <span className="act-when" title={new Date(e.at).toLocaleString()}> · {new Date(e.at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}
