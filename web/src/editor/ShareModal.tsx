import { useEffect, useState } from "react";
import { getShareToken, setShareToken } from "../store/projectStore";
import { newShareToken, shareUrl } from "../lib/shareToken";

interface Props {
  projectId: string;
  projectName: string;
  onClose: () => void;
}

export default function ShareModal({ projectId, projectName, onClose }: Props) {
  const [token, setToken] = useState<string | null | "loading">("loading");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    getShareToken(projectId).then((t) => { if (alive) setToken(t); });
    return () => { alive = false; };
  }, [projectId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function create() {
    setBusy(true);
    const t = newShareToken();
    const ok = await setShareToken(projectId, t);
    setBusy(false);
    if (ok) setToken(t);
  }

  async function revoke() {
    if (!window.confirm("确定撤销此分享链接吗？持有该链接的人将立即失去访问权限。")) return;
    setBusy(true);
    const ok = await setShareToken(projectId, null);
    setBusy(false);
    if (ok) { setToken(null); setCopied(false); }
  }

  async function copy(t: string) {
    await navigator.clipboard.writeText(shareUrl(t));
    setCopied(true);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>分享“{projectName || "未命名"}”</h3>
        {token === "loading" ? (
          <p className="muted small">正在检查…</p>
        ) : token ? (
          <>
            <p className="muted small">
              任何拥有此链接的人都可以<b>查看和打印</b>最新保存版本，无需登录；不可编辑，也不能使用 DXF 功能。可随时撤销链接。
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <input readOnly value={shareUrl(token)} style={{ flex: 1 }} onFocus={(e) => e.target.select()} />
              <button type="button" onClick={() => copy(token)}>{copied ? "✓ 已复制" : "复制"}</button>
            </div>
            <div className="modal-actions">
              <button type="button" className="danger" disabled={busy} onClick={revoke}>撤销链接</button>
              <button type="button" onClick={onClose}>关闭</button>
            </div>
          </>
        ) : (
          <>
            <p className="muted small">
              创建只读链接，方便客户、领导或配电柜厂家查看最新保存版本并下载 PDF/PNG；对方无法修改项目。
            </p>
            <div className="modal-actions">
              <button type="button" className="ghost" onClick={onClose}>取消</button>
              <button type="button" disabled={busy} onClick={create}>创建链接</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
