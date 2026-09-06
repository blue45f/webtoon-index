export const STUDIO_TOOL_HINT_MODES = ["compact", "rich", "off"] as const;

export type StudioToolHintMode = (typeof STUDIO_TOOL_HINT_MODES)[number];

export const DEFAULT_STUDIO_TOOL_HINT_MODE: StudioToolHintMode = "rich";
export const DEFAULT_STUDIO_TOOL_HINT_TOUCH_HOLD_MS = 480;
export const MIN_STUDIO_TOOL_HINT_TOUCH_HOLD_MS = 300;
export const MAX_STUDIO_TOOL_HINT_TOUCH_HOLD_MS = 900;

export function normalizeStudioToolHintMode(
  value: unknown,
  legacyEnabled?: unknown
): StudioToolHintMode {
  if (typeof value === "string" && STUDIO_TOOL_HINT_MODES.includes(value as StudioToolHintMode)) {
    return value as StudioToolHintMode;
  }
  if (legacyEnabled === false) return "off";
  return DEFAULT_STUDIO_TOOL_HINT_MODE;
}

export function normalizeStudioToolHintTouchHoldMs(value: unknown): number {
  const numeric = typeof value === "number" && Number.isFinite(value)
    ? value
    : DEFAULT_STUDIO_TOOL_HINT_TOUCH_HOLD_MS;
  return Math.round(
    Math.min(
      MAX_STUDIO_TOOL_HINT_TOUCH_HOLD_MS,
      Math.max(MIN_STUDIO_TOOL_HINT_TOUCH_HOLD_MS, numeric)
    ) / 20
  ) * 20;
}

export function studioToolHintModeLabel(
  mode: StudioToolHintMode,
  t?: (key: string) => string
): string {
  if (t) {
    if (mode === "compact") return t("studio.settings.toolHintMode.compact");
    if (mode === "rich") return t("studio.settings.toolHintMode.rich");
    return t("studio.settings.toolHintMode.off");
  }
  switch (mode) {
    case "compact":
      return "간단";
    case "rich":
      return "동작 미리보기";
    case "off":
      return "끔";
  }
}
