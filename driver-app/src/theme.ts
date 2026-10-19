// Layout, type and spacing tokens from the Stitch "Heavy Industrial Precision" spec (design-reference/.../DESIGN.md).
// Colours follow the approved AJ Earth Movers Driver brand (design-reference/brand): navy #142B45, orange #F28C28, white.
// Text on orange is always navy: white on #F28C28 is only ~2.6:1 contrast.
export const color = {
  accent: "#F28C28",
  accentSoft: "#FEF1E4",
  accentText: "#9A4A06",
  navy: "#142B45",
  navyRaised: "#203C59",
  navyDeep: "#0C1D30",
  ink: "#0F172A",
  white: "#FFFFFF",
  canvas: "#F8FAFC",
  recessed: "#F1F5F9",
  border: "#E2E8F0",
  borderStrong: "#CBD5E1",
  muted: "#5B6B80",
  placeholder: "#64748B",
  success: "#10B981",
  successBg: "#ECFDF5",
  successText: "#065F46",
  warning: "#F59E0B",
  warningBg: "#FFFBEB",
  warningText: "#92400E",
  danger: "#EF4444",
  dangerBg: "#FEF2F2",
  dangerText: "#991B1B",
  info: "#3B82F6",
  infoBg: "#EFF6FF",
  infoText: "#1E40AF",
} as const;

export const font = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
  extrabold: "Inter_800ExtraBold",
} as const;

export const type = {
  displayLg: { fontFamily: font.extrabold, fontSize: 32, lineHeight: 40, letterSpacing: -0.9 },
  displaySm: { fontFamily: font.extrabold, fontSize: 26, lineHeight: 34, letterSpacing: -0.5 },
  headlineLg: { fontFamily: font.bold, fontSize: 22, lineHeight: 28, letterSpacing: -0.4 },
  headlineMd: { fontFamily: font.bold, fontSize: 19, lineHeight: 26, letterSpacing: -0.2 },
  headlineSm: { fontFamily: font.semibold, fontSize: 17, lineHeight: 24 },
  bodyLg: { fontFamily: font.medium, fontSize: 16, lineHeight: 24 },
  bodyMd: { fontFamily: font.regular, fontSize: 14, lineHeight: 20 },
  bodySm: { fontFamily: font.regular, fontSize: 13, lineHeight: 18 },
  labelLg: { fontFamily: font.semibold, fontSize: 14, lineHeight: 18 },
  labelMd: { fontFamily: font.semibold, fontSize: 12, lineHeight: 16 },
  labelSm: { fontFamily: font.bold, fontSize: 11, lineHeight: 14, letterSpacing: 0.44, textTransform: "uppercase" as const },
  metric: { fontFamily: font.extrabold, fontSize: 28, lineHeight: 32, letterSpacing: -0.8, fontVariant: ["tabular-nums" as const] },
} as const;

export const space = { xs: 4, sm: 8, md: 14, lg: 20, xl: 28, gutter: 16 } as const;
export const radius = { sm: 4, md: 6, lg: 8, xl: 12, full: 999 } as const;
export const touch = { min: 48 } as const;
