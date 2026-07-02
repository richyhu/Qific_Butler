import React, { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Icon, IconName } from "../components/Icon";
import { RollingNumber, RollingSize } from "../components/RollingNumber";
import { CleanupCandidate, TrashResult, fmtSize, isTauri } from "./sys";

interface LogEntry {
  id: string;
  name: string;
  size: string;
  time: string;
  status: string;
  path: string;
}

const LOG_KEY = "qific.cleanup_log";

const SAMPLE_ITEMS: CleanupCandidate[] = [
  { id: "sample-1", category: "大文件", name: "iOS 模拟器镜像.dmg", path: "~/Downloads/iOS 模拟器镜像.dmg", display_path: "~/Downloads", size_bytes: 6.4 * 1024 ** 3, reason: "超过 1GB 的安装镜像" },
  { id: "sample-2", category: "陈旧文件", name: "2023-汇报.pptx", path: "~/Documents/归档/2023-汇报.pptx", display_path: "~/Documents/归档", size_bytes: 18 * 1024 ** 2, reason: "超过 180 天未访问" },
  { id: "sample-3", category: "重复文件", name: "头像.png", path: "~/Downloads/头像.png", display_path: "~/Downloads", size_bytes: 860 * 1024, reason: "文件名与体积存在重复" },
];

const CAT_ICON: Record<CleanupCandidate["category"], IconName> = { 大文件: "file", 陈旧文件: "history", 重复文件: "folder" };

const riskFor = (item: CleanupCandidate): "low" | "medium" | "high" => {
  if (item.category === "重复文件") return "medium";
  if (item.category === "大文件" && item.size_bytes >= 5 * 1024 ** 3) return "high";
  if (item.category === "陈旧文件") return "low";
  return "medium";
};

const riskLabel = (risk: "low" | "medium" | "high") =>
  risk === "high" ? "需复核" : risk === "medium" ? "谨慎" : "较安全";

