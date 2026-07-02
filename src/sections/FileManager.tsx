import React, { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Icon, IconName } from "../components/Icon";
import { RollingNumber, RollingSize } from "../components/RollingNumber";
import { FileEntry, fmtTime, isTauri } from "./sys";

const SAMPLE: FileEntry[] = [
  { name: "需求文档_v3.pdf", path: "~/Documents/工作/需求文档_v3.pdf", display_path: "~/Documents/工作", kind: "文档", extension: "pdf", size_bytes: 2.4 * 1024 ** 2, modified_secs: Math.floor(Date.now() / 1000) - 3600 },
  { name: "会议录制-0712.mp4", path: "~/Movies/会议录制-0712.mp4", display_path: "~/Movies", kind: "视频", extension: "mp4", size_bytes: 1.2 * 1024 ** 3, modified_secs: Math.floor(Date.now() / 1000) - 86400 * 3 },
  { name: "设计稿.zip", path: "~/Downloads/设计稿.zip", display_path: "~/Downloads", kind: "压缩包", extension: "zip", size_bytes: 342 * 1024 ** 2, modified_secs: Math.floor(Date.now() / 1000) - 86400 * 8 },
];

const KIND_ICON: Record<string, IconName> = {
  文档: "file",
  图片: "file",
  视频: "file",
  音频: "file",
  压缩包: "folder",
  代码: "file",
  其他: "file",
};

type SortKey = "modified" | "size" | "name";
type SmartView = "all" | "large" | "recent" | "archive";

const KIND_FILTERS = ["全部", "文档", "图片", "视频", "音频", "压缩包", "代码", "其他"];
const SMART_VIEWS: Array<{ id: SmartView; label: string; hint: string }> = [
  { id: "all", label: "全部", hint: "显示当前索引结果" },
  { id: "large", label: "大文件", hint: "超过 100 MB" },
  { id: "recent", label: "近期", hint: "7 天内修改" },
  { id: "archive", label: "归档候选", hint: "90 天未修改" },
];

