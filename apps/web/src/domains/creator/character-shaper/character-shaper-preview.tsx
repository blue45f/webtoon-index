/**
 * Character Shaper — deterministic SVG previews for every slot card.
 *
 * One inline `<svg viewBox="0 0 80 100">` per `CharacterSlotPreviewSpec` kind. Line work uses
 * `currentColor`, surfaces use the warm-ink tokens (`var(--color-*)`), and only the spec's own
 * colours (hair, garment, prop, iris) appear as literal fills. No randomness, no dates, no
 * external assets — the same spec always yields the same markup, so cards, the inspector and the
 * tests all agree on what a preset looks like.
 *
 * Every drawing keeps its subject inside y 10..90 of the 4:5 frame, so a square chip that crops
 * the frame vertically (the shelf strips) still shows the whole subject.
 */
import { useId } from "react";

import { characterHandGlyphLayout } from "./character-shaper-hand-glyph";
import { characterPoseGlyphJoints, resolveCharacterPoseGlyphDetail } from "./character-shaper-pose-glyph";

import type {
  CharacterEarGlyph,
  CharacterEyeLidStyle,
  CharacterGarmentGlyph,
  CharacterHandPoseType,
  CharacterIrisHighlight,
  CharacterNoseGlyph,
  CharacterPupilStyle,
  CharacterSlotPreviewSpec,
} from "./character-shaper-contract";
import type { AvatarForgeBangStyle, AvatarForgeFaceParams, AvatarForgeHairStyle } from "../vrm/studio-vrm-avatar-forge";
import type { ReactNode } from "react";

import { cn } from "@/shared/lib/utils";

export interface CharacterSlotPreviewProps {
  readonly spec: CharacterSlotPreviewSpec;
  /** Rendered width in CSS px; the height follows the 4:5 frame. CSS sizing (`h-full w-full`) wins. */
  readonly size?: number;
  readonly selected?: boolean;
  readonly className?: string;
  /** Accessible name; defaults to a Korean label derived from the spec kind. */
  readonly title?: string;
}

/* -------------------------------------------------------------------------- */
/* Palette (tokens only) and numeric helpers                                   */
/* -------------------------------------------------------------------------- */

const INK = "currentColor";
const PAPER = "var(--color-panel)";
const CANVAS = "var(--color-canvas)";
const RAISED = "var(--color-raised)";
const LINE = "var(--color-line)";
const LINE_STRONG = "var(--color-line-strong)";
const MUTED = "var(--color-fg-3)";
const SOFT_TEXT = "var(--color-fg-2)";
const ACCENT = "var(--color-accent)";
const ACCENT_SOFT = "var(--color-accent-soft)";

function clamp(value: number, min: number, max: number): number {
  const safe = Number.isFinite(value) ? value : 0;
  return Math.min(max, Math.max(min, safe));
}

