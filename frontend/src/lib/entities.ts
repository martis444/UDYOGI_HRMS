// Single source of truth for entity identity colors.
// Each of the four entities has a visually distinct hue (USAPL = teal, kept
// distinct from UMPL blue, UPPL red, UAPL green, and the ink/neutral chrome).

export const ENTITY_COLORS: Record<string, string> = {
  UPPL:  "#E5202E", // red (brand primary)
  USAPL: "#0D9488", // teal
  UAPL:  "#16A34A", // green
  UMPL:  "#2563EB", // blue
};

export const ENTITY_FALLBACK = "#6B7280";

export function entityColor(id: string): string {
  return ENTITY_COLORS[id] ?? ENTITY_FALLBACK;
}
