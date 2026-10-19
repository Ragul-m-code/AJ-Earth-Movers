---
name: Heavy Industrial Precision
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
  on-surface-variant: '#4f4632'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#827660'
  outline-variant: '#d4c5ac'
  surface-tint: '#795900'
  primary: '#795900'
  on-primary: '#ffffff'
  primary-container: '#f5b800'
  on-primary-container: '#664b00'
  inverse-primary: '#fabd0d'
  secondary: '#5b5e67'
  on-secondary: '#ffffff'
  secondary-container: '#dfe2ec'
  on-secondary-container: '#61646d'
  tertiary: '#565e74'
  on-tertiary: '#ffffff'
  tertiary-container: '#bac1db'
  on-tertiary-container: '#474f65'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdf9f'
  primary-fixed-dim: '#fabd0d'
  on-primary-fixed: '#261a00'
  on-primary-fixed-variant: '#5b4300'
  secondary-fixed: '#dfe2ec'
  secondary-fixed-dim: '#c3c6d0'
  on-secondary-fixed: '#181c23'
  on-secondary-fixed-variant: '#43474f'
  tertiary-fixed: '#dae2fd'
  tertiary-fixed-dim: '#bec6e0'
  on-tertiary-fixed: '#131b2e'
  on-tertiary-fixed-variant: '#3f465c'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '800'
    lineHeight: 40px
    letterSpacing: -0.03em
  display-sm:
    fontFamily: Inter
    fontSize: 26px
    fontWeight: '800'
    lineHeight: 34px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 22px
    fontWeight: '700'
    lineHeight: 28px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 19px
    fontWeight: '700'
    lineHeight: 26px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Inter
    fontSize: 17px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '500'
    lineHeight: 24px
    letterSpacing: -0.005em
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: 0em
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0em
  label-lg:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 18px
    letterSpacing: 0.01em
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '700'
    lineHeight: 14px
    letterSpacing: 0.04em
  metric-num:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: '800'
    lineHeight: 32px
    letterSpacing: -0.03em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-sm: 0.75rem
  margin: 1rem
  margin-sm: 0.75rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.875rem
  space-lg: 1.25rem
  space-xl: 1.75rem
---

## Brand & Style

This design system is engineered for field-ready operational authority, high clarity, and rugged reliability. Tailored for earthmoving fleet logistics, site oversight, and equipment management, the interface prioritizes immediate legibility under harsh glare, direct sunlight, and demanding on-site mobile environments.

The visual style blends **Modern Industrial Utility** with **Tactile Functionalism**:
- **Aesthetic Tone:** Utilitarian, muscular, highly structured, and confident. Heavy machines demand interfaces that communicate stability, instant status recognition, and physical-grade durability.
- **Visual Weight:** Thick structural dividers, assertive high-contrast accents, and unapologetic typographic scale that treats operational data like precision instrumentation.
- **Ergonomics:** Oversized touch targets (minimum 44×44px, defaulting to 48px), strong perimeter borders to withstand ambient outdoor light glare, and deliberate spatial partitioning to eliminate tap errors in vibrating vehicle cabs or while wearing safety workwear.

## Colors

The palette leverages industrial equipment coding: safety yellow signals active agency and critical touchpoints, deep charcoal grounds structural surfaces and ensures extreme contrast ratios, while high-clarity status tokens provide unambiguous diagnostic feedback.

### Core Canvas & Surfaces
- **Canvas Base:** `#F8FAFC` (Slate 50) delivers an anti-fatigue, non-reflective ground.
- **Card & Sheet Surface:** `#FFFFFF` (Pure White) provides crisp elevated layers.
- **Structural Framing Border:** `#E2E8F0` (Slate 200) defines module containers with precision.
- **Subtle Surface Tint:** `#F1F5F9` (Slate 100) for recessed field inputs, disabled plates, and nested lists.