export const FileManager: React.FC = () => {
  const [query, setQuery] = useState("");
  const [indexed, setIndexed] = useState(false);
  const [indexPct, setIndexPct] = useState(0);
  const [files, setFiles] = useState<FileEntry[]>(SAMPLE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [kindFilter, setKindFilter] = useState("全部");
  const [sortKey, setSortKey] = useState<SortKey>("modified");
  const [smartView, setSmartView] = useState<SmartView>("all");
  const [lastIndexedAt, setLastIndexedAt] = useState<number | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const nowSecs = Date.now() / 1000;
    const rows = files.filter((f) => {
      const matchesQuery = !q || `${f.name} ${f.display_path} ${f.kind} ${f.extension ?? ""}`.toLowerCase().includes(q);
      const matchesKind = kindFilter === "全部" || f.kind === kindFilter;
      const matchesSmart =
        smartView === "all"
          || (smartView === "large" && f.size_bytes >= 100 * 1024 ** 2)
          || (smartView === "recent" && f.modified_secs != null && nowSecs - f.modified_secs <= 7 * 24 * 3600)
          || (smartView === "archive" && f.modified_secs != null && nowSecs - f.modified_secs >= 90 * 24 * 3600);
      return matchesQuery && matchesKind && matchesSmart;
    });
    return [...rows].sort((a, b) => {
      if (sortKey === "size") return b.size_bytes - a.size_bytes;
      if (sortKey === "name") return a.name.localeCompare(b.name, "zh-Hans-CN");
      return (b.modified_secs ?? 0) - (a.modified_secs ?? 0);
    });
  }, [files, kindFilter, query, smartView, sortKey]);

  const totalBytes = visible.reduce((sum, f) => sum + f.size_bytes, 0);
  const typeCount = new Set(visible.map((f) => f.kind)).size;
  const largeCount = files.filter((f) => f.size_bytes >= 100 * 1024 ** 2).length;
  const recentCount = files.filter((f) => f.modified_secs != null && Date.now() / 1000 - f.modified_secs <= 7 * 24 * 3600).length;
  const archiveCount = files.filter((f) => f.modified_secs != null && Date.now() / 1000 - f.modified_secs >= 90 * 24 * 3600).length;
  const kindStats = useMemo(() => {
    const stats = new Map<string, { count: number; bytes: number }>();
    for (const file of visible) {
      const current = stats.get(file.kind) ?? { count: 0, bytes: 0 };
      current.count += 1;
      current.bytes += file.size_bytes;
      stats.set(file.kind, current);
    }
    return [...stats.entries()].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 5);
  }, [visible]);

  const startIndex = async () => {
    setLoading(true);
    setError("");
    setIndexed(false);
    setIndexPct(6);
    const timer = window.setInterval(() => {
      setIndexPct((p) => Math.min(92, p + Math.max(2, Math.round((100 - p) / 8))));
    }, 140);
    try {
      if (!isTauri()) {
        await new Promise((resolve) => window.setTimeout(resolve, 650));
        setFiles(SAMPLE);
      } else {
        const rows = await invoke<FileEntry[]>("list_files", { query: query || null, limit: 700 });
        setFiles(rows);
      }
      setIndexPct(100);
      setIndexed(true);
      setLastIndexedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      window.clearInterval(timer);
      setLoading(false);
    }
  };

  const revealFile = async (path: string) => {
    if (!isTauri()) return;
    try {
      await revealItemInDir(path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="stack">
      <div className="panel search-panel">
        <div className="fm-commandbar">
          <div className="fm-search" role="search" aria-label="搜索文件">
            <span className="fm-search-icon"><Icon name="search" size={17} /></span>
            <input
              className="fm-search-input"
              aria-label="搜索文件名、路径或类型"
              placeholder="搜索文件名、路径或类型"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") startIndex(); }}
            />
            {query && (
              <button className="fm-clear" type="button" onClick={() => setQuery("")} aria-label="清空搜索">
                <Icon name="x" size={13} />
              </button>
            )}
          </div>
          <button className="btn secondary sm fm-index-btn" onClick={startIndex} disabled={loading}>
            <Icon name="refresh" size={14} />{loading ? "索引中" : "建立索引"}
          </button>
        </div>
        <div className="fm-tools">
          <div className="segmented smart-view" aria-label="智能视图">
            {SMART_VIEWS.map((view) => (
              <button key={view.id} className={smartView === view.id ? "active" : ""} onClick={() => setSmartView(view.id)} title={view.hint}>
                {view.label}
              </button>
            ))}
          </div>
          <div className="segmented" aria-label="文件类型过滤">
            {KIND_FILTERS.map((kind) => (
              <button key={kind} className={kindFilter === kind ? "active" : ""} onClick={() => setKindFilter(kind)}>
                {kind}
              </button>
            ))}
          </div>
          <select className="select-control" value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} aria-label="排序方式">
            <option value="modified">最近修改</option>
            <option value="size">文件最大</option>
            <option value="name">名称排序</option>
          </select>
        </div>
      </div>

      {error && <Banner tone="warn">{error}</Banner>}

      <div className="grid g-3">
        <section className="panel metric-soft">
          <div className="panel-head soft-head">
            <span className="ichip"><Icon name="shield" size={15} /></span>
            <div>
              <div className="title">索引状态</div>
              <div className="meta">只读取文件元数据</div>
            </div>
          </div>
          <div className="panel-body stack" style={{ gap: 12 }}>
            <div className="metric-line"><span>状态</span><b>{indexed ? "已就绪" : loading ? "索引中" : "待索引"}</b></div>
            <div className="metric-line"><span>进度</span><RollingNumber value={indexPct} unit="%" /></div>
            <div className="progress"><span style={{ width: `${indexPct}%` }} /></div>
            <div className="metric-line"><span>文件数量</span><RollingNumber value={visible.length} /></div>
            <div className="metric-line"><span>上次索引</span><b>{lastIndexedAt ? new Date(lastIndexedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "--"}</b></div>
          </div>
        </section>

        <section className="panel metric-soft">
          <div className="panel-head soft-head">
            <span className="ichip"><Icon name="folder" size={15} /></span>
            <div>
              <div className="title">扫描范围</div>
              <div className="meta">下载、文档、桌面、图片、视频</div>
            </div>
          </div>
          <div className="panel-body">
            <div className="metric-line"><span>可见体积</span><b><RollingSize bytes={totalBytes} compact /></b></div>
            <div className="metric-line"><span>当前来源</span><b>{isTauri() ? "本机" : "预览"}</b></div>
            <div className="metric-line"><span>类型数量</span><b><RollingNumber value={typeCount} compact /></b></div>
          </div>
        </section>

        <section className="panel metric-soft">
          <div className="panel-head soft-head">
            <span className="ichip"><Icon name="sparkles" size={15} /></span>
            <div>
              <div className="title">AI 描述</div>
              <div className="meta">基于文件名、大小、时间推断</div>
            </div>
          </div>
          <div className="panel-body">
            <div className="metric-line"><span>大文件</span><b><RollingNumber value={largeCount} compact /> 项</b></div>
            <div className="metric-line"><span>近期修改</span><b><RollingNumber value={recentCount} compact /> 项</b></div>
            <div className="metric-line"><span>归档候选</span><b><RollingNumber value={archiveCount} compact /> 项</b></div>
          </div>
        </section>
      </div>

      <section className="panel fm-insights">
        <div className="panel-head soft-head">
          <span className="ichip"><Icon name="activity" size={15} /></span>
          <div>
            <div className="title">索引洞察</div>
            <div className="meta">按可见结果统计，方便继续交给 AI 分析</div>
          </div>
        </div>
        <div className="panel-body fm-kind-bars">
          {kindStats.map(([kind, stat]) => {
            const pct = totalBytes ? Math.max(4, (stat.bytes / totalBytes) * 100) : 0;
            return (
              <button key={kind} className="kind-bar" onClick={() => setKindFilter(kind)}>
                <span className="kind-bar-head"><b>{kind}</b><span><RollingNumber value={stat.count} compact /> 项 · <RollingSize bytes={stat.bytes} compact /></span></span>
                <span className="kind-bar-track"><i style={{ width: `${pct}%` }} /></span>
              </button>
            );
          })}
          {!kindStats.length && <div className="muted body-copy">建立索引后会显示类型分布。</div>}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head soft-head">
          <span className="ichip"><Icon name="file" size={15} /></span>
          <div>
            <div className="title">文件列表</div>
            <div className="meta"><RollingNumber value={visible.length} compact /> 项</div>
          </div>
        </div>
        <div className="panel-body tight table-wrap">
          <table className="dtable">
            <thead>
            <tr>
                <th style={{ width: "32%" }}>名称</th>
                <th style={{ width: "28%" }}>位置</th>
                <th style={{ width: "12%" }}>类型</th>
                <th style={{ width: "11%" }}>大小</th>
                <th style={{ width: "11%" }}>修改</th>
                <th style={{ width: "6%" }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((f) => (
                <tr key={f.path}>
                  <td><div className="lead"><span className="ichip sm"><Icon name={KIND_ICON[f.kind] ?? "file"} size={13} /></span><span className="nm">{f.name}</span></div></td>
                  <td className="mono muted">{f.display_path}</td>
                  <td><span className="pill flat">{f.kind}</span></td>
                  <td className="mono"><RollingSize bytes={f.size_bytes} compact /></td>
                  <td className="mono muted">{fmtTime(f.modified_secs)}</td>
                  <td>
                    <button className="table-action" onClick={() => revealFile(f.path)} disabled={!isTauri()} title="在访达中显示">
                      <Icon name="folder" size={13} />
                    </button>
                  </td>
                </tr>
              ))}
              {!visible.length && <tr><td colSpan={6} className="muted empty-cell">没有匹配的文件</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

const Banner: React.FC<{ tone?: "warn"; children: React.ReactNode }> = ({ children }) => (
  <div className="panel banner-soft"><Icon name="alert" size={15} /><span>{children}</span></div>
);
