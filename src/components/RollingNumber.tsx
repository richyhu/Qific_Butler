import React, { useMemo } from "react";

interface RollingNumberProps {
  value: number | string | null | undefined;
  unit?: string;
  precision?: number;
  compact?: boolean;
  className?: string;
}

interface RollingSizeProps {
  bytes: number | null | undefined;
  compact?: boolean;
  className?: string;
}

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

const numericValue = (value: RollingNumberProps["value"]): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

export const RollingNumber: React.FC<RollingNumberProps> = ({
  value,
  unit,
  precision = 0,
  compact,
  className = "",
}) => {
  const number = numericValue(value);
  const text = useMemo(() => {
    if (number == null) return typeof value === "string" ? value : "--";
    return number.toLocaleString("en-US", {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    });
  }, [number, precision, value]);

  return (
    <span
      className={`rolling-number ${compact ? "compact" : ""} ${className}`.trim()}
      aria-label={`${text}${unit ? ` ${unit}` : ""}`}
    >
      <span className="rolling-value" aria-hidden="true">
        {text.split("").map((char, index) => {
          if (!/\d/.test(char)) {
            return <span className="rolling-static" key={`${index}-${char}`}>{char}</span>;
          }
          const digit = Number(char);
          return (
            <span className="rolling-digit-clip" key={index}>
              <span className="rolling-digit-reel" style={{ transform: `translate3d(0, -${digit}em, 0)` }}>
                {DIGITS.map((n) => <span key={n} className="rolling-digit-cell">{n}</span>)}
              </span>
            </span>
          );
        })}
      </span>
      {unit && <span className="rolling-unit">{unit}</span>}
    </span>
  );
};

const sizeParts = (bytes: number | null | undefined) => {
  if (bytes == null || !Number.isFinite(bytes)) return { value: null, unit: "" };
  if (bytes >= 1024 ** 3) {
    return {
      value: bytes / 1024 ** 3,
      unit: "GB",
      precision: bytes >= 10 * 1024 ** 3 ? 1 : 2,
    };
  }
  if (bytes >= 1024 ** 2) {
    return {
      value: bytes / 1024 ** 2,
      unit: "MB",
      precision: bytes >= 10 * 1024 ** 2 ? 0 : 1,
    };
  }
  if (bytes >= 1024) return { value: bytes / 1024, unit: "KB", precision: 0 };
  return { value: bytes, unit: "B", precision: 0 };
};

export const RollingSize: React.FC<RollingSizeProps> = ({ bytes, compact, className }) => {
  const parts = sizeParts(bytes);
  return (
    <RollingNumber
      value={parts.value}
      unit={parts.unit}
      precision={parts.precision ?? 0}
      compact={compact}
      className={className}
    />
  );
};
