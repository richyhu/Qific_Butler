import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * System stats shape — mirrors the Rust `SysStats` / `ProcInfo` structs in
 * `src-tauri/src/lib.rs`. Optional fields are nullable because the backend
 * treats per-platform availability defensively.
 */
export interface ProcInfo {
  name: string;
  pid: number;
  cpu_usage: number;
  memory: number;
}

export interface SysStats {
  cpu_usage: number;
  total_memory: number;
  used_memory: number;
  disk_total: number | null;
  disk_used: number | null;
  disk_name: string | null;
  net_down_bps: number | null;
  net_up_bps: number | null;
  cpu_temp_c: number | null;
  fan_rpm: number | null;
  gpu_usage: number | null;
  processes: ProcInfo[];
}

export interface FileEntry {
  name: string;
  path: string;
  display_path: string;
  kind: string;
  extension: string | null;
  size_bytes: number;
  modified_secs: number | null;
}

export interface CleanupCandidate {
  id: string;
  category: "大文件" | "陈旧文件" | "重复文件";
  name: string;
  path: string;
  display_path: string;
  size_bytes: number;
  reason: string;
}

export interface TrashResult {
  path: string;
  name: string;
  success: boolean;
  message: string;
}

/** Whether we're actually running inside Tauri (vs plain browser). */
export const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Polls `get_sys_stats` while mounted and keeps a rolling history of the
 * scalar metrics for sparklines / trend charts. In a browser (no Tauri)
 * it returns null so the UI can render a graceful degraded state.
 */
export function useSysStats(intervalMs = 1500) {
  const [stats, setStats] = useState<SysStats | null>(null);
  const [error, setError] = useState(false);
  const history = useRef<{ cpu: number[]; mem: number[]; disk: number[]; down: number[]; up: number[]; temp: number[]; gpu: number[] }>({
    cpu: [],
    mem: [],
    disk: [],
    down: [],
    up: [],
    temp: [],
    gpu: [],
  });
  const [, force] = useState(0);

  useEffect(() => {
    if (!isTauri()) {
      setError(true);
      return;
    }
    let alive = true;
    const tick = async () => {
      try {
        const s: SysStats = await invoke("get_sys_stats");
        if (!alive) return;
        setStats(s);
        setError(false);
        const h = history.current;
        const push = (arr: number[], v: number, cap = 40) => {
          arr.push(v);
          if (arr.length > cap) arr.shift();
        };
        push(h.cpu, s.cpu_usage);
        const memPct = s.total_memory ? (s.used_memory / s.total_memory) * 100 : 0;
        const diskPct = s.disk_total && s.disk_used ? (s.disk_used / s.disk_total) * 100 : 0;
        push(h.mem, memPct);
        push(h.disk, diskPct);
        push(h.down, s.net_down_bps ?? 0);
        push(h.up, s.net_up_bps ?? 0);
        push(h.temp, s.cpu_temp_c ?? 0);
        push(h.gpu, s.gpu_usage ?? 0);
        force((n) => n + 1);
      } catch (e) {
        if (!alive) return;
        console.error("get_sys_stats failed:", e);
        setError(true);
      }
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [intervalMs]);

  return { stats, error, history: history.current };
}

// ---------- formatting helpers ----------

export const fmtBytes = (bytes: number | null | undefined, unit = "GB"): string => {
  if (bytes == null) return "--";
  const gb = bytes / 1024 / 1024 / 1024;
  if (unit === "GB") return gb.toFixed(gb >= 100 ? 0 : gb >= 10 ? 1 : 2);
  return (bytes / 1024 / 1024).toFixed(0);
};

export const fmtGB = (bytes: number | null | undefined): string =>
  fmtBytes(bytes, "GB");

export const fmtRate = (bps: number | null | undefined): { v: string; u: string } => {
  if (bps == null) return { v: "--", u: "" };
  if (bps >= 1024 * 1024) return { v: (bps / 1024 / 1024).toFixed(1), u: "MB/s" };
  if (bps >= 1024) return { v: (bps / 1024).toFixed(1), u: "KB/s" };
  return { v: bps.toFixed(0), u: "B/s" };
};

export const fmtProcMem = (bytes: number): string => {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(2) + " GB";
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(0) + " MB";
  return (bytes / 1024).toFixed(0) + " KB";
};

export const fmtSize = (bytes: number | null | undefined): string => {
  if (bytes == null) return "--";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(bytes >= 10 * 1024 ** 3 ? 1 : 2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(bytes >= 10 * 1024 ** 2 ? 0 : 1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
};

export const fmtTime = (secs: number | null | undefined): string => {
  if (!secs) return "未知";
  const diff = Date.now() - secs * 1000;
  const day = 24 * 60 * 60 * 1000;
  if (diff < 60 * 1000) return "刚刚";
  if (diff < 60 * 60 * 1000) return `${Math.max(1, Math.floor(diff / 60000))} 分钟前`;
  if (diff < day) return `${Math.max(1, Math.floor(diff / 3600000))} 小时前`;
  if (diff < day * 30) return `${Math.max(1, Math.floor(diff / day))} 天前`;
  return new Date(secs * 1000).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
};

/** Classify a 0-100 utilisation value into a status tier. */
export const tier = (pct: number | null): "ok" | "warn" | "critical" => {
  if (pct == null) return "ok";
  if (pct >= 85) return "critical";
  if (pct >= 60) return "warn";
  return "ok";
};

export const tierLabel = (t: "ok" | "warn" | "critical"): string =>
  t === "critical" ? "临界" : t === "warn" ? "偏高" : "正常";
