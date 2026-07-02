import React from "react";
import { Icon, IconName } from "../components/Icon";
import { Sparkline, TrendChart } from "../components/Charts";
import { RollingNumber } from "../components/RollingNumber";
import {
  useSysStats,
  fmtRate,
  fmtProcMem,
  tier,
  tierLabel,
  isTauri,
} from "./sys";

interface HomeMetric {
  id: string;
  icon: IconName;
  label: string;
  value: number | string | null;
  unit?: string;
  precision?: number;
  pct: number | null;
  spark: number[];
  sparkMax?: number;
  foot: string;
  statusLabel?: string;
  unavailable?: boolean;
}

const MetricCard: React.FC<HomeMetric> = ({
  icon,
  label,
  value,
  unit,
  precision = 0,
  pct,
  spark,
  sparkMax,
  foot,
  statusLabel,
}) => {
  const t = tier(pct);
  return (
    <article className="mcard home-metric">
      <div className="mcard-top">
        <span className="ichip data"><Icon name={icon} size={17} /></span>
        <span className={`pill ${t}`}>{statusLabel ?? tierLabel(t)}</span>
      </div>
      <div>
        <div className="mcard-eyebrow home-metric-label">{label}</div>
        <RollingNumber value={value} unit={unit} precision={precision} className="mcard-value" />
      </div>
      {pct != null && (
        <div className={`progress ${t}`}><span style={{ ["--val" as string]: `${pct}%`, width: `${pct}%` }} /></div>
      )}
      <Sparkline data={spark} max={sparkMax} />
      <div className="mcard-foot"><span>{foot}</span></div>
    </article>
  );
};

