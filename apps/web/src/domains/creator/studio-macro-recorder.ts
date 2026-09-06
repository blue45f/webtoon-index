/**
 * Session macro recorder — high-level allowlisted commands only (no pointer streams).
 * Auto Action conversion lives in studio-macro-to-auto-actions.ts so StudioPage can keep
 * the heavy auto-actions module out of the static Studio route chunk.
 */

export const STUDIO_MACRO_RECORDER_VERSION = 1 as const;
export const STUDIO_MACRO_MAX_COMMANDS = 80;

export type StudioMacroCommand =
  | { type: "set-opacity"; opacity: number }
  | { type: "set-hidden"; hidden: boolean }
  | { type: "set-locked"; locked: boolean }
  | { type: "set-blend-mode"; blendMode: string }
  | { type: "lettering-font-size"; fontSize: number }
  | { type: "lettering-color"; color: string }
  | { type: "lettering-font"; font: string }
  | { type: "page-set-background"; background: { kind: "solid"; color: string } | { kind: "gradient"; colors: [string, string] } }
  | { type: "page-apply-grade-preset"; preset: string };

export interface StudioMacroSession {
  version: typeof STUDIO_MACRO_RECORDER_VERSION;
  recording: boolean;
  startedAt: number | null;
  commands: readonly StudioMacroCommand[];
  name: string;
}

export function createStudioMacroSession(name = "녹음 매크로"): StudioMacroSession {
  return {
    version: STUDIO_MACRO_RECORDER_VERSION,
    recording: false,
    startedAt: null,
    commands: [],
    name: typeof name === "string" && name.trim() ? name.trim().slice(0, 80) : "녹음 매크로",
  };
}

export function startStudioMacroRecording(
  session: StudioMacroSession,
  now = Date.now()
): StudioMacroSession {
  return {
    ...session,
    recording: true,
    startedAt: now,
    commands: [],
  };
}

export function stopStudioMacroRecording(session: StudioMacroSession): StudioMacroSession {
  return { ...session, recording: false };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

export function normalizeStudioMacroCommand(value: unknown): StudioMacroCommand | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  switch (record.type) {
    case "set-opacity":
      return { type: "set-opacity", opacity: clamp01(Number(record.opacity)) };
    case "set-hidden":
      return { type: "set-hidden", hidden: record.hidden === true };
    case "set-locked":
      return { type: "set-locked", locked: record.locked === true };
    case "set-blend-mode":
      return {
        type: "set-blend-mode",
        blendMode: typeof record.blendMode === "string" ? record.blendMode.slice(0, 40) : "source-over",
      };
    case "lettering-font-size": {
      const fontSize = Number(record.fontSize);
      if (!Number.isFinite(fontSize)) return null;
      return { type: "lettering-font-size", fontSize: Math.min(200, Math.max(6, fontSize)) };
    }
    case "lettering-color": {
      const color = typeof record.color === "string" ? record.color.trim().toLowerCase() : "#202020";
      return {
        type: "lettering-color",
        color: /^#(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.test(color) ? color : "#202020",
      };
    }
    case "lettering-font": {
      const font = typeof record.font === "string" ? record.font.trim() : "";
      if (!font || font.length > 120) return null;
      return { type: "lettering-font", font };
    }
    case "page-set-background": {
      if (!record.background || typeof record.background !== "object") return null;
      const bg = record.background as Record<string, unknown>;
      if (bg.kind === "solid") {
        const color = typeof bg.color === "string" ? bg.color.trim().toLowerCase() : "#ffffff";
        if (!/^#(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.test(color)) return null;
        return { type: "page-set-background", background: { kind: "solid", color } };
      } else if (bg.kind === "gradient") {
        if (!Array.isArray(bg.colors) || bg.colors.length !== 2) return null;
        const c1 = typeof bg.colors[0] === "string" ? bg.colors[0].trim().toLowerCase() : "#ffffff";
        const c2 = typeof bg.colors[1] === "string" ? bg.colors[1].trim().toLowerCase() : "#ffffff";
        if (!/^#(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.test(c1)) return null;
        if (!/^#(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.test(c2)) return null;
        return { type: "page-set-background", background: { kind: "gradient", colors: [c1, c2] } };
      }
      return null;
    }
    case "page-apply-grade-preset": {
      const preset = typeof record.preset === "string" ? record.preset.trim() : "";
      const validPresets = ["neutral", "recall", "night", "dawn", "dusk", "horror", "dreamy", "mono-manuscript", "rainy", "warm-afternoon"];
      if (!validPresets.includes(preset)) return null;
      return { type: "page-apply-grade-preset", preset };
    }
    default:
      return null;
  }
}

export function recordStudioMacroCommand(
  session: StudioMacroSession,
  command: unknown
): StudioMacroSession {
  if (!session.recording) return session;
  const normalized = normalizeStudioMacroCommand(command);
  if (!normalized) return session;
  if (session.commands.length >= STUDIO_MACRO_MAX_COMMANDS) return session;
  return {
    ...session,
    commands: [...session.commands, normalized],
  };
}
