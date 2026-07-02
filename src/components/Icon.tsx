import React from "react";

/**
 * Inline Lucide-style stroke icons (24x24 viewBox, currentColor).
 * Centralised so every section shares one consistent icon set and
 * inherits text colour for light/dark theme support.
 */
export type IconName =
  | "cpu" | "memory" | "disk" | "network" | "activity" | "resource-trend"
  | "thermometer" | "fan" | "gpu"
  | "chat" | "sparkles" | "send" | "plus" | "search" | "file" | "user"
  | "broom" | "trash" | "settings" | "sun" | "moon" | "refresh"
  | "check" | "x" | "alert" | "chevron-right" | "arrow-up" | "arrow-down"
  | "shield" | "history" | "folder" | "command" | "logo";

interface IconProps extends React.SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
  strokeWidth?: number;
}

const PATHS: Record<IconName, React.ReactNode> = {
  cpu: <>
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <rect x="9" y="9" width="6" height="6" />
    <path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3" />
  </>,
  memory: <>
    <rect x="2" y="7" width="20" height="12" rx="2" />
    <path d="M6 7v-2M10 7v-2M14 7v-2M18 7v-2M6 19v-2M10 19v-2M14 19v-2M18 19v-2" />
  </>,
  disk: <>
    <ellipse cx="12" cy="6" rx="9" ry="3.5" />
    <path d="M3 6v6c0 1.93 4.03 3.5 9 3.5s9-1.57 9-3.5V6" />
    <path d="M3 12v6c0 1.93 4.03 3.5 9 3.5s9-1.57 9-3.5v-6" />
  </>,
  network: <>
    <rect x="9" y="2" width="6" height="6" rx="1" />
    <rect x="2" y="16" width="6" height="6" rx="1" />
    <rect x="16" y="16" width="6" height="6" rx="1" />
    <path d="M12 8v3M12 11H5v5M12 11h7v5" />
  </>,
  activity: <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
  "resource-trend": <>
    <path d="M4 5v14h16" />
    <path d="M7 14.5 10.2 11l3.2 2.5L19 8" />
    <path d="M15.8 8H19v3.2" />
    <path d="M8 19v-2M12 19v-4M16 19v-6" />
  </>,
  thermometer: <>
    <path d="M14 14.76V5a4 4 0 0 0-8 0v9.76A6 6 0 1 0 14 14.76z" />
    <path d="M10 9v8" />
  </>,
  fan: <>
    <path d="M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0" />
    <path d="M12 10V4.5a2.5 2.5 0 0 1 5 0c0 2.2-2.4 4.3-4.2 5.7" />
    <path d="M13.7 13 18.5 15.8a2.5 2.5 0 0 1-2.5 4.3c-1.9-1.1-2.5-4.2-2.3-6.4" />
    <path d="M10.3 13 5.5 15.8A2.5 2.5 0 0 1 3 11.5c1.9-1.1 4.9 0 6.8 1.2" />
  </>,
  gpu: <>
    <rect x="3" y="6" width="14" height="12" rx="2" />
    <path d="M7 10h6v4H7zM17 10h4M17 14h4M8 3v3M12 3v3M8 18v3M12 18v3" />
  </>,
  chat: <>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </>,
  sparkles: <>
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
    <path d="M19 3v4M21 5h-4M5 17v2M6 18H4" />
  </>,
  send: <>
    <path d="M22 2 11 13" />
    <path d="M22 2 15 22l-4-9-9-4z" />
  </>,
  plus: <path d="M12 5v14M5 12h14" />,
  search: <>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </>,
  file: <>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
  </>,
  user: <>
    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </>,
  broom: <>
    <path d="m20 4-8 8" />
    <path d="M14 6l4 4" />
    <path d="M9 13 4 18a2 2 0 0 0 0 2.8L4 22h4l5-5" />
    <path d="M9 13c2-2 4 0 6-2" />
  </>,
  trash: <>
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
  </>,
  settings: <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </>,
  sun: <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </>,
  moon: <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />,
  refresh: <>
    <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    <path d="M3 21v-5h5" />
  </>,
  check: <path d="M20 6 9 17l-5-5" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  alert: <>
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    <path d="M12 9v4M12 17h.01" />
  </>,
  "chevron-right": <path d="m9 18 6-6-6-6" />,
  "arrow-up": <path d="M12 19V5M5 12l7-7 7 7" />,
  "arrow-down": <path d="M12 5v14M19 12l-7 7-7-7" />,
  shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
  history: <>
    <path d="M3 3v5h5" />
    <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
    <path d="M12 7v5l4 2" />
  </>,
  folder: <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2z" />,
  command: <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z" />,
  logo: <>
    <path d="M12 2 3 6v6c0 5 3.8 8.5 9 10 5.2-1.5 9-5 9-10V6z" />
    <path d="M9 12l2 2 4-4" />
  </>,
};

export const Icon: React.FC<IconProps> = ({
  name,
  size = 18,
  strokeWidth = 2,
  ...rest
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...rest}
  >
    {PATHS[name]}
  </svg>
);