export const Dashboard: React.FC<{ theme: string }> = () => {
  const { stats, error, history } = useSysStats();
  const preview = !isTauri() || error || !stats;

  const memPct = stats && stats.total_memory ? (stats.used_memory / stats.total_memory) * 100 : null;
  const diskPct = stats && stats.disk_total && stats.disk_used ? (stats.disk_used / stats.disk_total) * 100 : null;
  const down = fmtRate(stats?.net_down_bps);
  const up = fmtRate(stats?.net_up_bps);
  const usedMemGB = stats ? stats.used_memory / 1024 / 1024 / 1024 : null;
  const totalMemGB = stats ? stats.total_memory / 1024 / 1024 / 1024 : null;
  const diskUsedGB = stats?.disk_used != null ? stats.disk_used / 1024 / 1024 / 1024 : null;
  const diskTotalGB = stats?.disk_total != null ? stats.disk_total / 1024 / 1024 / 1024 : null;

  const metrics: HomeMetric[] = [
    {
      id: "memory",
      icon: "memory",
      label: "内存占用",
      value: usedMemGB,
      unit: totalMemGB != null ? `/ ${totalMemGB.toFixed(totalMemGB >= 10 ? 1 : 2)} GB` : "GB",
      precision: usedMemGB != null && usedMemGB < 10 ? 2 : 1,
      pct: memPct,
      spark: history.mem,
      sparkMax: 100,
      foot: preview ? "预览模式" : "已用 / 总量 · 实时",
      unavailable: usedMemGB == null,
    },
    {
      id: "disk",
      icon: "disk",
      label: "磁盘占用",
      value: diskUsedGB,
      unit: diskTotalGB != null ? `/ ${diskTotalGB.toFixed(diskTotalGB >= 100 ? 0 : 1)} GB` : "GB",
      precision: diskUsedGB != null && diskUsedGB >= 100 ? 0 : 1,
      pct: diskPct,
      spark: history.disk,
      sparkMax: 100,
      foot: stats?.disk_name ?? (preview ? "预览模式" : "主卷"),
      unavailable: diskUsedGB == null,
    },
    {
      id: "cpu-temp",
      icon: "thermometer",
      label: "CPU 温度",
      value: stats?.cpu_temp_c ?? null,
      unit: "°C",
      precision: 1,
      pct: stats?.cpu_temp_c != null ? Math.min(100, Math.max(0, (stats.cpu_temp_c / 100) * 100)) : null,
      spark: history.temp,
      sparkMax: 100,
      foot: "传感器 · 实时",
      unavailable: stats?.cpu_temp_c == null,
    },
    {
      id: "fan",
      icon: "fan",
      label: "风扇转速",
      value: stats?.fan_rpm ?? null,
      unit: "RPM",
      precision: 0,
      pct: null,
      spark: [],
      foot: "风扇 · 实时",
      statusLabel: "实时",
      unavailable: stats?.fan_rpm == null,
    },
    {
      id: "network",
      icon: "network",
      label: "网速",
      value: down.v,
      unit: down.u,
      precision: down.v.includes(".") ? 1 : 0,
      pct: null,
      spark: history.down,
      foot: `↑ 上行 ${up.v} ${up.u}`,
      statusLabel: "实时",
      unavailable: stats?.net_down_bps == null,
    },
    {
      id: "cpu",
      icon: "cpu",
      label: "CPU 占用",
      value: stats?.cpu_usage ?? null,
      unit: "%",
      precision: 1,
      pct: stats?.cpu_usage ?? null,
      spark: history.cpu,
      sparkMax: 100,
      foot: preview ? "预览模式" : "系统全局占用 · 实时",
      unavailable: stats?.cpu_usage == null,
    },
    {
      id: "gpu",
      icon: "gpu",
      label: "GPU 占用",
      value: stats?.gpu_usage ?? null,
      unit: "%",
      precision: 1,
      pct: stats?.gpu_usage ?? null,
      spark: history.gpu,
      sparkMax: 100,
      foot: "图形处理器 · 实时",
      unavailable: stats?.gpu_usage == null,
    },
  ];

  const visibleMetrics = metrics.filter((metric) => !metric.unavailable);

  return (
    <div className="stack">
      {preview && (
        <BannerNote>
          当前是浏览器预览；运行 <code>npm run tauri dev</code> 后可读取真实系统数据。
        </BannerNote>
      )}

      <div className="home-metrics-grid">
        {visibleMetrics.map((metric) => <MetricCard key={metric.id} {...metric} />)}
      </div>

      <div className="grid dashboard-split">
        <section className="panel">
          <div className="panel-head">
            <div className="row" style={{ gap: 12 }}>
              <span className="ichip chart-chip"><Icon name="resource-trend" size={17} /></span>
              <div>
                <div className="title">资源使用趋势</div>
                <div className="meta">近一分钟滚动采样</div>
              </div>
            </div>
            <div className="row" style={{ gap: 14, fontSize: 12, color: "var(--muted-foreground)" }}>
              <span className="row" style={{ gap: 6 }}><i style={{ width: 10, height: 2, background: "var(--chart-2)", borderRadius: 2 }} />CPU</span>
              <span className="row" style={{ gap: 6 }}><i style={{ width: 10, height: 2, background: "var(--chart-1)", borderRadius: 2, borderTop: "1px dashed" }} />内存</span>
            </div>
          </div>
          <div className="panel-body">
            <TrendChart cpu={history.cpu} mem={history.mem} />
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <div className="row" style={{ gap: 12 }}>
              <span className="ichip"><Icon name="command" size={16} /></span>
              <div>
                <div className="title">活跃进程</div>
                <div className="meta">按 CPU 占用排序 · Top 8</div>
              </div>
            </div>
          </div>
          <div className="panel-body tight" style={{ padding: "6px 6px 8px" }}>
            <table className="dtable">
              <thead>
                <tr>
                  <th style={{ width: "52%" }}>进程</th>
                  <th style={{ width: "20%" }}>CPU</th>
                  <th style={{ width: "28%" }}>内存</th>
                </tr>
              </thead>
              <tbody>
                {(stats?.processes ?? []).map((p) => (
                  <tr key={p.pid}>
                    <td>
                      <div className="lead">
                        <span className="ichip" style={{ width: 24, height: 24 }}>
                          <Icon name="command" size={13} />
                        </span>
                        <span className="nm">{p.name || `PID ${p.pid}`}</span>
                      </div>
                    </td>
                    <td className="mono">{p.cpu_usage.toFixed(1)}%</td>
                    <td className="mono muted">{fmtProcMem(p.memory)}</td>
                  </tr>
                ))}
                {!stats?.processes.length && (
                  <tr><td colSpan={3} className="muted" style={{ textAlign: "center", padding: 24 }}>暂无进程数据</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
};

const BannerNote: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="panel banner-soft"><Icon name="shield" size={15} /><span>{children}</span></div>
);