/** Two-decimal path number without "-0". */
function n(value: number): string {
  const rounded = Math.round(clamp(value, -9999, 9999) * 100) / 100;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function mirrorX(path: string): string {
  // Reflect an absolute-command path (M/L/C/Q/Z with x y pairs) around x = 40.
  return path.replace(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g, (_match, x: string, y: string) => `${n(80 - Number(x))} ${y}`);
}

/* -------------------------------------------------------------------------- */
/* Spec colour helpers — outputs are derived from catalog data, never chrome   */
/* -------------------------------------------------------------------------- */

type Rgb = readonly [number, number, number];

/** Mixing targets for spec colours (pure math, not UI chrome). */
const MIX_LIGHT: Rgb = [255, 255, 255];
const MIX_DARK: Rgb = [0, 0, 0];

function parseHex(color: string): Rgb | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return null;
  const hex = match[1];
  const full = hex.length === 3 ? hex.split("").map((part) => part + part).join("") : hex;
  const value = Number.parseInt(full, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function toHex(rgb: Rgb): string {
  return `#${rgb.map((channel) => Math.round(clamp(channel, 0, 255)).toString(16).padStart(2, "0")).join("")}`;
}

function mixColor(color: string, target: Rgb, amount: number, fallback: string): string {
  const rgb = parseHex(color);
  if (!rgb) return fallback;
  const t = clamp(amount, 0, 1);
  return toHex([rgb[0] + (target[0] - rgb[0]) * t, rgb[1] + (target[1] - rgb[1]) * t, rgb[2] + (target[2] - rgb[2]) * t]);
}

function lighten(color: string, amount: number): string {
  return mixColor(color, MIX_LIGHT, amount, PAPER);
}

function darken(color: string, amount: number): string {
  return mixColor(color, MIX_DARK, amount, MUTED);
}

/** Literal colour if it parses, otherwise a token so a malformed spec never breaks the card. */
function safeColor(color: string, fallback = MUTED): string {
  return parseHex(color) ? color : fallback;
}

/* -------------------------------------------------------------------------- */
/* Shared face primitives                                                      */
/* -------------------------------------------------------------------------- */

/** Head outline whose width/height/cheek/chin follow the Avatar Forge face params. */
function headPath(cx: number, cy: number, w: number, h: number, cheek: number, chin: number): string {
  const top = cy - h;
  const chinY = cy + h * (0.3 + 0.6 * chin);
  const chinW = w * clamp(0.5 - (chin - 1) * 1.1, 0.3, 0.72);
  const jawW = w * (0.92 + (cheek - 0.35) * 0.4);
  return [
    `M${n(cx)} ${n(top)}`,
    `C${n(cx + w * 0.56)} ${n(top)} ${n(cx + w)} ${n(cy - h * 0.55)} ${n(cx + w)} ${n(cy - h * 0.08)}`,
    `C${n(cx + jawW)} ${n(cy + h * 0.5)} ${n(cx + chinW)} ${n(chinY)} ${n(cx)} ${n(chinY)}`,
    `C${n(cx - chinW)} ${n(chinY)} ${n(cx - jawW)} ${n(cy + h * 0.5)} ${n(cx - w)} ${n(cy - h * 0.08)}`,
    `C${n(cx - w)} ${n(cy - h * 0.55)} ${n(cx - w * 0.56)} ${n(top)} ${n(cx)} ${n(top)}`,
    "Z",
  ].join(" ");
}

function faceFeatures(cx: number, eyeY: number, eyeGap: number, scale = 1): ReactNode {
  return (
    <g fill={INK} stroke={INK} strokeLinecap="round">
      <path d={`M${n(cx - eyeGap - 4 * scale)} ${n(eyeY - 5.5 * scale)} q${n(4 * scale)} -2.6 ${n(8 * scale)} 0`} fill="none" strokeWidth={1.3} />
      <path d={`M${n(cx + eyeGap - 4 * scale)} ${n(eyeY - 5.5 * scale)} q${n(4 * scale)} -2.6 ${n(8 * scale)} 0`} fill="none" strokeWidth={1.3} />
      <ellipse cx={cx - eyeGap} cy={eyeY} rx={2.1 * scale} ry={2.7 * scale} stroke="none" />
      <ellipse cx={cx + eyeGap} cy={eyeY} rx={2.1 * scale} ry={2.7 * scale} stroke="none" />
      <path d={`M${n(cx - 1.2)} ${n(eyeY + 6 * scale)} q1.2 1.8 2.4 0`} fill="none" strokeWidth={1} opacity={0.7} />
      <path d={`M${n(cx - 3.5)} ${n(eyeY + 11 * scale)} q3.5 2.4 7 0`} fill="none" strokeWidth={1.3} />
    </g>
  );
}

function shoulders(opacity = 0.8): ReactNode {
  return (
    <path
      d="M10 100 C12 84 26 76 40 76 C54 76 68 84 70 100 Z"
      fill={RAISED}
      opacity={opacity}
      stroke={INK}
      strokeOpacity={0.35}
      strokeWidth={1}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* face-shape                                                                  */
/* -------------------------------------------------------------------------- */

function FaceShapeArt({ face, selected }: { readonly face: AvatarForgeFaceParams; readonly selected: boolean }) {
  const cx = 40;
  const cy = 49;
  const w = 20 * clamp(face.headWidth, 0.8, 1.2);
  const h = 24 * clamp(face.headHeight, 0.8, 1.2);
  const cheek = clamp(face.cheekVolume, 0, 1);
  const chin = clamp(face.chinLength, 0.8, 1.2);
  return (
    <>
      <path d={headPath(cx, cy, 20, 24, 0.35, 1)} fill="none" stroke={LINE_STRONG} strokeDasharray="2 2.4" strokeWidth={1} />
      <path
        d={headPath(cx, cy, w, h, cheek, chin)}
        fill={RAISED}
        stroke={selected ? ACCENT : INK}
        strokeLinejoin="round"
        strokeWidth={1.6}
      />
      {faceFeatures(cx, cy - h * 0.02, w * 0.42, 0.95 + (h / 24 - 1) * 0.5)}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* eyes                                                                        */
/* -------------------------------------------------------------------------- */

interface EyeShape {
  readonly upper: string;
  readonly outline: string;
  readonly lash: number;
}

/** Local eye shape; +x is the outer corner. */
function eyeShape(lid: CharacterEyeLidStyle, hw: number, eh: number): EyeShape {
  switch (lid) {
    case "cat": {
      const upper = `M${n(-hw)} ${n(eh * 0.15)} Q${n(-hw * 0.1)} ${n(-eh * 1.1)} ${n(hw)} ${n(-eh * 0.55)}`;
      return { upper, outline: `${upper} Q${n(hw * 0.35)} ${n(eh * 0.55)} ${n(-hw)} ${n(eh * 0.15)} Z`, lash: 1.7 };
    }
    case "droopy": {
      const upper = `M${n(-hw)} ${n(-eh * 0.25)} Q${n(-hw * 0.25)} ${n(-eh * 1.15)} ${n(hw * 0.95)} ${n(eh * 0.45)}`;
      return { upper, outline: `${upper} Q${n(hw * 0.2)} ${n(eh * 0.85)} ${n(-hw)} ${n(-eh * 0.25)} Z`, lash: 1.5 };
    }
    case "sharp": {
      const upper = `M${n(-hw)} ${n(eh * 0.1)} Q${n(-hw * 0.1)} ${n(-eh * 0.85)} ${n(hw)} ${n(-eh * 0.25)}`;
      return { upper, outline: `${upper} Q${n(hw * 0.3)} ${n(eh * 0.45)} ${n(-hw)} ${n(eh * 0.1)} Z`, lash: 2.1 };
    }
    case "half-moon": {
      const upper = `M${n(-hw)} ${n(eh * 0.3)} Q0 ${n(-eh * 1.1)} ${n(hw)} ${n(eh * 0.3)}`;
      return { upper, outline: `${upper} Q0 ${n(-eh * 0.05)} ${n(-hw)} ${n(eh * 0.3)} Z`, lash: 1.9 };
    }
    case "round":
    default: {
      const upper = `M${n(-hw)} 0 Q0 ${n(-eh * 1.15)} ${n(hw)} 0`;
      return { upper, outline: `${upper} Q0 ${n(eh * 0.8)} ${n(-hw)} 0 Z`, lash: 1.5 };
    }
  }
}

function EyesArt({
  size,
  spacing,
  tilt,
  lid,
  selected,
  idBase,
}: {
  readonly size: number;
  readonly spacing: number;
  readonly tilt: number;
  readonly lid: CharacterEyeLidStyle;
  readonly selected: boolean;
  readonly idBase: string;
}) {
  const cx = 40;
  const eyeY = 50;
  const sizeDelta = clamp(size, -1, 1);
  const hw = 5.75 * (1 + 0.35 * sizeDelta);
  const eh = 3.4 * (1 + 0.5 * sizeDelta);
  const gap = 12.5 + 5 * clamp(spacing, -1, 1);
  const angle = clamp(tilt, -1, 1) * 14;
  const shape = eyeShape(lid, hw, eh);
  const irisR = eh * 0.62;
  const lashColor = selected ? ACCENT : INK;
  const renderEye = (side: -1 | 1) => {
    const clipId = `${idBase}-eye${side === 1 ? "r" : "l"}`;
    // Right eye (viewer's right): outer corner is +x; rotate(-angle) lifts it. Left eye mirrors.
    const transform = side === 1
      ? `translate(${n(cx + gap)} ${eyeY}) rotate(${n(-angle)})`
      : `translate(${n(cx - gap)} ${eyeY}) rotate(${n(angle)}) scale(-1 1)`;
    return (
      <g key={side} transform={transform}>
        <clipPath id={clipId}>
          <path d={shape.outline} />
        </clipPath>
        <path d={`M${n(-hw * 1.05)} ${n(-eh * 2.1)} Q0 ${n(-eh * 2.75)} ${n(hw * 1.1)} ${n(-eh * 1.95)}`} fill="none" stroke={INK} strokeLinecap="round" strokeWidth={1.7} />
        <path d={shape.outline} fill={lid === "half-moon" ? INK : CANVAS} fillOpacity={lid === "half-moon" ? 0.85 : 1} stroke={INK} strokeOpacity={0.65} strokeWidth={0.8} />
        {lid === "half-moon" ? null : (
          <g clipPath={`url(#${clipId})`}>
            <circle cx={hw * 0.05} cy={0} r={irisR} fill={INK} fillOpacity={0.82} />
            <circle cx={hw * 0.05} cy={0} r={irisR * 0.45} fill={INK} />
            <circle cx={hw * 0.05 - irisR * 0.38} cy={-irisR * 0.38} r={irisR * 0.26} fill={PAPER} />
          </g>
        )}
        <path d={shape.upper} fill="none" stroke={lashColor} strokeLinecap="round" strokeWidth={shape.lash} />
      </g>
    );
  };
  return (
    <>
      <path d={headPath(cx, 52, 24, 28, 0.35, 1)} fill={RAISED} stroke={INK} strokeOpacity={0.5} strokeWidth={1.2} />
      {renderEye(-1)}
      {renderEye(1)}
      <path d="M38.8 59.5 q1.2 1.8 2.4 0" fill="none" opacity={0.6} stroke={INK} strokeLinecap="round" strokeWidth={1} />
      <path d="M36.5 67.5 q3.5 2.2 7 0" fill="none" stroke={INK} strokeLinecap="round" strokeWidth={1.2} />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* irises                                                                      */
/* -------------------------------------------------------------------------- */

function starPath(cx: number, cy: number, r: number): string {
  const inner = r * 0.36;
  return [
    `M${n(cx)} ${n(cy - r)}`,
    `L${n(cx + inner)} ${n(cy - inner)}`,
    `L${n(cx + r)} ${n(cy)}`,
    `L${n(cx + inner)} ${n(cy + inner)}`,
    `L${n(cx)} ${n(cy + r)}`,
    `L${n(cx - inner)} ${n(cy + inner)}`,
    `L${n(cx - r)} ${n(cy)}`,
    `L${n(cx - inner)} ${n(cy - inner)}`,
    "Z",
  ].join(" ");
}

function IrisesArt({
  irisSize,
  color,
  highlight,
  pupil,
  selected,
  idBase,
}: {
  readonly irisSize: number;
  readonly color: string;
  readonly highlight: CharacterIrisHighlight;
  readonly pupil: CharacterPupilStyle;
  readonly selected: boolean;
  readonly idBase: string;
}) {
  const cx = 40;
  const cy = 51;
  const eh = 16;
  const delta = clamp(irisSize, -1, 1);
  const r = 11.5 * (1 + 0.45 * delta);
  const base = safeColor(color);
  const ring = darken(color, 0.55);
  const core = lighten(color, 0.16);
  const pupilColor = darken(color, 0.78);
  const glint = lighten(color, 0.9);
  const clipId = `${idBase}-iris`;
  const upper = `M13 ${cy} Q${cx} ${n(cy - eh * 1.2)} 67 ${cy}`;
  const outline = `${upper} Q${cx} ${n(cy + eh * 0.85)} 13 ${cy} Z`;
  return (
    <>
      <clipPath id={clipId}>
        <path d={outline} />
      </clipPath>
      <path d="M17 28 Q40 18 63 28" fill="none" stroke={INK} strokeLinecap="round" strokeWidth={2} />
      <path d={outline} fill={CANVAS} stroke={INK} strokeOpacity={0.6} strokeWidth={0.9} />
      {Math.abs(delta) > 0.02 ? (
        <circle cx={cx} cy={cy} r={11.5} fill="none" stroke={LINE_STRONG} strokeDasharray="2 2.2" strokeWidth={1} />
      ) : null}
      <g clipPath={`url(#${clipId})`}>
        <circle cx={cx} cy={cy} r={r} fill={base} stroke={ring} strokeWidth={1.3} />
        <circle cx={cx} cy={cy} r={r * 0.68} fill={core} fillOpacity={0.85} />
        {pupil === "vertical" ? (
          <ellipse cx={cx} cy={cy} rx={r * 0.17} ry={r * 0.68} fill={pupilColor} />
        ) : (
          <circle cx={cx} cy={cy} r={r * 0.42} fill={pupilColor} />
        )}
        {highlight === "basic" ? (
          <>
            <circle cx={cx - r * 0.38} cy={cy - r * 0.38} r={r * 0.28} fill={glint} />
            <circle cx={cx + r * 0.32} cy={cy + r * 0.36} r={r * 0.12} fill={glint} fillOpacity={0.9} />
          </>
        ) : null}
        {highlight === "star" ? (
          <>
            <path d={starPath(cx - r * 0.34, cy - r * 0.34, r * 0.4)} fill={glint} />
            <circle cx={cx + r * 0.36} cy={cy + r * 0.34} r={r * 0.12} fill={glint} fillOpacity={0.9} />
          </>
        ) : null}
        {highlight === "soft" ? (
          <>
            <circle cx={cx - r * 0.36} cy={cy - r * 0.34} r={r * 0.32} fill={glint} fillOpacity={0.55} />
            <circle cx={cx + r * 0.3} cy={cy + r * 0.38} r={r * 0.2} fill={glint} fillOpacity={0.4} />
          </>
        ) : null}
      </g>
      <path d={upper} fill="none" stroke={selected ? ACCENT : INK} strokeLinecap="round" strokeWidth={2.4} />
      <path d={`M13 ${cy} Q${cx} ${n(cy + eh * 0.85)} 67 ${cy}`} fill="none" stroke={INK} strokeLinecap="round" strokeOpacity={0.6} strokeWidth={1} />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* nose                                                                       */
/* -------------------------------------------------------------------------- */

function NoseArt({
  height,
  width,
  glyph,
  selected,
}: {
  readonly height: number;
  readonly width: number;
  readonly glyph: CharacterNoseGlyph;
  readonly selected: boolean;
}) {
  const h = clamp(height, -1, 1);
  const w = clamp(width, -1, 1);
  const tipX = glyph === "dot" ? Math.max(31, 34 - 7 * (1 + 0.75 * h)) : 34 - 7 * (1 + 0.75 * h);
  const tipY = 52 + 1.5 * h;
  const alar = 2.6 * (1 + 0.7 * w);
  let bridge: string;
  switch (glyph) {
    case "bridge":
      bridge = `L${n(tipX)} ${n(tipY)} L${n(tipX + 1.5)} ${n(tipY + 3)} Q${n(tipX + 4)} ${n(tipY + 5)} 38 58`;
      break;
    case "button":
      bridge = `C${n(tipX + 2)} ${n(tipY - 7)} ${n(tipX - 3)} ${n(tipY - 3)} ${n(tipX - 1)} ${n(tipY + 1)} C${n(tipX + 1)} ${n(tipY + 5)} ${n(tipX + 5)} ${n(tipY + 5)} 38 58`;
      break;
    case "dot":
      bridge = `Q${n(tipX + 3)} ${n(tipY - 5)} ${n(tipX + 1)} ${n(tipY)} Q${n(tipX + 3)} ${n(tipY + 3)} 38 58`;
      break;
    case "line":
    default:
      bridge = `Q${n(tipX + 3)} ${n(tipY - 6)} ${n(tipX)} ${n(tipY)} Q${n(tipX + 2)} ${n(tipY + 4)} 38 58`;
      break;
  }
  const profile = [
    "M43 14 C41 22 40.5 32 40.5 40",
    bridge,
    "C42 60 42 64 38 66 C41 68 42 70 39 73 C44 76 48 78 50 86 L66 86 C74 70 78 42 68 24 C62 14 52 10 43 14 Z",
  ].join(" ");
  return (
    <>
      <path d={profile} fill={RAISED} stroke={INK} strokeLinejoin="round" strokeWidth={1.5} />
      <path d="M44 36.5 Q49 33.5 55 36.5" fill="none" stroke={INK} strokeLinecap="round" strokeWidth={1.6} />
      <path d="M45 44 Q49 40 53 44 Q49 46.5 45 44 Z" fill={INK} fillOpacity={0.85} />
      <ellipse cx={64} cy={50} fill={RAISED} rx={3.4} ry={5.5} stroke={INK} strokeOpacity={0.7} strokeWidth={1} />
      <path
        d={`M${n(tipX + 2.5)} ${n(tipY + 2)} q${n(alar * 1.4)} -1 ${n(alar * 1.6)} 2.8`}
        fill="none"
        stroke={selected ? ACCENT : INK}
        strokeLinecap="round"
        strokeOpacity={0.85}
        strokeWidth={1.1}
      />
      {glyph === "dot" ? <circle cx={tipX + 0.5} cy={tipY + 0.5} fill={selected ? ACCENT : INK} r={1.3} /> : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* mouth                                                                      */
/* -------------------------------------------------------------------------- */

function MouthArt({
  width,
  fullness,
  open,
  smile,
  selected,
}: {
  readonly width: number;
  readonly fullness: number;
  readonly open: number;
  readonly smile: number;
  readonly selected: boolean;
}) {
  const cx = 40;
  const cy = 62;
  const hw = 14.5 * (1 + 0.6 * clamp(width, -1, 1));
  const t = 3.3 * (1 + 0.9 * clamp(fullness, -1, 1));
  const lift = 10 * clamp(smile, 0, 1);
  const o = 13 * clamp(open, 0, 1);
  const isOpen = o > 0.4;
  const lx = cx - hw;
  const rx = cx + hw;
  const cornerY = cy - lift;
  const upperOuter = `M${n(lx)} ${n(cornerY)} Q${cx} ${n(cy - t - 0.6 + lift * 0.15)} ${n(rx)} ${n(cornerY)}`;
  const upperInner = isOpen
    ? `Q${cx} ${n(cy - 0.4 - o * 0.25)} ${n(lx)} ${n(cornerY)} Z`
    : `Q${cx} ${n(cy + 1.4)} ${n(lx)} ${n(cornerY)} Z`;
  const lowerOuter = `M${n(lx)} ${n(cornerY)} Q${cx} ${n(cy + t + 1.8 + o)} ${n(rx)} ${n(cornerY)}`;
  const lowerInner = isOpen
    ? `Q${cx} ${n(cy + 1.5 + o)} ${n(lx)} ${n(cornerY)} Z`
    : `Q${cx} ${n(cy + 1.4)} ${n(lx)} ${n(cornerY)} Z`;
  const opening = `M${n(lx)} ${n(cornerY)} Q${cx} ${n(cy - 0.4 - o * 0.25)} ${n(rx)} ${n(cornerY)} Q${cx} ${n(cy + 1.5 + o)} ${n(lx)} ${n(cornerY)} Z`;
  return (
    <>
      <path d="M2 -6 C4 42 18 86 40 90 C62 86 76 42 78 -6 Z" fill={RAISED} stroke={INK} strokeOpacity={0.45} strokeWidth={1.2} />
      <path d="M36 40 q4 5 8 0" fill="none" opacity={0.55} stroke={INK} strokeLinecap="round" strokeWidth={1.2} />
      {isOpen ? <path d={opening} fill={INK} fillOpacity={0.85} /> : null}
      <path d={`${upperOuter} ${upperInner}`} fill={INK} fillOpacity={0.3} />
      <path d={`${lowerOuter} ${lowerInner}`} fill={INK} fillOpacity={0.22} />
      {isOpen ? null : (
        <path d={`M${n(lx)} ${n(cornerY)} Q${cx} ${n(cy + 1.4)} ${n(rx)} ${n(cornerY)}`} fill="none" stroke={selected ? ACCENT : INK} strokeLinecap="round" strokeWidth={1.8} />
      )}
      <path d={upperOuter} fill="none" stroke={selected ? ACCENT : INK} strokeLinecap="round" strokeOpacity={0.9} strokeWidth={1.2} />
      <path d={lowerOuter} fill="none" stroke={INK} strokeLinecap="round" strokeOpacity={0.7} strokeWidth={1.1} />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* ears                                                                       */
/* -------------------------------------------------------------------------- */

function EarsArt({ size, glyph, selected }: { readonly size: number; readonly glyph: CharacterEarGlyph; readonly selected: boolean }) {
  const cx = 40;
  const cy = 52;
  const w = 19;
  const h = 23;
  const scale = 1 + 0.55 * clamp(size, -1, 1);
  const stroke = selected ? ACCENT : INK;
  return (
    <>
      {glyph === "animal" ? (
        <g fill={RAISED} stroke={stroke} strokeLinejoin="round" strokeWidth={1.4}>
          <path d="M26 41 L27 15 L41 31 Z" />
          <path d="M54 41 L53 15 L39 31 Z" />
          <path d="M29 36 L29.5 23 L37 31 Z" fill={INK} fillOpacity={0.3} stroke="none" />
          <path d="M51 36 L50.5 23 L43 31 Z" fill={INK} fillOpacity={0.3} stroke="none" />
        </g>
      ) : null}
      {glyph === "elf" ? (
        <g fill={RAISED} stroke={stroke} strokeLinejoin="round" strokeWidth={1.4}>
          <path d="M24 46 C16 42 10 36 6 30 C10 44 14 54 22 60 Z" />
          <path d="M56 46 C64 42 70 36 74 30 C70 44 66 54 58 60 Z" />
          <path d="M22 48 C16 44 12 38 10 34" fill="none" strokeOpacity={0.5} strokeWidth={0.9} />
          <path d="M58 48 C64 44 68 38 70 34" fill="none" strokeOpacity={0.5} strokeWidth={0.9} />
        </g>
      ) : null}
      {glyph === "human" ? (
        <g fill={RAISED} stroke={stroke} strokeWidth={1.4}>
          <ellipse cx={cx - w - 1.5} cy={cy + 2} rx={4 * scale} ry={7 * scale} />
          <ellipse cx={cx + w + 1.5} cy={cy + 2} rx={4 * scale} ry={7 * scale} />
          <path d={`M${n(cx - w - 2.5)} ${n(cy - 1)} q${n(-1.6 * scale)} 2 0 ${n(5 * scale)}`} fill="none" strokeOpacity={0.6} strokeWidth={0.9} />
          <path d={`M${n(cx + w + 2.5)} ${n(cy - 1)} q${n(1.6 * scale)} 2 0 ${n(5 * scale)}`} fill="none" strokeOpacity={0.6} strokeWidth={0.9} />
        </g>
      ) : null}
      <path d={headPath(cx, cy, w, h, 0.35, 1)} fill={RAISED} stroke={INK} strokeOpacity={0.75} strokeWidth={1.4} />
      {faceFeatures(cx, cy - 1, 8)}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* hair                                                                       */
/* -------------------------------------------------------------------------- */

const HAIR_CAP = "M19 50 C19 24 27 17 40 17 C53 17 61 24 61 50 Z";

function hairBackPaths(style: AvatarForgeHairStyle): readonly string[] {
  switch (style) {
    case "none":
      return [];
    case "short":
      return ["M17 54 C16 26 27 15 40 15 C53 15 64 26 63 54 Z"];
    case "pixie":
      return ["M20 50 C18 30 24 18 33 20 L36 14 L40 19 L45 13 L47 20 C56 19 62 30 60 50 Z"];
    case "bob":
      return ["M16 62 C14 30 26 14 40 14 C54 14 66 30 64 62 Q62 70 54 68 L26 68 Q18 70 16 62 Z"];
    case "wolf":
      return ["M17 52 C16 28 26 15 40 15 C54 15 64 28 63 52 L66 66 L60 62 L62 78 L55 70 L54 86 L48 74 L40 90 L32 74 L26 86 L25 70 L18 78 L20 62 L14 66 Z"];
    case "long":
      return ["M15 96 L15 44 C15 26 26 14 40 14 C54 14 65 26 65 44 L65 96 Z"];
    case "wavy":
      return ["M15 44 C15 26 26 14 40 14 C54 14 65 26 65 44 C69 54 61 62 66 72 C70 82 62 88 66 96 L14 96 C18 88 10 82 14 72 C19 62 11 54 15 44 Z"];
    case "hime":
      return ["M14 96 L14 40 C14 24 26 13 40 13 C54 13 66 24 66 40 L66 96 Z"];
    case "ponytail":
      return [HAIR_CAP, "M56 26 C70 22 76 40 70 58 C66 70 70 80 66 92 C58 80 56 66 60 54 C63 42 60 34 56 26 Z"];
    case "twintail":
      return [
        HAIR_CAP,
        "M22 40 C8 44 6 60 12 76 C14 84 10 90 12 96 C20 88 24 76 20 62 C18 52 22 46 22 40 Z",
        "M58 40 C72 44 74 60 68 76 C66 84 70 90 68 96 C60 88 56 76 60 62 C62 52 58 46 58 40 Z",
      ];
    case "half-up":
      return ["M16 96 L16 44 C16 26 26 15 40 15 C54 15 64 26 64 44 L64 96 Z"];
    case "bun":
      return [HAIR_CAP];
    case "braid":
    case "twin-braid":
      return [HAIR_CAP];
    default:
      return [HAIR_CAP];
  }
}

function hairBangPaths(style: AvatarForgeBangStyle): readonly string[] {
  switch (style) {
    case "none":
      return [];
    case "full":
      return ["M22 46 C22 30 30 21 40 21 C50 21 58 30 58 46 C54 38 50 36 47 40 L44 46 L41 38 L37 46 L34 39 C30 36 26 40 22 46 Z"];
    case "blunt":
      return ["M22 42 C22 30 30 21 40 21 C50 21 58 30 58 42 Z"];
    case "split": {
      const left = "M22 48 C22 30 30 21 40 21 L40 24 C32 28 27 38 27 50 Z";
      return [left, mirrorX(left)];
    }
    case "side-swept":
      return ["M22 50 C22 28 32 20 42 20 C52 20 58 28 58 46 C52 34 44 32 34 40 C30 44 26 48 22 50 Z"];
    case "curtain": {
      const left = "M22 56 C22 30 30 21 40 21 L38 25 C31 30 27 42 27 58 Z";
      return [left, mirrorX(left)];
    }
    default:
      return [];
  }
}

function braidPaths(x: number, direction: 1 | -1): ReactNode {
  return [0, 1, 2, 3, 4].map((index) => (
    <ellipse
      key={index}
      cx={x + direction * (index % 2 === 0 ? -1.4 : 1.4)}
      cy={52 + index * 9.5}
      rx={5 - index * 0.45}
      ry={6.6 - index * 0.35}
    />
  ));
}

function HairArt({
  style,
  bangStyle,
  baseColor,
  tipColor,
  length,
  volume,
  selected,
  idBase,
}: {
  readonly style: AvatarForgeHairStyle;
  readonly bangStyle: AvatarForgeBangStyle;
  readonly baseColor: string;
  readonly tipColor: string;
  readonly length: number;
  readonly volume: number;
  readonly selected: boolean;
  readonly idBase: string;
}) {
  const gradientId = `${idBase}-hair`;
  const base = safeColor(baseColor);
  const tip = safeColor(tipColor, base);
  const outline = darken(baseColor, 0.45);
  const sx = 1 + (clamp(volume, 0.6, 1.6) - 1) * 0.8;
  const sy = 1 + (clamp(length, 0.5, 1.8) - 1) * 0.9;
  const backTransform = `translate(40 17) scale(${n(sx)} ${n(sy)}) translate(-40 -17)`;
  const back = hairBackPaths(style);
  const bangs = hairBangPaths(bangStyle);
  const hairFill = `url(#${gradientId})`;
  return (
    <>
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={base} />
          <stop offset="0.45" stopColor={base} />
          <stop offset="1" stopColor={tip} />
        </linearGradient>
      </defs>
      {shoulders(0.7)}
      <g fill={hairFill} stroke={outline} strokeLinejoin="round" strokeWidth={1.2} transform={backTransform}>
        {back.map((d) => <path key={d} d={d} />)}
        {style === "bun" ? <circle cx={40} cy={12} r={8} /> : null}
        {style === "half-up" ? <circle cx={40} cy={13} r={6} /> : null}
        {style === "braid" ? braidPaths(59, 1) : null}
        {style === "twin-braid" ? (
          <>
            {braidPaths(21, -1)}
            {braidPaths(59, 1)}
          </>
        ) : null}
      </g>
      {style === "ponytail" ? <circle cx={58} cy={28} fill={outline} r={2.6} /> : null}
      {style === "twintail" ? (
        <g fill={outline}>
          <circle cx={22} cy={42} r={2.4} />
          <circle cx={58} cy={42} r={2.4} />
        </g>
      ) : null}
      <ellipse cx={40} cy={46} fill={RAISED} rx={18.5} ry={21.5} stroke={INK} strokeOpacity={0.55} strokeWidth={1.1} />
      <g fill={INK}>
        <ellipse cx={32.5} cy={50} rx={2} ry={2.6} />
        <ellipse cx={47.5} cy={50} rx={2} ry={2.6} />
      </g>
      <path d="M36.5 60 q3.5 2.4 7 0" fill="none" stroke={INK} strokeLinecap="round" strokeWidth={1.2} />
      <g fill={hairFill} stroke={outline} strokeLinejoin="round" strokeWidth={1.1}>
        {bangs.map((d) => <path key={d} d={d} />)}
        {style === "hime" ? (
          <>
            <path d="M18 42 L26 40 L26 74 L18 74 Z" />
            <path d="M54 40 L62 42 L62 74 L54 74 Z" />
          </>
        ) : null}
      </g>
      {style !== "none" ? (
        <path d="M30 24 C34 20 46 19 51 22" fill="none" opacity={0.35} stroke={selected ? ACCENT : PAPER} strokeLinecap="round" strokeWidth={2.4} />
      ) : null}
    </>
  );
}

function HairOriginalArt({ selected }: { readonly selected: boolean }) {
  return (
    <>
      {shoulders(0.7)}
      <path
        d="M17 72 L17 44 C17 24 27 14 40 14 C53 14 63 24 63 44 L63 72"
        fill="none"
        stroke={selected ? ACCENT : LINE_STRONG}
        strokeDasharray="2.4 2.4"
        strokeLinecap="round"
        strokeWidth={1.4}
      />
      <ellipse cx={40} cy={46} fill={RAISED} rx={18.5} ry={21.5} stroke={INK} strokeOpacity={0.55} strokeWidth={1.1} />
      <path d="M23 46 C25 30 32 24 40 24 C48 24 55 30 57 46" fill="none" stroke={LINE_STRONG} strokeDasharray="2 2.2" strokeWidth={1.1} />
      <g fill={INK}>
        <ellipse cx={32.5} cy={50} rx={2} ry={2.6} />
        <ellipse cx={47.5} cy={50} rx={2} ry={2.6} />
      </g>
      <path d="M36.5 60 q3.5 2.4 7 0" fill="none" stroke={INK} strokeLinecap="round" strokeWidth={1.2} />
      <rect fill={RAISED} height={11} rx={5.5} stroke={LINE} width={30} x={25} y={85.5} />
      <text fill={SOFT_TEXT} fontSize={7} fontWeight={600} textAnchor="middle" x={40} y={93.5}>
        원본
      </text>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* body                                                                       */
/* -------------------------------------------------------------------------- */

function BodyArt({
  headUnits,
  shoulderWidth,
  legLength,
  torsoLength,
  selected,
}: {
  readonly headUnits: number;
  readonly shoulderWidth: number;
  readonly legLength: number;
  readonly torsoLength: number;
  readonly selected: boolean;
}) {
  const units = clamp(headUnits, 2, 10);
  const top = 12;
  const bottom = 96;
  const total = bottom - top;
  const d = total / units;
  const r = d / 2;
  const cx = 46;
  const torsoWeight = 0.45 * clamp(torsoLength, 0.5, 1.5);
  const legWeight = 0.55 * clamp(legLength, 0.5, 1.5);
  const remaining = total - d;
  const torso = (remaining * torsoWeight) / (torsoWeight + legWeight);
  const legs = remaining - torso;
  const neckY = top + d;
  const hipY = neckY + torso;
  const shoulderHalf = clamp(4 + r * 0.9, 6, 14) * clamp(shoulderWidth, 0.6, 1.4);
  const hipHalf = shoulderHalf * 0.78;
  const limb = Math.max(2.4, r * 0.34);
  const ticks = Array.from({ length: Math.round(units) + 1 }, (_, index) => top + index * d);
  return (
    <>
      <g stroke={LINE_STRONG} strokeWidth={1}>
        <line x1={14} x2={14} y1={top} y2={bottom} />
        {ticks.map((y) => <line key={y} stroke={MUTED} x1={10.5} x2={17.5} y1={y} y2={y} />)}
      </g>
      <text fill={MUTED} fontSize={7} fontWeight={600} textAnchor="middle" x={14} y={8}>
        {Math.round(units)}
      </text>
      <path
        d={`M${n(cx - hipHalf * 0.55)} ${n(hipY)} L${n(cx - hipHalf * 0.62)} ${n(bottom - limb * 0.5)} M${n(cx + hipHalf * 0.55)} ${n(hipY)} L${n(cx + hipHalf * 0.62)} ${n(bottom - limb * 0.5)}`}
        fill="none"
        stroke={INK}
        strokeLinecap="round"
        strokeWidth={limb}
      />
      <path
        d={`M${n(cx - shoulderHalf)} ${n(neckY + 2)} L${n(cx - shoulderHalf - r * 0.3)} ${n(hipY + legs * 0.32)} M${n(cx + shoulderHalf)} ${n(neckY + 2)} L${n(cx + shoulderHalf + r * 0.3)} ${n(hipY + legs * 0.32)}`}
        fill="none"
        stroke={INK}
        strokeLinecap="round"
        strokeWidth={limb * 0.85}
      />
      <path
        d={`M${n(cx - shoulderHalf)} ${n(neckY + 1.5)} Q${cx} ${n(neckY - 2)} ${n(cx + shoulderHalf)} ${n(neckY + 1.5)} L${n(cx + hipHalf)} ${n(hipY)} L${n(cx - hipHalf)} ${n(hipY)} Z`}
        fill={RAISED}
        stroke={selected ? ACCENT : INK}
        strokeLinejoin="round"
        strokeWidth={1.4}
      />
      <circle cx={cx} cy={top + r} fill={RAISED} r={r} stroke={selected ? ACCENT : INK} strokeWidth={1.4} />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* garment                                                                    */
/* -------------------------------------------------------------------------- */

const COAT_BODY = "M22 30 L36 26 L40 44 L44 26 L58 30 L66 42 L62 76 L56 74 L56 90 L24 90 L24 74 L18 76 L14 42 Z";
const JACKET_BODY = "M22 30 L36 26 L40 44 L44 26 L58 30 L66 40 L62 74 L56 72 L56 80 L24 80 L24 72 L18 74 L14 40 Z";
const PANTS_BODY = "M26 22 L54 22 L54 86 L43 86 L40 40 L37 86 L26 86 Z";

function lapels(color: string, ink: string): ReactNode {
  return (
    <g fill={darken(color, 0.22)} stroke={ink} strokeLinejoin="round" strokeOpacity={0.7} strokeWidth={1}>
      <path d="M36 26 L40 44 L40 60 L33 40 Z" />
      <path d="M44 26 L40 44 L40 60 L47 40 Z" />
      <path d="M38 44 L40 60 L42 44 Z" fill={PAPER} stroke="none" />
    </g>
  );
}

function buttons(x: number, ys: readonly number[], ink: string): ReactNode {
  return (
    <g fill={ink} fillOpacity={0.75}>
      {ys.map((y) => <circle key={y} cx={x} cy={y} r={1.1} />)}
    </g>
  );
}

function garmentArt(glyph: CharacterGarmentGlyph, color: string, selected: boolean): ReactNode {
  const fill = safeColor(color, RAISED);
  const ink = selected ? ACCENT : INK;
  const shade = darken(color, 0.25);
  const light = lighten(color, 0.4);
  const outline = { fill, stroke: ink, strokeLinejoin: "round" as const, strokeOpacity: 0.75, strokeWidth: 1.3 };
  const detail = { fill: "none", stroke: ink, strokeLinecap: "round" as const, strokeOpacity: 0.7, strokeWidth: 1 };
  switch (glyph) {
    case "tshirt":
      return <path d="M24 30 L34 26 Q40 32 46 26 L56 30 L66 40 L58 46 L56 42 L56 74 L24 74 L24 42 L22 46 L14 40 Z" {...outline} />;
    case "shirt":
      return (
        <>
          <path d="M24 30 L34 26 L40 34 L46 26 L56 30 L64 36 L62 70 L56 68 L56 78 L24 78 L24 68 L18 70 L16 36 Z" {...outline} />
          <path d="M34 26 L40 34 L46 26 L43 30 L40 28 L37 30 Z" fill={light} stroke={ink} strokeOpacity={0.7} strokeWidth={1} />
          <path d="M40 34 L40 78" {...detail} />
          {buttons(40, [42, 50, 58, 66], ink)}
        </>
      );
    case "sweater":
      return (
        <>
          <path d="M22 32 L32 24 L32 20 L48 20 L48 24 L58 32 L64 40 L62 74 L56 72 L56 80 L24 80 L24 72 L18 74 L16 40 Z" {...outline} />
          <path d="M32 24 Q40 28 48 24 M28 80 L28 74 M34 80 L34 74 M40 80 L40 74 M46 80 L46 74 M52 80 L52 74" {...detail} />
        </>
      );
    case "sailor":
      return (
        <>
          <path d="M24 30 L36 26 L40 34 L44 26 L56 30 L64 40 L58 46 L56 42 L56 76 L24 76 L24 42 L22 46 L16 40 Z" {...outline} />
          <path d="M30 26 L40 44 L50 26 L54 34 L40 50 L26 34 Z" fill={light} stroke={ink} strokeLinejoin="round" strokeOpacity={0.7} strokeWidth={1} />
          <path d="M40 44 L36 62 L40 58 L44 62 Z" fill={shade} stroke={ink} strokeLinejoin="round" strokeOpacity={0.7} strokeWidth={1} />
        </>
      );
    case "tank":
      return <path d="M28 22 L34 22 L34 34 Q40 40 46 34 L46 22 L52 22 L54 44 L54 76 L26 76 L26 44 Z" {...outline} />;
    case "dress":
      return (
        <>
          <path d="M28 24 L34 24 L34 32 Q40 38 46 32 L46 24 L52 24 L54 44 L52 50 L68 88 L12 88 L28 50 L26 44 Z" {...outline} />
          <path d="M28 50 L52 50" {...detail} />
        </>
      );
    case "scrubs":
      return (
        <>
          <path d="M22 30 L34 26 L40 38 L46 26 L58 30 L66 42 L58 46 L56 42 L56 78 L24 78 L24 42 L22 46 L14 42 Z" {...outline} />
          <rect height={9} width={9} x={44} y={58} {...detail} />
        </>
      );
    case "blazer":
      return (
        <>
          <path d={JACKET_BODY} {...outline} />
          {lapels(color, ink)}
          {buttons(43, [64, 70], ink)}
        </>
      );
    case "hoodie":
      return (
        <>
          <path d="M22 32 L32 26 L48 26 L58 32 L64 42 L62 76 L56 74 L56 82 L24 82 L24 74 L18 76 L16 42 Z" {...outline} />
          <path d="M28 30 C28 16 52 16 52 30 C48 26 32 26 28 30 Z" fill={shade} stroke={ink} strokeLinejoin="round" strokeOpacity={0.7} strokeWidth={1} />
          <path d="M37 32 L36 46 M43 32 L44 46" {...detail} />
          <path d="M30 62 L50 62 L50 74 L30 74 Z" {...detail} />
        </>
      );
    case "coat":
      return (
        <>
          <path d={COAT_BODY} {...outline} />
          {lapels(color, ink)}
          {buttons(36, [64, 72, 80], ink)}
          {buttons(44, [64, 72, 80], ink)}
        </>
      );
    case "cardigan":
      return (
        <>
          <path d="M22 32 L34 26 L40 34 L46 26 L58 32 L64 42 L62 76 L56 74 L56 80 L24 80 L24 74 L18 76 L16 42 Z" {...outline} />
          <path d="M40 34 L40 80" {...detail} />
          {buttons(37.5, [44, 52, 60, 68], ink)}
        </>
      );
    case "armor":
      return (
        <>
          <path d="M24 30 L40 26 L56 30 L60 40 L56 66 L40 76 L24 66 L20 40 Z" {...outline} />
          <ellipse cx={20} cy={34} fill={shade} rx={8} ry={6} stroke={ink} strokeOpacity={0.7} strokeWidth={1} />
          <ellipse cx={60} cy={34} fill={shade} rx={8} ry={6} stroke={ink} strokeOpacity={0.7} strokeWidth={1} />
          <path d="M40 30 L40 72 M28 46 Q40 52 52 46" {...detail} />
        </>
      );
    case "robe":
      return (
        <>
          <path d="M26 26 L34 24 L40 32 L46 24 L54 26 L70 48 L62 54 L60 44 L62 90 L18 90 L20 44 L18 54 L10 48 Z" {...outline} />
          <path d="M30 58 L50 58 L50 62 L30 62 Z" fill={shade} stroke={ink} strokeOpacity={0.7} strokeWidth={1} />
          <path d="M34 24 L40 32 L46 24" {...detail} />
        </>
      );
    case "labcoat":
      return (
        <>
          <path d={COAT_BODY} {...outline} />
          {lapels(color, ink)}
          <rect height={9} width={9} x={45} y={66} {...detail} />
          {buttons(43, [64, 74], ink)}
        </>
      );
    case "pleated":
      return (
        <>
          <path d="M24 24 L56 24 L64 66 L16 66 Z" {...outline} />
          <path d="M31 24 L26 66 M38 24 L36 66 M42 24 L44 66 M49 24 L54 66" {...detail} />
        </>
      );
    case "longskirt":
      return (
        <>
          <path d="M26 22 L54 22 L66 88 L14 88 Z" {...outline} />
          <path d="M34 26 L30 88 M46 26 L50 88" {...detail} />
        </>
      );
    case "shorts":
      return <path d="M24 24 L56 24 L58 52 L42 52 L40 40 L38 52 L22 52 Z" {...outline} />;
    case "pants":
      return <path d={PANTS_BODY} {...outline} />;
    case "wide":
      return <path d="M26 22 L54 22 L62 86 L42 86 L40 40 L38 86 L18 86 Z" {...outline} />;
    case "jeans":
      return (
        <>
          <path d={PANTS_BODY} {...outline} />
          <path d="M26 28 L54 28 M40 28 L40 40 M28 32 Q33 36 34 30 M52 32 Q47 36 46 30" {...detail} />
        </>
      );
    case "scrubpants":
      return (
        <>
          <path d="M24 22 L56 22 L58 86 L43 86 L40 44 L37 86 L22 86 Z" {...outline} />
          <path d="M24 28 L56 28 M40 28 L36 36 M40 28 L44 36" {...detail} />
        </>
      );
    case "sneakers":
      return (
        <>
          <path d="M14 66 L16 52 Q24 44 34 48 L52 56 Q64 58 66 66 L66 72 L14 72 Z" {...outline} />
          <path d="M14 66 L66 66 L66 72 L14 72 Z" fill={light} stroke={ink} strokeOpacity={0.7} strokeWidth={1} />
          <path d="M26 54 L34 56 M26 59 L36 61 M28 64 L38 65" {...detail} />
        </>
      );
    case "boots":
      return (
        <>
          <path d="M22 36 L42 36 L44 56 L62 60 Q66 64 66 72 L18 72 L18 60 Z" {...outline} />
          <path d="M18 66 L66 66 M22 42 L42 42" {...detail} />
        </>
      );
    case "longboots":
      return (
        <>
          <path d="M24 18 L44 18 L46 56 L62 60 Q66 64 66 72 L18 72 L18 60 Z" {...outline} />
          <path d="M18 66 L66 66 M26 24 L44 24" {...detail} />
        </>
      );
    case "heels":
      return (
        <>
          <path d="M20 50 Q30 44 46 48 Q60 56 66 66 L66 70 L54 70 L50 64 L34 64 L30 72 L24 72 L26 64 Z" {...outline} />
          <path d="M34 64 L50 64" {...detail} />
        </>
      );
    case "loafers":
      return (
        <>
          <path d="M16 60 Q24 50 36 52 L54 58 Q64 60 66 68 L66 72 L16 72 Z" {...outline} />
          <path d="M30 54 L34 62 M38 53 L38 60 L46 62" {...detail} />
        </>
      );
    case "sandals":
      return (
        <>
          <path d="M14 66 L66 66 L66 72 L14 72 Z" {...outline} />
          <path d="M26 66 L34 54 L44 66 M44 66 L54 58 M20 66 L26 60" fill="none" stroke={ink} strokeLinecap="round" strokeOpacity={0.85} strokeWidth={1.6} />
        </>
      );
    case "clogs":
      return (
        <>
          <path d="M16 58 Q24 46 40 48 L56 54 Q66 58 66 72 L16 72 Z" {...outline} />
          <path d="M16 63 L66 63 L66 72 L16 72 Z" fill={light} stroke={ink} strokeOpacity={0.7} strokeWidth={1} />
          <path d="M30 52 L36 60" {...detail} />
        </>
      );
    case "original":
    default:
      return (
        <>
          <path d="M40 18 Q46 18 46 24 Q46 28 40 30 L40 33" fill="none" stroke={MUTED} strokeLinecap="round" strokeWidth={1.4} />
          <path d="M40 33 L16 48 L64 48 Z" fill="none" stroke={MUTED} strokeLinejoin="round" strokeWidth={1.4} />
          <path
            d="M26 42 L34 38 Q40 44 46 38 L54 42 L62 52 L55 56 L54 52 L54 80 L26 80 L26 52 L25 56 L18 52 Z"
            fill={fill}
            fillOpacity={0.18}
            stroke={selected ? ACCENT : LINE_STRONG}
            strokeDasharray="2.4 2.4"
            strokeLinejoin="round"
            strokeWidth={1.3}
          />
        </>
      );
  }
}

/* -------------------------------------------------------------------------- */
/* prop                                                                       */
/* -------------------------------------------------------------------------- */

const ROD_PROPS = new Set(["sword", "staff", "wand", "umbrella", "torch", "mic", "pencil", "syringe", "flute", "fan", "gun"]);
const VESSEL_PROPS = new Set(["mug", "coffee", "bottle", "lollipop", "bouquet"]);

/** Colour stroke over a currentColor hairline, so dark spec colours stay visible on dark chrome. */
function inkedStroke(d: string, color: string, width: number, key?: string): ReactNode {
  return (
    <g key={key}>
      <path d={d} fill="none" stroke={INK} strokeLinecap="round" strokeOpacity={0.55} strokeWidth={width + 1.4} />
      <path d={d} fill="none" stroke={color} strokeLinecap="round" strokeWidth={width} />
    </g>
  );
}

function headSilhouette(): ReactNode {
  return (
    <>
      <path d="M22 100 C24 84 32 78 40 78 C48 78 56 84 58 100 Z" fill={RAISED} opacity={0.7} />
      <rect fill={RAISED} height={12} width={10} x={35} y={68} />
      <ellipse cx={40} cy={52} fill={RAISED} rx={17} ry={20} stroke={INK} strokeOpacity={0.55} strokeWidth={1.1} />
      <g fill={INK}>
        <ellipse cx={33} cy={54} rx={1.9} ry={2.5} />
        <ellipse cx={47} cy={54} rx={1.9} ry={2.5} />
      </g>
      <path d="M37 64 q3 2.2 6 0" fill="none" stroke={INK} strokeLinecap="round" strokeWidth={1.1} />
    </>
  );
}

function bustSilhouette(): ReactNode {
  return (
    <>
      <circle cx={40} cy={20} fill={RAISED} r={9} stroke={INK} strokeOpacity={0.5} strokeWidth={1} />
      <rect fill={RAISED} height={8} width={6} x={37} y={28} />
      <path d="M16 40 C22 34 30 32 40 33 C50 32 58 34 64 40 L62 92 L18 92 Z" fill={RAISED} stroke={INK} strokeOpacity={0.55} strokeWidth={1.1} />
    </>
  );
}

function headPropOverlay(propId: string, fill: string, ink: string, shade: string): ReactNode {
  const solid = { fill, stroke: ink, strokeLinejoin: "round" as const, strokeOpacity: 0.75, strokeWidth: 1.2 };
  switch (propId) {
    case "cap":
      return (
        <>
          <path d="M22 46 C22 30 30 24 40 24 C50 24 58 30 58 46 Z" {...solid} />
          <path d="M18 46 Q40 38 62 46 Q40 52 18 46 Z" fill={shade} stroke={ink} strokeOpacity={0.75} strokeWidth={1.1} />
        </>
      );
    case "beret":
      return (
        <>
          <path d="M20 40 C16 26 34 20 48 24 C60 27 64 36 58 42 Q40 36 20 40 Z" {...solid} />
          <circle cx={44} cy={22} fill={shade} r={1.8} />
        </>
      );
    case "beanie":
      return (
        <>
          <path d="M22 48 C22 26 30 18 40 18 C50 18 58 26 58 48 Z" {...solid} />
          <rect fill={shade} height={8} rx={2} stroke={ink} strokeOpacity={0.75} strokeWidth={1} width={36} x={22} y={42} />
          <circle cx={40} cy={16} fill={fill} r={3.5} stroke={ink} strokeOpacity={0.75} strokeWidth={1} />
        </>
      );
    case "surgicalCap":
      return (
        <>
          <path d="M21 44 C22 26 32 22 40 22 C48 22 58 26 59 44 Z" {...solid} />
          <rect fill={shade} height={4} width={38} x={21} y={44} />
          <path d="M56 48 L62 56 M58 48 L60 58" fill="none" stroke={ink} strokeLinecap="round" strokeOpacity={0.8} strokeWidth={1.2} />
        </>
      );
    case "glasses":
      return (
        <>
          <g fill={PAPER} fillOpacity={0.35} stroke={INK} strokeOpacity={0.55} strokeWidth={3.2}>
            <rect height={10} rx={3} width={14} x={24} y={49} />
            <rect height={10} rx={3} width={14} x={42} y={49} />
          </g>
          <g fill="none" stroke={fill} strokeWidth={1.8}>
            <rect height={10} rx={3} width={14} x={24} y={49} />
            <rect height={10} rx={3} width={14} x={42} y={49} />
          </g>
          {inkedStroke("M38 53 L42 53 M24 52 L19 50 M56 52 L61 50", fill, 1.8)}
        </>
      );
    case "sunglasses":
      return (
        <g stroke={ink} strokeLinecap="round" strokeOpacity={0.75} strokeWidth={1}>
          <rect fill={fill} height={10} rx={3} width={14} x={24} y={49} />
          <rect fill={fill} height={10} rx={3} width={14} x={42} y={49} />
          <path d="M38 52 L42 52 M24 52 L19 50 M56 52 L61 50" fill="none" />
        </g>
      );
    case "goggles":
      return (
        <g stroke={ink} strokeOpacity={0.75} strokeWidth={1.1}>
          <path d="M26 40 C18 42 18 48 24 50 M54 40 C62 42 62 48 56 50" fill="none" stroke={shade} strokeWidth={2.2} />
          <circle cx={32} cy={40} fill={fill} fillOpacity={0.8} r={6} />
          <circle cx={48} cy={40} fill={fill} fillOpacity={0.8} r={6} />
          <path d="M38 40 L42 40" fill="none" />
        </g>
      );
    case "eyepatch":
      return (
        <>
          <path d="M43 50 L24 38 M51 50 L57 44" fill="none" stroke={ink} strokeLinecap="round" strokeOpacity={0.85} strokeWidth={1.3} />
          <circle cx={47} cy={54} fill={fill} r={6} stroke={ink} strokeOpacity={0.75} strokeWidth={1} />
        </>
      );
    case "headphones":
      return (
        <>
          {inkedStroke("M22 50 C22 24 58 24 58 50", fill, 3.2)}
          <rect fill={fill} height={12} rx={3} stroke={ink} strokeOpacity={0.75} strokeWidth={1} width={7} x={18} y={46} />
          <rect fill={fill} height={12} rx={3} stroke={ink} strokeOpacity={0.75} strokeWidth={1} width={7} x={55} y={46} />
        </>
      );
    case "earmuffs":
      return (
        <>
          {inkedStroke("M24 50 C26 30 54 30 56 50", fill, 2)}
          <circle cx={23} cy={54} fill={fill} r={5} stroke={ink} strokeOpacity={0.75} strokeWidth={1} />
          <circle cx={57} cy={54} fill={fill} r={5} stroke={ink} strokeOpacity={0.75} strokeWidth={1} />
        </>
      );
    case "catEars":
      return (
        <>
          <path d="M25 41 L27 17 L40 33 Z" {...solid} />
          <path d="M55 41 L53 17 L40 33 Z" {...solid} />
          <path d="M28 37 L29 24 L36 32 Z M52 37 L51 24 L44 32 Z" fill={shade} />
        </>
      );
    case "elfEars":
      return (
        <>
          <path d="M24 46 L8 34 L22 58 Z" {...solid} />
          <path d="M56 46 L72 34 L58 58 Z" {...solid} />
          <path d="M22 48 L12 38 M58 48 L68 38" fill="none" stroke={ink} strokeOpacity={0.5} strokeWidth={0.9} />
        </>
      );
    case "horns":
      return (
        <>
          <path d="M28 34 C22 26 22 16 28 12 C28 20 30 26 34 32 Z" {...solid} />
          <path d="M52 34 C58 26 58 16 52 12 C52 20 50 26 46 32 Z" {...solid} />
        </>
      );
    case "halo":
      return (
        <>
          <ellipse cx={40} cy={22} fill="none" rx={16} ry={4.5} stroke={fill} strokeWidth={3} />
          <ellipse cx={40} cy={22} fill="none" rx={16} ry={4.5} stroke={ink} strokeOpacity={0.4} strokeWidth={0.8} />
        </>
      );
    case "crown":
      return (
        <>
          <path d="M22 42 L22 22 L31 32 L40 16 L49 32 L58 22 L58 42 Z" {...solid} />
          <g fill={PAPER}>
            <circle cx={31} cy={38} r={1.6} />
            <circle cx={40} cy={36} r={1.6} />
            <circle cx={49} cy={38} r={1.6} />
          </g>
        </>
      );
    case "flowerCrown":
      return (
        <>
          {inkedStroke("M22 42 C28 30 52 30 58 42", shade, 3)}
          <g fill={fill} stroke={ink} strokeOpacity={0.6} strokeWidth={0.8}>
            {[[26, 36], [33, 31], [40, 29], [47, 31], [54, 36]].map(([x, y]) => (
              <circle key={`${x}-${y}`} cx={x} cy={y} r={3} />
            ))}
          </g>
          <g fill={PAPER}>
            {[[26, 36], [33, 31], [40, 29], [47, 31], [54, 36]].map(([x, y]) => (
              <circle key={`${x}-${y}`} cx={x} cy={y} r={1} />
            ))}
          </g>
        </>
      );
    case "ribbon":
      return (
        <>
          <path d="M54 28 C46 18 44 30 54 28 Z" {...solid} />
          <path d="M54 28 C62 18 64 30 54 28 Z" {...solid} />
          {inkedStroke("M52 30 L49 38 M56 30 L59 38", fill, 2)}
          <circle cx={54} cy={28} fill={shade} r={2.2} />
        </>
      );
    case "hairpin":
      return inkedStroke("M26 34 L38 30 M27 37 L39 33", fill, 2.5);
    case "headband":
      return inkedStroke("M23 44 C30 38 50 38 57 44", fill, 3.5);
    case "faceMask":
      return (
        <>
          <path d="M25 52 C24 66 56 66 55 52 Q40 56 25 52 Z" {...solid} />
          <path d="M25 54 L20 50 M55 54 L60 50" fill="none" stroke={ink} strokeLinecap="round" strokeOpacity={0.8} strokeWidth={1.2} />
        </>
      );
    case "choker":
      return (
        <>
          <rect fill={fill} height={4} rx={2} stroke={ink} strokeOpacity={0.75} strokeWidth={1} width={16} x={32} y={70} />
          <circle cx={40} cy={75.5} fill={PAPER} r={1.6} stroke={ink} strokeOpacity={0.6} strokeWidth={0.8} />
        </>
      );
    default:
      return inkedStroke("M24 40 Q40 34 56 40", fill, 3);
  }
}

function bodyPropOverlay(propId: string, fill: string, ink: string, shade: string): { readonly behind: ReactNode; readonly front: ReactNode } {
  const solid = { fill, stroke: ink, strokeLinejoin: "round" as const, strokeOpacity: 0.75, strokeWidth: 1.2 };
  switch (propId) {
    case "cape":
      return {
        behind: <path d="M18 40 C6 56 6 76 10 92 L70 92 C74 76 74 56 62 40 Z" {...solid} />,
        front: <circle cx={40} cy={37} fill={PAPER} r={2.4} stroke={ink} strokeOpacity={0.7} strokeWidth={1} />,
      };
    case "backpack":
      return {
        behind: (
          <>
            <path d="M12 40 L22 40 L22 74 L12 74 Z" {...solid} />
            <path d="M58 40 L68 40 L68 74 L58 74 Z" {...solid} />
            {inkedStroke("M34 34 Q40 29 46 34", fill, 2)}
          </>
        ),
        front: inkedStroke("M30 35 L28 72 M50 35 L52 72", fill, 4),
      };
    case "shoulderbag":
      return {
        behind: null,
        front: (
          <>
            {inkedStroke("M24 36 L58 74", fill, 3.5)}
            <rect height={14} rx={3} width={16} x={52} y={68} {...solid} />
            <path d="M52 74 L68 74" fill="none" stroke={ink} strokeOpacity={0.6} strokeWidth={1} />
          </>
        ),
      };
    case "wings":
      return {
        behind: (
          <>
            <path d="M34 40 C16 24 4 36 10 60 C4 66 12 74 20 68 C22 74 30 74 32 66 Z" {...solid} />
            <path d="M46 40 C64 24 76 36 70 60 C76 66 68 74 60 68 C58 74 50 74 48 66 Z" {...solid} />
          </>
        ),
        front: null,
      };
    case "backwing":
      return {
        behind: (
          <>
            <path d="M24 42 C10 32 2 44 10 58 L20 56 C14 50 18 46 24 48 Z" {...solid} />
            <path d="M56 42 C70 32 78 44 70 58 L60 56 C66 50 62 46 56 48 Z" {...solid} />
          </>
        ),
        front: null,
      };
    case "apron":
      return {
        behind: null,
        front: (
          <>
            <path d="M32 40 L48 40 L48 56 L60 60 L58 92 L22 92 L20 60 L32 56 Z" {...solid} />
            <path d="M32 40 C34 30 46 30 48 40" fill="none" stroke={ink} strokeOpacity={0.7} strokeWidth={1.1} />
            <rect fill="none" height={8} stroke={ink} strokeOpacity={0.6} strokeWidth={1} width={12} x={34} y={70} />
          </>
        ),
      };
    case "belt":
      return {
        behind: null,
        front: (
          <>
            <rect height={7} width={44} x={18} y={66} {...solid} />
            <rect fill={PAPER} height={11} rx={1.5} stroke={ink} strokeOpacity={0.7} strokeWidth={1} width={8} x={36} y={64} />
          </>
        ),
      };
    case "holster":
      return {
        behind: null,
        front: (
          <>
            {inkedStroke("M22 40 L58 72", fill, 3)}
            <path d="M50 66 L62 66 L60 84 L54 84 Z" {...solid} />
          </>
        ),
      };
    case "stethoscope":
      return {
        behind: null,
        front: (
          <>
            {inkedStroke("M30 36 C26 48 30 56 40 58 C50 56 54 48 50 36 M40 58 L42 72", fill, 2.2)}
            <circle cx={43} cy={76} fill={fill} r={4.5} stroke={ink} strokeOpacity={0.75} strokeWidth={1} />
            <circle cx={30} cy={36} fill={shade} r={1.8} />
            <circle cx={50} cy={36} fill={shade} r={1.8} />
          </>
        ),
      };
    case "idBadge":
      return {
        behind: null,
        front: (
          <>
            {inkedStroke("M34 34 L40 56 L46 34", fill, 1.8)}
            <rect fill={PAPER} height={10} rx={1.5} stroke={ink} strokeOpacity={0.7} strokeWidth={1} width={14} x={33} y={56} />
            <rect fill={fill} height={3} width={14} x={33} y={56} />
          </>
        ),
      };
    case "nameTag":
      return {
        behind: null,
        front: (
          <>
            <rect height={8} rx={1} width={14} x={44} y={46} {...solid} />
            <path d="M47 50 L55 50" fill="none" stroke={ink} strokeOpacity={0.5} strokeWidth={1} />
          </>
        ),
      };
    case "scarf":
      return {
        behind: null,
        front: (
          <>
            <path d="M26 34 C30 42 50 42 54 34 L56 42 C50 50 30 50 24 42 Z" {...solid} />
            <path d="M44 46 L48 74 L40 72 Z" {...solid} />
          </>
        ),
      };
    case "gloves":
      return {
        behind: null,
        front: (
          <>
            <path d="M2 68 L14 68 L16 76 C18 84 12 92 6 90 C0 88 0 78 2 68 Z" {...solid} />
            <path d="M78 68 L66 68 L64 76 C62 84 68 92 74 90 C80 88 80 78 78 68 Z" {...solid} />
            <path d="M2 68 L14 68 M66 68 L78 68" fill="none" stroke={ink} strokeOpacity={0.6} strokeWidth={1.6} />
          </>
        ),
      };
    case "guitar":
      return {
        behind: null,
        front: (
          <>
            <path d="M48 54 L64 34" fill="none" stroke={ink} strokeLinecap="round" strokeOpacity={0.85} strokeWidth={3} />
            <path d="M34 56 C22 52 18 68 30 76 C34 84 50 84 52 72 C62 66 56 50 46 54 Z" {...solid} />
            <circle cx={41} cy={68} fill={ink} fillOpacity={0.6} r={3.5} />
          </>
        ),
      };
    case "quiver":
      return {
        behind: (
          <>
            <path d="M54 30 L66 36 L58 78 L46 72 Z" {...solid} />
            <path d="M58 32 L64 20 M62 34 L70 24" fill="none" stroke={ink} strokeLinecap="round" strokeOpacity={0.85} strokeWidth={1.2} />
          </>
        ),
        front: inkedStroke("M26 40 L56 74", fill, 2.5),
      };
    case "tail":
      return {
        behind: null,
        front: <path d="M56 84 C72 80 76 64 66 54 C74 66 66 76 54 80 Z" {...solid} />,
      };
    default:
      return {
        behind: null,
        front: <circle cx={40} cy={56} r={6} {...solid} />,
      };
  }
}

function handPropOverlay(propId: string, fill: string, ink: string, shade: string): ReactNode {
  const solid = { fill, stroke: ink, strokeLinejoin: "round" as const, strokeOpacity: 0.75, strokeWidth: 1.2 };
  if (ROD_PROPS.has(propId)) {
    return (
      <>
        <rect height={78} rx={2.5} width={6} x={37} y={10} {...solid} />
        {propId === "sword" ? <rect fill={shade} height={4} rx={1} width={20} x={30} y={30} /> : null}
      </>
    );
  }
  if (VESSEL_PROPS.has(propId)) {
    return (
      <>
        <path d="M26 26 L54 26 L50 60 L30 60 Z" {...solid} />
        <path d="M54 32 C62 32 62 48 52 48" fill="none" stroke={ink} strokeOpacity={0.7} strokeWidth={1.4} />
        <rect fill={shade} height={4} width={28} x={26} y={26} />
      </>
    );
  }
  return <rect height={36} rx={3} width={28} x={26} y={24} {...solid} />;
}

function PropArt({
  propId,
  category,
  color,
  selected,
}: {
  readonly propId: string;
  readonly category: "hand" | "head" | "body";
  readonly color: string;
  readonly selected: boolean;
}) {
  const fill = safeColor(color, RAISED);
  const ink = selected ? ACCENT : INK;
  const shade = darken(color, 0.3);
  if (category === "head") {
    return (
      <>
        {headSilhouette()}
        {headPropOverlay(propId, fill, ink, shade)}
      </>
    );
  }
  if (category === "body") {
    const overlay = bodyPropOverlay(propId, fill, ink, shade);
    return (
      <>
        {overlay.behind}
        {bustSilhouette()}
        {overlay.front}
      </>
    );
  }
  return (
    <>
      {handPropOverlay(propId, fill, ink, shade)}
      <path
        d="M22 62 C20 50 30 46 42 48 L54 52 C60 56 58 68 52 72 L30 76 C24 76 22 70 22 62 Z"
        fill={RAISED}
        stroke={INK}
        strokeLinejoin="round"
        strokeOpacity={0.7}
        strokeWidth={1.3}
      />
      <path d="M28 54 C22 56 22 64 28 66" fill="none" stroke={INK} strokeLinecap="round" strokeOpacity={0.6} strokeWidth={1} />
      <path d="M26 76 L28 92 L50 92 L52 74" fill={RAISED} stroke={INK} strokeOpacity={0.5} strokeWidth={1} />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* expression                                                                 */
/* -------------------------------------------------------------------------- */

function ExpressionArt({ weights, selected }: { readonly weights: Readonly<Record<string, number>>; readonly selected: boolean }) {
  const w = (name: string) => clamp(weights[name] ?? 0, 0, 1);
  const happy = w("happy");
  const angry = w("angry");
  const sad = w("sad");
  const relaxed = w("relaxed");
  const surprised = w("surprised");
  const blink = w("blink");
  const aa = w("aa");
  const ih = w("ih");
  const ou = w("ou");
  const ee = w("ee");
  const oh = w("oh");
  const lookX = (w("lookLeft") - w("lookRight")) * 2.6;
  const lookY = (w("lookDown") - w("lookUp")) * 2.2;
  const cx = 40;
  const eyeY = 47;
  const eyeGap = 9.5;
  const eyeOpen = clamp(1 + 0.55 * surprised - 0.55 * relaxed - 0.35 * happy, 0.15, 1.6);
  const ink = selected ? ACCENT : INK;

  const renderEye = (side: -1 | 1) => {
    const closed = Math.max(blink, side === 1 ? w("blinkLeft") : w("blinkRight"));
    const ex = cx + side * eyeGap;
    const rx = 5.2 * (1 + 0.15 * surprised);
    const ry = 4.4 * eyeOpen * (1 - closed);
    if (ry < 1.1) {
      const curl = happy > 0.4 ? -3.2 : 1.6;
      return <path key={side} d={`M${n(ex - rx)} ${eyeY} Q${n(ex)} ${n(eyeY + curl)} ${n(ex + rx)} ${eyeY}`} fill="none" stroke={ink} strokeLinecap="round" strokeWidth={1.8} />;
    }
    const pupil = 2.3 + 0.6 * surprised;
    return (
      <g key={side}>
        <ellipse cx={ex} cy={eyeY} fill={CANVAS} rx={rx} ry={ry} stroke={INK} strokeOpacity={0.65} strokeWidth={0.9} />
        <circle cx={clamp(ex + lookX, ex - rx * 0.5, ex + rx * 0.5)} cy={clamp(eyeY + lookY, eyeY - ry * 0.5, eyeY + ry * 0.5)} fill={INK} r={Math.min(pupil, ry * 0.85)} />
        <circle cx={clamp(ex + lookX, ex - rx * 0.5, ex + rx * 0.5) - 0.9} cy={clamp(eyeY + lookY, eyeY - ry * 0.5, eyeY + ry * 0.5) - 0.9} fill={PAPER} r={0.8} />
        <path d={`M${n(ex - rx)} ${eyeY} Q${n(ex)} ${n(eyeY - ry * 1.25)} ${n(ex + rx)} ${eyeY}`} fill="none" stroke={ink} strokeLinecap="round" strokeWidth={1.4} />
      </g>
    );
  };

  const renderBrow = (side: -1 | 1) => {
    const inner = cx + side * 3.5;
    const outer = cx + side * 14;
    const baseY = eyeY - 9 - 3 * surprised + 1 * relaxed;
    const innerY = baseY + 3.5 * angry - 3 * sad;
    const outerY = baseY - 1 * angry + 1.6 * sad;
    const controlY = Math.min(innerY, outerY) - 1.5 + 1.2 * angry;
    return (
      <path
        key={side}
        d={`M${n(inner)} ${n(innerY)} Q${n(cx + side * 8.5)} ${n(controlY)} ${n(outer)} ${n(outerY)}`}
        fill="none"
        stroke={ink}
        strokeLinecap="round"
        strokeWidth={2}
      />
    );
  };

  const mouthY = 65;
  const halfWidth = clamp(7 + 5 * happy + 3.5 * ee + 3 * ih - 3 * ou - 1.5 * oh, 3, 14);
  const lift = 4.5 * happy - 3.5 * sad - 2 * angry;
  const openHeight = clamp(11 * aa + 5 * ih + 8 * oh + 6 * ou + 3 * ee + 7 * surprised, 0, 14);
  const mouth = openHeight > 1.4 ? (
    <ellipse cx={cx} cy={mouthY + openHeight * 0.3} fill={INK} fillOpacity={0.88} rx={Math.max(halfWidth * 0.6, 2.4)} ry={openHeight / 2} stroke={ink} strokeWidth={1.2} />
  ) : (
    <path
      d={`M${n(cx - halfWidth)} ${n(mouthY - lift)} Q${cx} ${n(mouthY + lift * 0.9 + 1)} ${n(cx + halfWidth)} ${n(mouthY - lift)}`}
      fill="none"
      stroke={ink}
      strokeLinecap="round"
      strokeWidth={2}
    />
  );

  return (
    <>
      <path d={headPath(cx, 50, 23, 26, 0.45, 1)} fill={RAISED} stroke={INK} strokeOpacity={0.7} strokeWidth={1.3} />
      {renderBrow(-1)}
      {renderBrow(1)}
      {renderEye(-1)}
      {renderEye(1)}
      {mouth}
      {sad > 0.6 ? <path d="M32.5 53 q-1.4 4 0 7" fill="none" stroke={INK} strokeLinecap="round" strokeOpacity={0.6} strokeWidth={1.1} /> : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* pose                                                                       */
/* -------------------------------------------------------------------------- */

function PoseArt({ presetId, selected }: { readonly presetId: string; readonly selected: boolean }) {
  const detail = resolveCharacterPoseGlyphDetail(presetId);
  const figure = detail.figure;
  const joints = characterPoseGlyphJoints(figure);
  const px = (point: readonly [number, number]) => `${n(point[0] * 100 - 10)} ${n(point[1] * 100 - 6)}`;
  const stroke = { fill: "none", stroke: INK, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, strokeWidth: 3.2 };
  const handRadius = (depth: number) => 2.3 + 1.4 * Math.max(0, depth);
  const marker = (point: readonly [number, number], r: number) => (
    <circle cx={point[0] * 100 - 10} cy={point[1] * 100 - 6} fill={INK} r={r} />
  );
  return (
    <>
      <path d="M16 84 L64 84" fill="none" stroke={selected ? ACCENT : LINE_STRONG} strokeDasharray="2 2.4" strokeLinecap="round" strokeWidth={1} />
      <path d={`M${px(joints.leftHip)} L${px(figure.leftKnee)} L${px(figure.leftFoot)}`} {...stroke} />
      <path d={`M${px(joints.rightHip)} L${px(figure.rightKnee)} L${px(figure.rightFoot)}`} {...stroke} />
      <path d={`M${px(figure.hips)} L${px(figure.neck)}`} {...stroke} strokeWidth={4.4} />
      <path d={`M${px(joints.rightShoulder)} L${px(joints.leftShoulder)}`} {...stroke} strokeWidth={3.6} />
      <path d={`M${px(joints.leftShoulder)} L${px(figure.leftElbow)} L${px(figure.leftHand)}`} {...stroke} />
      <path d={`M${px(joints.rightShoulder)} L${px(figure.rightElbow)} L${px(figure.rightHand)}`} {...stroke} />
      {marker(figure.leftHand, handRadius(detail.depth.leftHand))}
      {marker(figure.rightHand, handRadius(detail.depth.rightHand))}
      {marker(figure.leftFoot, 2.1)}
      {marker(figure.rightFoot, 2.1)}
      <circle
        cx={figure.head[0] * 100 - 10}
        cy={figure.head[1] * 100 - 6}
        fill={selected ? ACCENT : RAISED}
        r={6}
        stroke={INK}
        strokeWidth={2}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* hand-pose                                                                  */
/* -------------------------------------------------------------------------- */

const FINGER_BASES: readonly { readonly x: number; readonly y: number; readonly length: number; readonly angle: number }[] = [
  { x: 30, y: 52, length: 19, angle: -9 },
  { x: 37, y: 50, length: 22, angle: -3 },
  { x: 44, y: 50, length: 20, angle: 3 },
  { x: 51, y: 52, length: 15, angle: 10 },
];

function fingerLine(x: number, y: number, length: number, angleDeg: number): { readonly d: string; readonly tip: readonly [number, number] } {
  const rad = (angleDeg * Math.PI) / 180;
  const tip: readonly [number, number] = [x + Math.sin(rad) * length, y - Math.cos(rad) * length];
  return { d: `M${n(x)} ${n(y)} L${n(tip[0])} ${n(tip[1])}`, tip };
}

function HandPoseArt({ poseType, selected }: { readonly poseType: CharacterHandPoseType; readonly selected: boolean }) {
  const layout = characterHandGlyphLayout(poseType);
  const [thumbCurl, ...fingerCurls] = layout.curls;
  const fan = 0.3 + 0.7 * layout.spread;
  const accent = selected ? ACCENT : INK;
  const fingers = FINGER_BASES.map((finger, index) => {
    const curl = clamp(fingerCurls[index] ?? 0, 0, 1);
    const line = fingerLine(finger.x, finger.y, finger.length * (1 - 0.72 * curl), finger.angle * fan);
    return { ...line, curl, key: index };
  });
  const thumb = fingerLine(28, 64, 17 * (1 - 0.3 * thumbCurl), layout.thumbAngle);
  const outlined = (d: string, key: string | number) => (
    <g key={key}>
      <path d={d} fill="none" stroke={INK} strokeLinecap="round" strokeWidth={6.4} />
      <path d={d} fill="none" stroke={RAISED} strokeLinecap="round" strokeWidth={4.2} />
    </g>
  );
  const prop = layout.prop;
  return (
    <>
      {prop === "rod" ? <rect fill={MUTED} height={64} rx={2.5} stroke={INK} strokeOpacity={0.5} width={6} x={37} y={26} /> : null}
      <path d="M27 52 Q26 74 32 78 L48 78 Q54 74 53 52 Q40 46 27 52 Z" fill={RAISED} stroke={INK} strokeLinejoin="round" strokeWidth={1.4} />
      <path d="M32 78 L30 92 L50 92 L48 78" fill={RAISED} stroke={INK} strokeLinejoin="round" strokeWidth={1.4} />
      {outlined(thumb.d, "thumb")}
      {fingers.map((finger) => outlined(finger.d, finger.key))}
      {fingers.map((finger) => (finger.curl >= 0.55 ? <circle key={`k${finger.key}`} cx={finger.tip[0]} cy={finger.tip[1]} fill={accent} fillOpacity={0.85} r={2.4} /> : null))}
      {prop === "phone" ? <rect fill={MUTED} height={24} rx={2.5} stroke={INK} strokeOpacity={0.6} width={13} x={33} y={38} /> : null}
      {prop === "pen" ? (
        <>
          <path d="M24 78 L54 38" fill="none" stroke={MUTED} strokeLinecap="round" strokeWidth={3} />
          <path d="M52 40 L58 32" fill="none" stroke={INK} strokeLinecap="round" strokeWidth={2} />
        </>
      ) : null}
      {prop === "cup" ? (
        <>
          <rect fill={PAPER} height={20} rx={3} stroke={INK} strokeOpacity={0.6} width={20} x={30} y={40} />
          <path d="M50 46 C58 46 58 56 50 56" fill="none" stroke={INK} strokeOpacity={0.6} strokeWidth={1.4} />
        </>
      ) : null}
      {prop === "heart" ? (
        <path d="M33 46 C31 42 26 43 27 47 C27.5 50 31 52 33 54 C35 52 38.5 50 39 47 C40 43 35 42 33 46 Z" fill={ACCENT} stroke={INK} strokeOpacity={0.4} strokeWidth={0.8} />
      ) : null}
      {prop === "ring" ? <circle cx={31} cy={44} fill="none" r={4.2} stroke={accent} strokeWidth={1.6} /> : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* glyph fallback                                                             */
/* -------------------------------------------------------------------------- */

function GlyphArt({ caption, selected }: { readonly caption: string; readonly selected: boolean }) {
  const trimmed = caption.trim();
  const markY = trimmed ? 40 : 50;
  return (
    <>
      <rect fill={RAISED} height={28} rx={7} stroke={selected ? ACCENT : LINE_STRONG} strokeWidth={1.2} width={28} x={26} y={markY - 14} />
      <path
        d={`M40 ${n(markY - 10)} L43 ${n(markY - 3)} L50 ${n(markY)} L43 ${n(markY + 3)} L40 ${n(markY + 10)} L37 ${n(markY + 3)} L30 ${n(markY)} L37 ${n(markY - 3)} Z`}
        fill={INK}
        fillOpacity={0.75}
      />
      {trimmed ? (
        <text fill={MUTED} fontSize={7.5} fontWeight={600} textAnchor="middle" x={40} y={74}>
          {trimmed.length > 10 ? `${trimmed.slice(0, 9)}…` : trimmed}
        </text>
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Dispatcher                                                                 */
/* -------------------------------------------------------------------------- */

function defaultPreviewLabel(spec: CharacterSlotPreviewSpec): string {
  switch (spec.kind) {
    case "face-shape":
      return "얼굴형 미리보기";
    case "eyes":
      return "눈 미리보기";
    case "irises":
      return "눈동자 미리보기";
    case "nose":
      return "코 미리보기";
    case "mouth":
      return "입 미리보기";
    case "ears":
      return "귀 미리보기";
    case "hair":
      return "헤어 미리보기";
    case "hair-original":
      return "원본 헤어 미리보기";
    case "body":
      return `${Math.round(clamp(spec.headUnits, 2, 10))}두신 체형 미리보기`;
    case "garment":
      return "의상 미리보기";
    case "prop":
      return "액세서리 미리보기";
    case "expression":
      return "표정 미리보기";
    case "pose":
      return "포즈 미리보기";
    case "hand-pose":
      return "손 포즈 미리보기";
    case "glyph":
    default:
      return spec.caption.trim() || "미리보기";
  }
}

/** `<title>` text: emoji live only here (never as the visual), pose tone rides along. */
function previewTitle(spec: CharacterSlotPreviewSpec, label: string): string | null {
  if (spec.kind === "expression") return spec.emoji ? `${label} ${spec.emoji}` : label;
  if (spec.kind === "pose") return spec.tone ? `${label} · ${spec.tone}` : label;
  return null;
}

function renderArt(spec: CharacterSlotPreviewSpec, selected: boolean, idBase: string): ReactNode {
  switch (spec.kind) {
    case "face-shape":
      return <FaceShapeArt face={spec.face} selected={selected} />;
    case "eyes":
      return <EyesArt idBase={idBase} lid={spec.lid} selected={selected} size={spec.size} spacing={spec.spacing} tilt={spec.tilt} />;
    case "irises":
      return <IrisesArt color={spec.color} highlight={spec.highlight} idBase={idBase} irisSize={spec.irisSize} pupil={spec.pupil} selected={selected} />;
    case "nose":
      return <NoseArt glyph={spec.glyph} height={spec.height} selected={selected} width={spec.width} />;
    case "mouth":
      return <MouthArt fullness={spec.fullness} open={spec.open} selected={selected} smile={spec.smile} width={spec.width} />;
    case "ears":
      return <EarsArt glyph={spec.glyph} selected={selected} size={spec.size} />;
    case "hair":
      return (
        <HairArt
          bangStyle={spec.bangStyle}
          baseColor={spec.baseColor}
          idBase={idBase}
          length={spec.length}
          selected={selected}
          style={spec.style}
          tipColor={spec.tipColor}
          volume={spec.volume}
        />
      );
    case "hair-original":
      return <HairOriginalArt selected={selected} />;
    case "body":
      return (
        <BodyArt
          headUnits={spec.headUnits}
          legLength={spec.legLength}
          selected={selected}
          shoulderWidth={spec.shoulderWidth}
          torsoLength={spec.torsoLength}
        />
      );
    case "garment":
      return garmentArt(spec.glyph, spec.color, selected);
    case "prop":
      return <PropArt category={spec.category} color={spec.color} propId={spec.propId} selected={selected} />;
    case "expression":
      return <ExpressionArt selected={selected} weights={spec.weights} />;
    case "pose":
      return <PoseArt presetId={spec.presetId} selected={selected} />;
    case "hand-pose":
      return <HandPoseArt poseType={spec.poseType} selected={selected} />;
    case "glyph":
    default:
      return <GlyphArt caption={spec.caption} selected={selected} />;
  }
}

/**
 * Deterministic 4:5 preview for one slot card. The frame fills with the panel token and tints
 * with the accent when selected; the artwork itself never depends on time, randomness or assets.
 */
export function CharacterSlotPreview({ spec, size = 80, selected = false, className, title }: CharacterSlotPreviewProps) {
  const idBase = `csp-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const label = title ?? defaultPreviewLabel(spec);
  const svgTitle = previewTitle(spec, label);
  const width = clamp(size, 8, 2048);
  return (
    <svg
      aria-label={label}
      className={cn("block shrink-0 select-none overflow-hidden", className)}
      data-character-preview={spec.kind}
      data-character-preview-selected={selected ? "true" : undefined}
      focusable="false"
      height={width * 1.25}
      role="img"
      viewBox="0 0 80 100"
      width={width}
    >
      {svgTitle ? <title>{svgTitle}</title> : null}
      <rect fill={PAPER} height={100} width={80} />
      {selected ? <rect fill={ACCENT_SOFT} height={100} width={80} /> : null}
      {renderArt(spec, selected, idBase)}
    </svg>
  );
}
