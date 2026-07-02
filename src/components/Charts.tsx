import React from "react";

/**
 * Tiny dependency-free SVG charts. Kept minimal on purpose: the design kit
 * reserves colour for "data moments only", so these stay in the blue ramp.
 */

interface SparkProps {
  data: number[];
  /** max value for normalisation; if omitted, uses the series max */
  max?: number;
  height?: number;
  color?: string;
  fill?: boolean;
  className?: string;
}

export const Sparkline: React.FC<SparkProps> = ({
  data,
  max,
  height = 28,
  color = "var(--chart-2)",
  fill = false,
  className,
}) => {
  if (!data.length) return <svg className={className} height={height} style={{ width: "100%" }} />;
  const peak = Math.max(max ?? 0, ...data, 1);
  const w = 100;
  const step = data.length > 1 ? w / (data.length - 1) : w;
  const pts = data.map((v, i) => [i * step, height - (v / peak) * (height - 4) - 2]);
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(" ");
  return (
    <svg
      className={className}
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      height={height}
      style={{ width: "100%", display: "block" }}
    >
      {fill && <path d={`${line} L${w} ${height} L0 ${height} Z`} fill="transparent" />}
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
};

interface TrendProps {
  cpu: number[];
  mem: number[];
  height?: number;
}

/** Two-series line chart for CPU (blue) vs memory (lighter blue). */
export const TrendChart: React.FC<TrendProps> = ({ cpu, mem, height = 180 }) => {
  const W = 600;
  const H = height;
  const padB = 24;
  const toPath = (series: number[]) => {
    if (series.length < 2) return "";
    const step = W / (series.length - 1);
    return series
      .map((v, i) => {
        const x = i * step;
        const y = H - padB - (v / 100) * (H - padB - 8);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");
  };
  const cpuPath = toPath(cpu);
  const memPath = toPath(mem);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height, display: "block" }}>
      {cpuPath && <path d={cpuPath} fill="none" stroke="var(--chart-2)" strokeWidth={2} strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
      {memPath && <path d={memPath} fill="none" stroke="var(--chart-1)" strokeWidth={1.5} strokeDasharray="3 3" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
    </svg>
  );
};
