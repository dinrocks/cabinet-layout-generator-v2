import type { ProjectSummary, Folder } from "../store/projectStore";
import { timeAgo } from "../lib/timeAgo";

interface Props {
  projectList: ProjectSummary[];
  folders: Folder[];
  collapsedFolders: Set<string>;
  cloudBusy: boolean;
  onClose: () => void;
  onOpen: (id: string) => void;
  onNewFolder: () => void;
  onRenameFolder: (f: Folder) => void;
  onDeleteFolder: (f: Folder, count: number) => void;
  onMove: (projectId: string, folderId: string | null) => void;
  onToggleFolder: (key: string) => void;
  onHistory: (p: ProjectSummary) => void;
  onDuplicate: (p: ProjectSummary) => void;
  onDelete: (id: string) => void;
}

export default function OpenDialog({
  projectList, folders, collapsedFolders, cloudBusy,
  onClose, onOpen, onNewFolder, onRenameFolder, onDeleteFolder,
  onMove, onToggleFolder, onHistory, onDuplicate, onDelete,
}: Props) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal projects-modal" onClick={(e) => e.stopPropagation()}>
        <div className="projects-head">
          <h3>打开布局</h3>
          <button type="button" className="ghost" disabled={cloudBusy} onClick={onNewFolder}>+ 新建文件夹</button>
        </div>
        {projectList.length === 0 && folders.length === 0 ? (
          <p className="muted small">还没有已保存的布局，请先保存一个项目。</p>
        ) : (() => {
          const byFolder = new Map<string | null, ProjectSummary[]>();
          for (const p of projectList) {
            const arr = byFolder.get(p.folder_id) ?? [];
            arr.push(p); byFolder.set(p.folder_id, arr);
          }
          const groups = folders.map((f) => {
            const ps = byFolder.get(f.id) ?? [];
            return { key: f.id, folder: f, projects: ps,
              activity: ps.length ? +new Date(ps[0].updated_at) : +new Date(f.updated_at) };
          });
          const loose = byFolder.get(null) ?? [];
          if (loose.length) groups.push({ key: "__unfiled__", folder: null as unknown as Folder, projects: loose, activity: +new Date(loose[0].updated_at) });
          groups.sort((a, b) => b.activity - a.activity);

          const projectRow = (p: ProjectSummary) => (
            <li key={p.id} className="plist-row">
              <button type="button" className="plist-open" disabled={cloudBusy} onClick={() => onOpen(p.id)}>
                <span className="pn">{p.name || "未命名"}</span>
                <span className="pm" title={new Date(p.updated_at).toLocaleString()}>保存者：{p.updated_by_name ?? p.owner_name ?? "—"} · {timeAgo(p.updated_at)}</span>
              </button>
              <select className="plist-move" value={p.folder_id ?? ""} disabled={cloudBusy}
                title="移动到文件夹" onChange={(e) => onMove(p.id, e.target.value || null)}>
                <option value="">未归档</option>
                {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
              <button type="button" className="dup" disabled={cloudBusy} title="历史记录 — 恢复较早的保存版本" onClick={() => onHistory(p)}>⟲</button>
              <button type="button" className="dup" disabled={cloudBusy} title="复制为新项目" onClick={() => onDuplicate(p)}>⧉</button>
              <button type="button" className="danger" disabled={cloudBusy} title="删除" onClick={() => onDelete(p.id)}>✕</button>
            </li>
          );

          return (
            <ul className="plist folders">
              {groups.map((g) => {
                const collapsed = collapsedFolders.has(g.key);
                return (
                  <li key={g.key} className="folder-group">
                    <div className="folder-head">
                      <button type="button" className="folder-toggle" onClick={() => onToggleFolder(g.key)}>
                        <span className="caret">{collapsed ? "▸" : "▾"}</span>
                        {g.folder ? g.folder.name : "未归档"}
                        <span className="folder-count">{g.projects.length}</span>
                      </button>
                      {g.folder && (
                        <>
                          <button type="button" className="dup" disabled={cloudBusy} title="重命名文件夹" onClick={() => onRenameFolder(g.folder)}>✎</button>
                          <button type="button" className="danger" disabled={cloudBusy} title="删除文件夹（其中的布局将移到“未归档”）" onClick={() => onDeleteFolder(g.folder, g.projects.length)}>✕</button>
                        </>
                      )}
                    </div>
                    {!collapsed && (
                      g.projects.length
                        ? <ul className="plist folder-projects">{g.projects.map(projectRow)}</ul>
                        : <p className="folder-empty">— 空 — 可通过布局右侧下拉菜单移入此文件夹</p>
                    )}
                  </li>
                );
              })}
            </ul>
          );
        })()}
        <div className="modal-actions"><button type="button" onClick={onClose}>关闭</button></div>
      </div>
    </div>
  );
}
