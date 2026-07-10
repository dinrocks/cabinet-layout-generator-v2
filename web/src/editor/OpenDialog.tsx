/**
 * The "Open a layout" modal: cloud projects grouped by folder (newest activity
 * first), with move/history/duplicate/delete per row and folder management.
 * Extracted verbatim from App.tsx (ROADMAP #8) — view only; state + handlers live
 * in useCloudProjects and arrive as props.
 */
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
          <h3>Open a layout</h3>
          <button type="button" className="ghost" disabled={cloudBusy} onClick={onNewFolder}>+ New folder</button>
        </div>
        {projectList.length === 0 && folders.length === 0 ? (
          <p className="muted small">No saved layouts yet — Save one first.</p>
        ) : (() => {
          // group by folder; a group's "activity" = its newest layout (folders empty → own updated_at)
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
                <span className="pn">{p.name || "Untitled"}</span>
                <span className="pm" title={new Date(p.updated_at).toLocaleString()}>saved by {p.updated_by_name ?? p.owner_name ?? "—"} · {timeAgo(p.updated_at)}</span>
              </button>
              <select className="plist-move" value={p.folder_id ?? ""} disabled={cloudBusy}
                title="Move to folder" onChange={(e) => onMove(p.id, e.target.value || null)}>
                <option value="">Unfiled</option>
                {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
              <button type="button" className="dup" disabled={cloudBusy} title="History — restore an earlier save" onClick={() => onHistory(p)}>⟲</button>
              <button type="button" className="dup" disabled={cloudBusy} title="Duplicate into a new project" onClick={() => onDuplicate(p)}>⧉</button>
              <button type="button" className="danger" disabled={cloudBusy} title="Delete" onClick={() => onDelete(p.id)}>✕</button>
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
                        {g.folder ? g.folder.name : "Unfiled"}
                        <span className="folder-count">{g.projects.length}</span>
                      </button>
                      {g.folder && (
                        <>
                          <button type="button" className="dup" disabled={cloudBusy} title="Rename folder" onClick={() => onRenameFolder(g.folder)}>✎</button>
                          <button type="button" className="danger" disabled={cloudBusy} title="Delete folder (layouts move to Unfiled)" onClick={() => onDeleteFolder(g.folder, g.projects.length)}>✕</button>
                        </>
                      )}
                    </div>
                    {!collapsed && (
                      g.projects.length
                        ? <ul className="plist folder-projects">{g.projects.map(projectRow)}</ul>
                        : <p className="folder-empty">— empty — move a layout here with its ▾</p>
                    )}
                  </li>
                );
              })}
            </ul>
          );
        })()}
        <div className="modal-actions"><button type="button" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}
