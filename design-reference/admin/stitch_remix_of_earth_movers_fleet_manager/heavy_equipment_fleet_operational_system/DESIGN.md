---
name: Heavy Equipment & Fleet Operational System
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#534434'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#867461'
  outline-variant: '#d8c3ad'
  surface-tint: '#855300'
  primary: '#855300'
  on-primary: '#ffffff'
  primary-container: '#f59e0b'
  on-primary-container: '#613b00'
  inverse-primary: '#ffb95f'
  secondary: '#565e74'
  on-secondary: '#ffffff'
  secondary-container: '#dae2fd'
  on-secondary-container: '#5c647a'
  tertiary: '#515f74'
  on-tertiary: '#ffffff'
  tertiary-container: '#a3b2ca'
  on-tertiary-container: '#374559'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffddb8'
  primary-fixed-dim: '#ffb95f'
  on-primary-fixed: '#2a1700'
  on-primary-fixed-variant: '#653e00'
  secondary-fixed: '#dae2fd'
  secondary-fixed-dim: '#bec6e0'
  on-secondary-fixed: '#131b2e'
  on-secondary-fixed-variant: '#3f465c'
  tertiary-fixed: '#d5e3fd'
  tertiary-fixed-dim: '#b9c7e0'
  on-tertiary-fixed: '#0d1c2f'
  on-tertiary-fixed-variant: '#3a485c'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  headline-xl:
    fontFamily: Inter
    fontSize: 40px
    fontWeight: '800'
    lineHeight: 48px
    letterSpacing: -0.02em
  headline-xl-mobile:
    fontFamily: Inter
    fontSize: 30px
    fontWeight: '800'
    lineHeight: 38px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.015em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Inter
    fontSize: 22px
    fontWeight: '700'
    lineHeight: 28px
  headline-sm:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
  label-numeric-lg:
    fontFamily: JetBrains Mono
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: -0.02em
  label-numeric-md:
    fontFamily: JetBrains Mono
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  label-numeric-sm:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '600'
    lineHeight: 18px
  label-caps:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '700'
    lineHeight: 14px
    letterSpacing: 0.08em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-desktop: 1.5rem
  margin: 1rem
  margin-desktop: 2rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style
The design system operates at the intersection of raw heavy industrial utility and modern, high-precision fleet logistics. Tailored specifically for Indian construction landscapes, mining corridors, and urban earth-moving sites, it serves two demanding user classes: outdoor equipment operators or site supervisors operating under harsh, direct tropical sunlight, and depot fleet dispatchers managing dense tabular telemetry, machinery billings, and fuel logs indoors.

The aesthetic philosophy is **Rugged Industrial Precision**: tactile, structured, and uncompromisingly legible. Rather than fragile consumer minimalism, it leverages structural frames, deliberate physical borders reminiscent of heavy steel fabrication, and bold tactile feedback points. It instills an emotional sense of operational reliability, mechanical endurance, and commercial accountability.

## Colors
The color architecture prioritizes visual hierarchy and daylight readability through stark tonal separation, inspired by industrial machinery safety liveries.

- **Primary Amber Safety Yellow (`#F59E0B`, accented by `#D97706` for deep strokes and `#B45309` for active states)**: Used for primary calls-to-action, active shift badges, telemetry highlights, and critical focal points.
- **Secondary Deep Machinery Slate (`#0F172A`, supporting `#1E293B` and `#334155`)**: Anchors global navigation headers, high-level summary cards, and dark operational toolbars.
- **Surface & Backgrounds**: Grounded in crisp, anti-glare foundations (`#F8FAFC` base page, `#FFFFFF` elevated cards, `#F1F5F9` input troughs) to ensure zero optical bleed when exposed to high-ambient outdoor brightness.
- **Operational Status Indicators**:
  - **Operational Active (`#10B981`)**: Machine engaged, run-shift approved, valid verification.
  - **Warning Pending (`#F59E0B`)**: Maintenance due within 20 hrs, photo odometer log unverified.
  - **Audit Flag Crimson (`#EF4444`)**: Fuel mismatch, meter reverse anomaly, critical breakdown.
  - **Idle Neutral (`#64748B`)**: Staged in yard, transit without engine hours.

## Typography
Typography is split purposefully between structural communication and machine telemetry.

- **Primary Interface (Inter)**: Handles layout navigation, headings, metadata, and site operational instructions. Tight tracking and robust font weights (600, 700, 800) prevent character degradation on low-tier mobile panels in sunlight.
- **Telemetry & Financial Data (JetBrains Mono)**: Hour meter logs, GPS coordinates, fuel liters, engine run-time totals, and Indian Rupee (₹) amounts strictly utilize monospaced, tabular numbers to facilitate scanning across log sheets and ledger comparisons.
- **Micro-Labels (`label-caps`)**: Always uppercase with widened letter spacing to replicate equipment control panel stampings.

