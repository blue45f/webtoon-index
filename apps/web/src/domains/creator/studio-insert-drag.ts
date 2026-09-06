import { BUBBLE_VARIANTS, type BubbleVariant } from "./studio-assets";

import type {
  StudioInsertDragPayload,
} from "./studio-insert-drag-core";

export * from "./studio-insert-drag-core";
export * from "./studio-insert-drag-writer";

/**
 * Studio drag MIME contract.
 *
 * The helpers below are the single writer so menu tiles do not drift into subtly
 * different JSON shapes.
 */
export const STUDIO_INSERT_DRAG_MAX_PAYLOAD_LENGTH = 4_096;

function hasExactKeys(
  candidate: Record<string, unknown>,
  expected: readonly string[]
): boolean {
  const actual = Object.keys(candidate);
  return actual.length === expected.length
    && expected.every((key) => Object.prototype.hasOwnProperty.call(candidate, key));
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export function parseStudioInsertDragPayload(
  value: string
): StudioInsertDragPayload | null {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > STUDIO_INSERT_DRAG_MAX_PAYLOAD_LENGTH
  ) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const candidate = parsed as Record<string, unknown>;
  if (
    candidate.kind === "text"
    && hasExactKeys(candidate, ["kind"])
  ) return { kind: "text" };
  if (
    candidate.kind === "bubble" &&
    hasExactKeys(candidate, ["kind", "variant"]) &&
    typeof candidate.variant === "string" &&
    BUBBLE_VARIANTS.some((variant) => variant.id === candidate.variant)
  ) {
    return { kind: "bubble", variant: candidate.variant as BubbleVariant };
  }
  if (
    candidate.kind === "sticker" &&
    hasExactKeys(candidate, ["kind", "emoji"]) &&
    typeof candidate.emoji === "string" &&
    candidate.emoji.trim().length > 0 &&
    candidate.emoji.length <= 32 &&
    !containsControlCharacter(candidate.emoji)
  ) {
    return { kind: "sticker", emoji: candidate.emoji };
  }
  return null;
}