export const Cleanup: React.FC = () => {
  const [scanned, setScanned] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [items, setItems] = useState<CleanupCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [log, setLog] = useState<LogEntry[]>(() => {
    try { return JSON.parse(localStorage.getItem(LOG_KEY) ?? "[]") as LogEntry[]; } catch { return []; }
  });
  const [intent, setIntent] = useState("清理下载文件夹里的大文件和重复文件");
  const [error, setError] = useState("");
  const [confirmMove, setConfirmMove] = useState(false);
  const [lastScanAt, setLastScanAt] = useState<number | null>(null);

  useEffect(() => {
    localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(0, 80)));
  }, [log]);

  const chosen = useMemo(() => items.filter((i) => selected.has(i.id)), [items, selected]);
  const totalReclaim = chosen.reduce((a, b) => a + b.size_bytes, 0);
  const allBytes = items.reduce((a, b) => a + b.size_bytes, 0);
  const selectedByCategory = useMemo(() => {
    return chosen.reduce<Record<string, number>>((acc, item) => {
      acc[item.category] = (acc[item.category] ?? 0) + 1;
      return acc;
    }, {});
  }, [chosen]);
  const riskStats = useMemo(() => {
    return chosen.reduce<Record<"low" | "medium" | "high", number>>((acc, item) => {
      acc[riskFor(item)] += 1;
      return acc;
    }, { low: 0, medium: 0, high: 0 });
  }, [chosen]);

  const runScan = async () => {
    setScanning(true);
    setScanned(false);
    setError("");
    try {
      let rows: CleanupCandidate[];
      if (!isTauri()) {
        await new Promise((resolve) => window.setTimeout(resolve, 650));
        rows = SAMPLE_ITEMS;
      } else {
        rows = await invoke<CleanupCandidate[]>("cleanup_scan", { intent });
      }
      setItems(rows);
      setSelected(new Set(rows.map((i) => i.id)));
      setScanned(true);
      setConfirmMove(false);
      setLastScanAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  };

  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const selectCategory = (category: CleanupCandidate["category"]) => {
    setSelected(new Set(items.filter((item) => item.category === category).map((item) => item.id)));
    setConfirmMove(false);
  };

  const selectLowerRisk = () => {
    setSelected(new Set(items.filter((item) => riskFor(item) !== "high").map((item) => item.id)));
    setConfirmMove(false);
  };

  const revealFile = async (path: string) => {
    if (!isTauri()) return;
    try {
      await revealItemInDir(path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const execute = async () => {
    if (!confirmMove) return;
    setExecuting(true);
    setError("");
    const time = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    try {
      let results: TrashResult[];
      if (!isTauri()) {
        results = chosen.map((i) => ({ path: i.path, name: i.name, success: true, message: "预览模式" }));
      } else {
        results = await invoke<TrashResult[]>("move_items_to_trash", { paths: chosen.map((i) => i.path) });
      }
      const byPath = new Map(chosen.map((i) => [i.path, i]));
      setLog((l) => [
        ...results.map((r, idx) => {
          const item = byPath.get(r.path);
          return {
            id: `${Date.now()}-${idx}`,
            name: r.name,
            size: item ? fmtSize(item.size_bytes) : "--",
            time,
            status: r.success ? "已移到废纸篓" : r.message,
            path: r.path,
          };
        }),
        ...l,
      ]);
      setItems((rows) => rows.filter((i) => !selected.has(i.id)));
      setSelected(new Set());
      setConfirmMove(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head soft-head">
          <span className="ichip"><Icon name="broom" size={16} /></span>
          <div>
            <div className="title">告诉管家你想清理什么</div>
            <div className="meta">先生成方案，再由你确认移到废纸篓</div>
          </div>
        </div>
        <div className="panel-body">
          <div className="ai-input-row">
            <input className="field" value={intent} onChange={(e) => setIntent(e.target.value)} />
            <button className="btn primary" onClick={runScan} disabled={scanning}>
              <Icon name="sparkles" size={15} />{scanning ? "扫描中" : scanned ? "重新扫描" : "让 AI 规划"}
            </button>
          </div>
          <div className="ai-suggestions" style={{ marginTop: 12 }}>
            {["清理下载文件夹", "找出重复文件", "删除 180 天没用的文件"].map((s) => (
              <button key={s} className="ai-chip" onClick={() => setIntent(s)}>{s}</button>
            ))}
          </div>
        </div>
      </section>

      {error && <div className="panel banner-soft"><Icon name="alert" size={15} /><span>{error}</span></div>}

      <div className="grid g-3 cleanup-metrics">
        <section className="panel metric-soft">
          <div className="panel-head soft-head"><span className="ichip"><Icon name="file" size={15} /></span><div><div className="title">候选项</div><div className="meta">当前扫描结果</div></div></div>
          <div className="panel-body"><div className="mcard-value compact-value"><RollingNumber value={items.length} /></div><p className="muted body-copy">已选 <RollingNumber value={selected.size} compact /> 项</p></div>
        </section>
        <section className="panel metric-soft">
          <div className="panel-head soft-head"><span className="ichip"><Icon name="disk" size={15} /></span><div><div className="title">预计释放</div><div className="meta">只计算已选项目</div></div></div>
          <div className="panel-body"><div className="mcard-value compact-value"><RollingSize bytes={totalReclaim} /></div><p className="muted body-copy">总候选 <RollingSize bytes={allBytes} compact /></p></div>
        </section>
        <section className="panel metric-soft">
          <div className="panel-head soft-head"><span className="ichip"><Icon name="shield" size={15} /></span><div><div className="title">风险审核</div><div className="meta">高风险项不会自动跳过</div></div></div>
          <div className="panel-body cleanup-risk-line"><span className="risk-chip low">较安全 <RollingNumber value={riskStats.low} compact /></span><span className="risk-chip medium">谨慎 <RollingNumber value={riskStats.medium} compact /></span><span className="risk-chip high">需复核 <RollingNumber value={riskStats.high} compact /></span></div>
        </section>
      </div>

      <section className="panel" aria-disabled={!scanned && !scanning}>
        <div className="panel-head soft-head">
          <span className="ichip"><Icon name="shield" size={16} /></span>
          <div>
            <div className="title">清理方案</div>
            <div className="meta">不会永久删除；执行结果会写入本地日志</div>
          </div>
          {scanned && <div className="soft-summary"><span>已选 <RollingNumber value={selected.size} compact /> 项</span><span>预计释放 <RollingSize bytes={totalReclaim} compact /></span><span>{lastScanAt ? new Date(lastScanAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : ""}</span></div>}
        </div>
        {scanned && (
          <div className="cleanup-summary">
            <div>
              <span>风险边界</span>
              <b>只移到废纸篓，不永久删除</b>
            </div>
            <div>
              <span>选择分布</span>
              <b>{Object.entries(selectedByCategory).map(([k, v]) => `${k} ${v}`).join(" · ") || "未选择"}</b>
            </div>
            <label className="confirm-check">
              <input type="checkbox" checked={confirmMove} onChange={(e) => setConfirmMove(e.target.checked)} />
              <span>我已确认选中项，可以移动到废纸篓</span>
            </label>
          </div>
        )}
        {scanned && (
          <div className="cleanup-toolbar">
            <button className="ai-chip" onClick={selectLowerRisk}>选择较安全项</button>
            <button className="ai-chip" onClick={() => selectCategory("大文件")}>只看大文件</button>
            <button className="ai-chip" onClick={() => selectCategory("陈旧文件")}>只看陈旧文件</button>
            <button className="ai-chip" onClick={() => selectCategory("重复文件")}>只看重复文件</button>
          </div>
        )}
        <div className="panel-body tight table-wrap">
          {scanning ? (
            <div className="empty"><Icon name="refresh" size={22} /><span className="ttl">正在扫描</span><span>分析文件大小、访问时间与重复项</span></div>
          ) : scanned ? (
            <table className="dtable">
              <thead>
                <tr><th style={{ width: "5%" }}></th><th style={{ width: "27%" }}>文件</th><th style={{ width: "22%" }}>位置</th><th style={{ width: "12%" }}>分类</th><th style={{ width: "11%" }}>风险</th><th style={{ width: "11%" }}>大小</th><th style={{ width: "9%" }}>操作</th></tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const risk = riskFor(it);
                  return (
                    <tr key={it.id}>
                      <td><input type="checkbox" className="ck" checked={selected.has(it.id)} onChange={() => toggle(it.id)} aria-label={`选择 ${it.name}`} /></td>
                      <td><div className="lead"><span className="ichip sm"><Icon name={CAT_ICON[it.category]} size={13} /></span><span className="nm" title={it.reason}>{it.name}</span></div></td>
                      <td className="mono muted">{it.display_path}</td>
                      <td><span className="pill flat">{it.category}</span></td>
                      <td><span className={`risk-chip ${risk}`}>{riskLabel(risk)}</span></td>
                      <td className="mono"><RollingSize bytes={it.size_bytes} compact /></td>
                      <td><button className="table-action" onClick={() => revealFile(it.path)} disabled={!isTauri()} title="在访达中显示"><Icon name="folder" size={13} /></button></td>
                    </tr>
                  );
                })}
                {!items.length && <tr><td colSpan={7} className="muted empty-cell">没有发现建议清理项</td></tr>}
              </tbody>
            </table>
          ) : (
            <div className="empty"><span className="ichip xl"><Icon name="broom" size={20} /></span><span className="ttl">还没有清理方案</span><span>输入目标后生成方案</span></div>
          )}
        </div>
        {scanned && (
          <div className="panel-body action-strip">
            <button className="btn secondary sm" onClick={() => { setSelected(new Set()); setConfirmMove(false); }}>清空选择</button>
            <button className="btn secondary sm" onClick={() => { setSelected(new Set(items.map((i) => i.id))); setConfirmMove(false); }}>全选</button>
            <button className="btn primary sm" onClick={execute} disabled={!selected.size || executing || !confirmMove}>
              <Icon name="trash" size={14} />{executing ? "移动中" : `移到废纸篓`}
            </button>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head soft-head">
          <span className="ichip"><Icon name="history" size={16} /></span>
          <div><div className="title">操作日志</div><div className="meta">本地保存最近 80 条</div></div>
        </div>
        <div className="panel-body tight table-wrap">
          {!log.length ? <div className="empty compact"><Icon name="history" size={20} /><span className="ttl">还没有操作记录</span></div> : (
            <table className="dtable">
              <thead><tr><th style={{ width: "34%" }}>文件</th><th style={{ width: "16%" }}>大小</th><th style={{ width: "16%" }}>时间</th><th style={{ width: "34%" }}>状态</th></tr></thead>
              <tbody>{log.map((e) => <tr key={e.id}><td><div className="lead"><span className="ichip sm"><Icon name="trash" size={13} /></span><span className="nm">{e.name}</span></div></td><td className="mono">{e.size}</td><td className="mono muted">{e.time}</td><td><span className="pill flat">{e.status}</span></td></tr>)}</tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
};