## Layout & Spacing
The layout relies on a strict, compact fluid grid designed for density without visual congestion.

- **Mobile Viewport (<768px)**: 4-column layout with 16px margins and 16px gutters. Form fields, hour meter readouts, and operational punch-in actions span full-width with a minimum touch height of 48px to accommodate gloved or dust-covered fingers.
- **Tablet / In-Cab Dashboard (768px - 1024px)**: 8-column layout. Permits split-screen workflows: machine shift log entry alongside photo verification previews.
- **Fleet Manager Desktop (>1024px)**: 12-column layout capped at 1600px width. Features high-density data tables, persistent telemetry sidebars, and rapid ledger-reconciliation multi-panes.
- **Rhythm**: All paddings adhere strictly to a 4px/8px modular base, ensuring data cells and machine cards remain tightly bound and vertically consistent.

## Elevation & Depth
In high-glare outdoor job environments, faint diffuse drop shadows vanish completely. Therefore, the elevation system employs **Tactile Structural Layering**: a fusion of solid 1px to 2px structural containment borders with dark offset block depth.

- **Level 0 (Canvas Base)**: `#F8FAFC`, flat, foundational.
- **Level 1 (Card & Module Layer)**: `#FFFFFF` surface backed by a solid `1px solid #CBD5E1` containment border, resting with a crisp `0 1px 3px rgba(15, 23, 42, 0.08)` grounding shadow.
- **Level 2 (Interactive Floating / Staged Controls)**: `#FFFFFF` with a `1.5px solid #0F172A` perimeter and an industrial offset shadow `2px 2px 0px #0F172A`.
- **Level 3 (Modal Dialogs & Emergency Overrides)**: Raised over an opaque `#0F172A` scrim (80% opacity), enclosed in a thick `2px solid #F59E0B` warning rim with high-contrast shadow `0 20px 25px -5px rgba(15, 23, 42, 0.3)`.

## Shapes
Shapes avoid excessive roundness to convey the durability of cast iron and sheet steel. Radii are set to `Soft (1)`:
- Standard structural elements (cards, input frames, toolbars) use `0.25rem` (4px).
- Badges, status pills, and tactical control segments use `0.5rem` (8px).
- Pill shapes are strictly prohibited except for machine running status beacons, maintaining a rugged, engineered posture across the entire platform.

## Components

### 1. Buttons
- **Primary Industrial Button**: Background `#F59E0B`, text `#0F172A`, font weight 700. Border: `1.5px solid #D97706`. Bottom edge enhanced with a solid `2px solid #B45309` lip to give physical push-button depression feedback on click/tap (`active: translate-y-0.5`).
- **Secondary Fleet Button**: Dark Slate `#0F172A`, text `#FFFFFF`. Hover: `#1E293B`.
- **Destructive / Audit Override**: Alert Crimson `#EF4444`, text `#FFFFFF`, border `#DC2626`.

### 2. High-Touch Hour Meter Counter
- Designed for entering and reading telematics/analog hour meters (SMU: Service Meter Units).
- Display box uses a dark inset recessed background (`#0F172A`) with high-contrast amber (`#F59E0B`) monospaced numerals (`label-numeric-lg`).
- Decimal sub-hour indicator rendered with inverted black-on-white badge styling mimicking mechanical rolling tumblers.

### 3. Machine Status Pills
- High-visibility chips with an integrated pulsing mechanical diode dot.
- Active (`#ECFDF5` background, `#065F46` label, `#10B981` border).
- Under Maintenance (`#FEF3C7` background, `#92400E` label, `#F59E0B` border).
- Flagged / Discrepancy (`#FEF2F2` background, `#991B1B` label, `#EF4444` border).

### 4. Photo Proof Comparison Card
- Dedicated to double-verifying physical site odometer captures against driver punch-in entries.
- Dual-image comparative pane (Shift Start vs. Shift End) with an integrated timestamp watermark overlay and differential calculation badge (e.g., `+8.5 hrs Total Runtime`).

### 5. Input Fields
- Enclosed with a solid `1.5px solid #CBD5E1` boundary on a `#FFFFFF` field.
- Active focus transitions to a bold `2px solid #0F172A` accompanied by an ambient `#F59E0B` glow outline.
- Labels stay top-pinned in bold uppercase `label-caps` for fast verification without floating animation lag.

### 6. Invoice & Billing Summary Chips
- Displays line items for client billing (e.g., `Batta / Driver Allowance`, `Rock Breaker Wet-Rate`, `HSD Diesel Deduction`).
- Uses dark slate containers with JetBrains Mono numbers, explicitly distinguishing between debits and credits via colored prefix tags.