### Brand & Structure
- **Primary Industrial Yellow:** `#F5B800` (Safety Ochre) reserved for active highlights, progress indicators, critical primary actions, and selected states. Never use light text on this yellow; pair strictly with `#20242B` or `#000000`.
- **Deep Charcoal Accent:** `#20242B` delivers commanding structure, primary button fills, headers, and active bottom navigation anchors.
- **Midnight Steel Accent:** `#0F172A` for key displays, primary labels, and dense statistical figures.
- **Muted Slate Neutral:** `#64748B` for secondary labels, metadata, inactive icons, and auxiliary guidelines.

### Diagnostic & Operational Status
- **Success (Active Fleet/Pass):** `#10B981` (Emerald) paired with `#ECFDF5` background.
- **Warning (Maintenance/Idle):** `#F59E0B` (Amber) paired with `#FFFBEB` background.
- **Danger (Breakdown/Critical Alert):** `#EF4444` (Red) paired with `#FEF2F2` background.
- **Info (Scheduled/Dispatched):** `#3B82F6` (Electric Blue) paired with `#EFF6FF` background.

## Typography

The type system is built on **Inter**, optimized for industrial tabular telemetry, mobile glanceability, and high-density status reports. 

- **Numerical Hierarchy:** Equipment hours, engine load, telemetry metrics, and tonnage readouts utilize `metric-num` with tabular numeric lining enabled (`font-variant-numeric: tabular-nums`) to prevent shifting layout jitter during live telemetry polling.
- **Weight Strategy:** Heavy weights (`700`, `800`) are applied aggressively to headlines and equipment codes (e.g., `CAT 320D`, `JCB 3DX`) to ensure immediate recognition in fast-paced operational workflows.
- **Labels & Badges:** `label-sm` applies uppercase styling with subtle tracking (`+0.04em`) to mirror physical stamped equipment metal plates and warning decals.

## Layout & Spacing

The layout is engineered around a compact, single-thumb-accessible mobile canvas with strict 4px/8px incremental rhythm.

- **Grid Architecture:** 4-column fluid mobile grid with `1rem` outer canvas padding and `0.75rem` to `1rem` column gutters. Cards and operational blocks stretch cleanly across full column spans or split evenly across 2-column paired telemetry cards.
- **Thumb Zone Anchoring:** Actionable controls, triage filters, and multi-unit status pickers are concentrated in the lower 60% of the viewport. Top areas remain reserved for passive metrics, identity bars, and search inputs.
- **Stacking Density:** Vertical spacing adheres tightly to `space-sm` (8px) between related label-value groups, `space-md` (14px) internal card padding, and `space-lg` (20px) separating isolated module sections.

## Elevation & Depth

This design system avoids delicate blurred shadows in favor of **Tonal Layering combined with Low-Contrast Crisp Borders** to ensure daylight visibility.

- **Level 0 (Canvas Base):** Flat `#F8FAFC`, non-elevated ground surface.
- **Level 1 (Card & Section Containers):** `#FFFFFF` fill bounded by a solid `1px` border of `#E2E8F0`. Depth is conveyed through clean structural boundaries rather than fuzzy shadows.
- **Level 2 (Dropdowns, Floating Filters & Drawers):** `#FFFFFF` fill with `1px` border of `#CBD5E1` accompanied by a controlled, directional industrial contact drop: `0px 4px 12px rgba(32, 36, 43, 0.08)`.
- **Level 3 (Bottom Navigation & Modals):** `#20242B` or `#FFFFFF` bounded by a top/perimeter border of `1px solid #E2E8F0` or `#333A44`, cast with `0px -4px 16px rgba(0, 0, 0, 0.06)`.
- **Active State Depths:** Pressed buttons visually depress using a `1px` inset translation or a high-contrast inverted border ring rather than skeuomorphic beveling.

## Shapes

The interface embraces a **Soft/Industrial Geometric** shape standard (`roundedness: 1`). Radii are kept compact (`4px` to `8px`) to evoke the machined, beveled edges of fabricated steel and heavy-gauge machinery chassis.

