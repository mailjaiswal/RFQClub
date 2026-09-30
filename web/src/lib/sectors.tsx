// Sector taxonomy + palette, ported verbatim from the prototype / api/sectors.py
export type SectorKey =
  | "cnc"
  | "foundry"
  | "sheet"
  | "auto"
  | "elec"
  | "tools"
  | "plant";

export interface SectorMeta {
  key: SectorKey;
  label: string;
  base: string;
  soft: string;
}

export const SECTORS: Record<SectorKey, SectorMeta> = {
  cnc: { key: "cnc", label: "CNC & Machining", base: "#3F4397", soft: "rgba(63,67,151,.12)" },
  foundry: { key: "foundry", label: "Foundry & Casting", base: "#C65C1E", soft: "rgba(198,92,30,.12)" },
  sheet: { key: "sheet", label: "Sheet Metal & Fabrication", base: "#2E6E46", soft: "rgba(46,110,70,.12)" },
  auto: { key: "auto", label: "Automotive Parts", base: "#1E6C78", soft: "rgba(30,108,120,.12)" },
  elec: { key: "elec", label: "Electrical Panels", base: "#9A6414", soft: "rgba(154,100,20,.12)" },
  tools: { key: "tools", label: "Tools & Fixtures", base: "#8A3A5E", soft: "rgba(138,58,94,.12)" },
  plant: { key: "plant", label: "Plant & Machinery / Raw Mat.", base: "#3A3A3A", soft: "rgba(58,58,58,.10)" },
};

export const SECTOR_LIST: SectorMeta[] = Object.values(SECTORS);

export function sectorMeta(key: string): SectorMeta {
  return (SECTORS as Record<string, SectorMeta>)[key] ?? SECTORS.cnc;
}

// Minimal custom inline line-icons (no photos), one per sector.
export function SectorGlyph({ sector, size = 16 }: { sector: string; size?: number }) {
  const s = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (sector) {
    case "foundry":
      return <svg {...s}><path d="M4 20h16M7 20V9l5-4 5 4v11" /><path d="M9 13h6" /></svg>;
    case "sheet":
      return <svg {...s}><path d="M3 8l9-4 9 4-9 4-9-4z" /><path d="M3 8v8l9 4 9-4V8" /></svg>;
    case "auto":
      return <svg {...s}><circle cx="7" cy="17" r="2" /><circle cx="17" cy="17" r="2" /><path d="M4 15l2-5h9l4 5" /></svg>;
    case "elec":
      return <svg {...s}><rect x="5" y="4" width="14" height="16" rx="1.5" /><path d="M9 9h6M9 13h6M9 17h3" /></svg>;
    case "tools":
      return <svg {...s}><path d="M14 6l4 4-8 8-4-4 8-8z" /><path d="M5 19l2-2" /></svg>;
    case "plant":
      return <svg {...s}><path d="M3 20h18M6 20V8l6-4 6 4v12" /><path d="M10 20v-5h4v5" /></svg>;
    case "cnc":
    default:
      return <svg {...s}><circle cx="12" cy="12" r="7" /><path d="M12 5v4M12 15v4M5 12h4M15 12h4" /></svg>;
  }
}
