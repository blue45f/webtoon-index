/**
 * Miro / tldraw-class sticky notes for whiteboard sketching.
 *
 * Implemented as a specialized text-card seed (not a new El variant) so existing
 * text/layout/export pipelines keep working. Pure factory + layout helpers.
 */

import { uid } from "./studio-id";

import type { TextEl } from "./studio-element-model";

export const STUDIO_STICKY_NOTE_PRESETS = Object.freeze([
  Object.freeze({ id: "lemon", fill: "#fef08a", ink: "#422006", label: "레몬" }),
  Object.freeze({ id: "mint", fill: "#bbf7d0", ink: "#14532d", label: "민트" }),
  Object.freeze({ id: "sky", fill: "#bae6fd", ink: "#0c4a6e", label: "스카이" }),
  Object.freeze({ id: "blush", fill: "#fecdd3", ink: "#881337", label: "블러시" }),
  Object.freeze({ id: "lilac", fill: "#e9d5ff", ink: "#581c87", label: "라일락" }),
  Object.freeze({ id: "paper", fill: "#f5f5f4", ink: "#1c1917", label: "페이퍼" }),
] as const);

export type StudioStickyNotePresetId =
  (typeof STUDIO_STICKY_NOTE_PRESETS)[number]["id"];

export interface CreateStudioStickyNoteInput {
  readonly x: number;
  readonly y: number;
  readonly text?: string;
  readonly presetId?: StudioStickyNotePresetId;
  readonly width?: number;
  readonly fontSize?: number;
  readonly id?: string;
}

export function resolveStudioStickyNotePreset(
  presetId?: StudioStickyNotePresetId,
): (typeof STUDIO_STICKY_NOTE_PRESETS)[number] {
  return (
    STUDIO_STICKY_NOTE_PRESETS.find((preset) => preset.id === presetId)
    ?? STUDIO_STICKY_NOTE_PRESETS[0]!
  );
}

/**
 * Create a sticky note as a TextEl with sticky metadata in font/shadow styling.
 * Consumers can detect via `stickyNotePresetId` userData-style field on the element
 * when present on an extended record; base TextEl carries visual sticky look.
 */
export function createStudioStickyNoteElement(
  input: CreateStudioStickyNoteInput,
): TextEl & {
  stickyNotePresetId: StudioStickyNotePresetId;
  stickyNoteFill: string;
} {
  const preset = resolveStudioStickyNotePreset(input.presetId);
  const width = Math.max(120, Math.min(420, input.width ?? 200));
  const fontSize = Math.max(12, Math.min(28, input.fontSize ?? 16));
  return {
    id: input.id ?? uid(),
    type: "text",
    text: input.text?.trim() || "아이디어",
    x: input.x,
    y: input.y,
    width,
    fontSize,
    fill: preset.ink,
    rotation: 0,
    font: "system-ui, sans-serif",
    align: "left",
    lineHeight: 1.35,
    // Use shadow as soft sticky card depth
    shadowColor: "rgba(0,0,0,0.18)",
    shadowBlur: 10,
    shadowOffsetX: 2,
    shadowOffsetY: 4,
    // Background color is not on TextEl — stored for host chrome via sticky field
    stickyNotePresetId: preset.id,
    stickyNoteFill: preset.fill,
  };
}

export function studioStickyNoteGridLayout(
  count: number,
  originX: number,
  originY: number,
  columns = 3,
  gap = 16,
  cardWidth = 200,
  cardHeight = 160,
): readonly { readonly x: number; readonly y: number }[] {
  const safeCount = Math.max(0, Math.min(48, Math.floor(count)));
  const cols = Math.max(1, Math.min(8, Math.floor(columns)));
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < safeCount; i += 1) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    points.push({
      x: originX + col * (cardWidth + gap),
      y: originY + row * (cardHeight + gap),
    });
  }
  return Object.freeze(points);
}