- **Base Radius (4px / 0.25rem):** Used for micro-badges, tabular chips, checkboxes, small text inputs, and segment toggles.
- **Medium Radius (8px / 0.5rem):** Standard for cards, equipment record tiles, bottom sheets, alert toasts, and primary touch action buttons.
- **Large Radius (12px / 0.75rem):** Reserved exclusively for modal surfaces, dialog bottom sheets, and full-screen camera scanning viewports.
- **Pill Shape (Full Round):** Strictly limited to operational status tags (e.g., `RUNNING`, `MAINTENANCE`) and unread counter badges to maximize distinct visual categorization against rectilinear structural cards.

## Components

### Buttons
- **Primary Industrial Button:** Background `#20242B`, text `#FFFFFF`, height `48px`, border-radius `8px`, font `label-lg`. Active state triggers an industrial yellow left-border accent bar or a slight scale press (`0.98`).
- **Primary Yellow CTA (Direct Action):** Background `#F5B800`, text `#20242B` (heavy weight `700`), height `48px`, border-radius `8px`. Used for high-priority single actions (e.g., "Assign Fleet", "Authorize Fuel").
- **Secondary / Outline:** Background `#FFFFFF`, border `1.5px solid #20242B`, text `#20242B`, height `48px`, border-radius `8px`.
- **Ghost / Utility:** Transparent fill, text `#64748B`, height `44px`, padded with `12px` horizontal spacing.

### Bottom Navigation Bar
- **Dimensions & Visual Frame:** Fixed height `60px` (excluding OS home indicator), background `#FFFFFF`, bordered along top edge with `1px solid #E2E8F0`.
- **Active Navigation State:** Active item icon and label use `#20242B` reinforced by a bold `3px` tall `#F5B800` accent pill positioned right beneath or atop the active tab target.
- **Inactive Navigation State:** Icon and label in `#64748B`, switching immediately upon tap without sluggish fade transitions.
- **Touch Target:** Minimum `56px` vertical height by flexible equal width, ensuring zero mis-taps.

### Status Badges & Chips
- **Diagnostic Badges:** Pill-shaped, height `24px`, padding `0 10px`, font `label-sm`.
  - *Active/Operating:* Background `#ECFDF5`, text `#065F46`, left-dot `#10B981`.
  - *Warning/Standby:* Background `#FFFBEB`, text `#92400E`, left-dot `#F59E0B`.
  - *Breakdown/Down:* Background `#FEF2F2`, text `#991B1B`, left-dot `#EF4444`.
  - *Scheduled/Depot:* Background `#EFF6FF`, text `#1E40AF`, left-dot `#3B82F6`.
- **Filter Chips:** Height `36px`, rounded `4px`, background `#FFFFFF`, border `1px solid #CBD5E1`. Selected state swaps background to `#20242B` with `#FFFFFF` text.

### Cards & Telemetry Tiles
- **Structure:** Background `#FFFFFF`, border `1px solid #E2E8F0`, corner radius `8px`, internal padding `14px`.
- **Heavy Machinery Card:** Features a thick left color bar (`4px` wide) keyed to asset operational health (Emerald, Amber, or Red), bold equipment title (`CAT 320D - Site Alpha`), running hours in tabular numbers, and a direct quick-action chevron button (`44×44px`).

### Form Inputs & Checkboxes
- **Input Fields:** Height `48px`, background `#FFFFFF`, border `1.5px solid #CBD5E1`, text `#0F172A`, placeholder `#94A3B8`, border-radius `6px`. Focus state triggers a `2px solid #20242B` ring with no soft glow.
- **Checkboxes & Radios:** Dimensions `22×22px` (surrounded by an invisible `44×44px` hit box), border `2px solid #64748B`, border-radius `4px` for checkboxes and circular for radios. Checked state fills with `#20242B` holding a pure white checkmark or inner dot.

### Specialized Machinery Components
- **Telemetry Gauge Tile:** Micro dashboard widget showing RPM/Fuel/Temperature with high-contrast horizontal bars (fill: `#F5B800`, track: `#E2E8F0`).
- **Hour Meter Counter:** Compact skeuomorphic digital tape style with black tabular mono numbers over `#F1F5F9` background tiles.