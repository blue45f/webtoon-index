/**
 * Pure helpers for the finite commercial residual closeout batch
 * (selection badge · smart-shape match · presence dock).
 * No brand clones; unit-testable strings/maps only.
 */

export function studioSelectionBadgeText(
  selectionCount: number,
  selectionLabel: string | null
): string {
  if (selectionCount <= 0) return "";
  if (selectionCount > 1) return `${selectionCount}`;
  return selectionLabel?.trim() || "선택됨";
}

/** Multi-select shows numeric chip only; single keeps short label for scan. */
export function studioSelectionCountChip(selectionCount: number): string {
  if (selectionCount <= 0) return "0";
  if (selectionCount > 9) return "9+";
  return String(selectionCount);
}

export type StudioSmartShapeMatchKind =
  | "line"
  | "rect"
  | "circle"
  | "triangle"
  | "poly"
  | null;

/** Map Korean recognition labels → glyph id for smart-shape row highlight. */
export function studioSmartShapeMatchToGlyph(
  matchedKindLabel: string | null | undefined
): StudioSmartShapeMatchKind {
  if (!matchedKindLabel) return null;
  const t = matchedKindLabel.trim();
  if (t.includes("선") && !t.includes("다각")) return "line";
  if (t.includes("사각") || t.includes("네모")) return "rect";
  if (t.includes("원") || t.includes("타원") || t.includes("동그")) return "circle";
  if (t.includes("삼각")) return "triangle";
  if (t.includes("다각") || t.includes("오각") || t.includes("육각")) return "poly";
  return null;
}

export function studioPresenceConnectionLabel(connected: boolean): string {
  return connected ? "실시간 공동작업 연결됨" : "실시간 공동작업 다시 연결 중";
}

export function studioPresenceOverflowLabel(hiddenCount: number): string | null {
  if (hiddenCount <= 0) return null;
  return `+${hiddenCount}`;
}

/** Cap avatar stack for presence strip density. */
export function studioPresenceVisiblePeerCount(
  totalPeers: number,
  maxVisible = 5
): number {
  if (totalPeers <= 0) return 0;
  return Math.min(maxVisible, totalPeers);
}

/** Live collab HUD: peer count chip when room is active (always-on presence cue). */
export function studioLivePresenceHudLabel(
  availability: "idle" | "connecting" | "ready" | "unsupported" | "error",
  peerCount: number
): string | null {
  if (availability === "idle" || availability === "unsupported") return null;
  if (availability === "connecting") return "연결 중";
  if (availability === "error") return "연결 오류";
  const n = Math.max(0, Math.floor(peerCount));
  if (n <= 0) return "라이브";
  return `라이브 · ${n}`;
}

export function studioLivePresenceAlwaysVisible(
  availability: "idle" | "connecting" | "ready" | "unsupported" | "error",
  peerCount: number
): boolean {
  if (peerCount > 0) return true;
  return availability === "connecting" || availability === "ready" || availability === "error";
}
