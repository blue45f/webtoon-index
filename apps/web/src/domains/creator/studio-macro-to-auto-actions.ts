/**
 * Convert a finished macro session into an Auto Action set.
 * Kept separate from studio-macro-recorder so Studio static chunk does not pull zod/auto-actions.
 */

import {
  STUDIO_AUTO_ACTION_BLEND_MODES,
  normalizeStudioAutoActionSet,
  type StudioAutoActionCommand,
  type StudioAutoActionSet,
} from "./studio-auto-actions";

import type { StudioMacroCommand, StudioMacroSession } from "./studio-macro-recorder";

function macroCommandToAutoAction(
  command: StudioMacroCommand,
  index: number
): StudioAutoActionCommand | null {
  const id = `macro-${index + 1}`;
  switch (command.type) {
    case "set-opacity":
      return { id, enabled: true, type: "element.set-opacity", opacity: command.opacity };
    case "set-hidden":
      return { id, enabled: true, type: "element.set-hidden", hidden: command.hidden };
    case "set-locked":
      return { id, enabled: true, type: "element.set-locked", locked: command.locked };
    case "set-blend-mode": {
      const blendMode = (STUDIO_AUTO_ACTION_BLEND_MODES as readonly string[]).includes(command.blendMode)
        ? (command.blendMode as (typeof STUDIO_AUTO_ACTION_BLEND_MODES)[number])
        : "source-over";
      return { id, enabled: true, type: "element.set-blend-mode", blendMode };
    }
    case "lettering-font-size":
      return { id, enabled: true, type: "lettering.set-size", fontSize: command.fontSize };
    case "lettering-color":
      return { id, enabled: true, type: "lettering.set-color", color: command.color };
    case "lettering-font":
      return { id, enabled: true, type: "lettering.set-font", font: command.font };
    case "page-set-background":
      return { id, enabled: true, type: "page.set-background", background: command.background };
    case "page-apply-grade-preset": {
      const preset = command.preset as
        | "neutral"
        | "recall"
        | "night"
        | "dawn"
        | "dusk"
        | "horror"
        | "dreamy"
        | "mono-manuscript"
        | "rainy"
        | "warm-afternoon";
      return { id, enabled: true, type: "page.apply-grade-preset", preset };
    }
    default:
      return null;
  }
}

/** Convert a finished recording into an Auto Action set for dry-run/apply. */
export function studioMacroSessionToAutoActionSet(session: StudioMacroSession): StudioAutoActionSet {
  const commands: StudioAutoActionCommand[] = [];
  session.commands.forEach((command, index) => {
    const action = macroCommandToAutoAction(command, index);
    if (action) commands.push(action);
  });
  if (commands.length === 0) {
    commands.push({
      id: "macro-empty-1",
      enabled: false,
      type: "element.set-opacity",
      opacity: 1,
    });
  }
  return normalizeStudioAutoActionSet({
    kind: "toonspectrum-studio-auto-actions",
    version: 1,
    id: `macro-set-${session.startedAt ?? 0}`,
    name: session.name,
    commands,
  });
}
