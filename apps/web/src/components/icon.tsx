import type { CSSProperties } from "react";
const paths: Record<string, string> = {
  map: "M9 18 3 21V6l6-3 6 3 6-3v15l-6 3-6-3Zm0-15v15m6-12v15",
  people:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m8-7a4 4 0 0 1 0 8m5 9v-2a4 4 0 0 0-3-3.87",
  plus: "M12 5v14M5 12h14",
  calendar:
    "M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Zm3 10h3m3 0h2m-8 4h3",
  profile: "M20 21a8 8 0 0 0-16 0M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-11 12a2 2 0 0 0 4 0",
  save: "M5 3h14v19l-7-5-7 5V3Z",
  heart:
    "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z",
  close: "m6 6 12 12M6 18 18 6",
  check: "m5 12 4 4L19 6",
  chat: "M21 11a8 8 0 0 1-8 8H7l-5 3 2-6a8 8 0 1 1 17-5Z",
  shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm0 5v5m0 3h.01",
  filter: "M4 7h16M4 17h16M8 4v6m8 4v6",
  pin: "M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Zm-5 0a3 3 0 1 0-6 0 3 3 0 0 0 6 0",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  activity: "M3 12h4l3-8 4 16 3-8h4",
  block: "M20.5 20.5 3.5 3.5M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20",
  flag: "M4 22V3h13l-2 5 2 5H4",
  club: "M3 21v-9l9-9 9 9v9h-6v-7H9v7H3Z",
};
export function Icon({
  name,
  size = 22,
  style,
}: {
  name: string;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      className="ui-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={style}
    >
      <path d={paths[name] || paths.activity} />
    </svg>
  );
}
