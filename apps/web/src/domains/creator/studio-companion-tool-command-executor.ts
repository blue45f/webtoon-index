/**
 * Primary editor transition boundary for tool commands sent by a Studio companion.
 *
 * The companion protocol transports intent only. The primary owns every armed pixel tool and every
 * in-flight stroke, so a select/pen/eraser transition must run the exact same stroke-safe transition
 * the local rail, tool belt, and keyboard use — otherwise the same command means different things
 * depending on which surface issued it. The transition is injected to keep this module independent
 * of React, DOM, and the companion runtime.
 */

import type { DrawMode } from "./studio-editor-tool-model";
import type { StudioCompanionCommandName } from "./studio-tools-companion";

export interface StudioCompanionToolCommandActions {
  /** Cancels an unfinished stroke, disarms every pixel tool (eyedropper included), then commits. */
  activatePrimaryCanvasTool: (tool: "select" | "draw", drawMode?: DrawMode) => void;
}

export interface StudioCompanionToolCommandExecution {
  readonly handled: boolean;
}

const HANDLED: StudioCompanionToolCommandExecution = Object.freeze({ handled: true });
const NOT_HANDLED: StudioCompanionToolCommandExecution = Object.freeze({ handled: false });

/**
 * Executes companion tool commands through the primary editor's canonical tool transition.
 * Non-tool commands are left to the caller's existing command router.
 */
export function executeStudioCompanionToolCommand(
  command: StudioCompanionCommandName,
  actions: StudioCompanionToolCommandActions
): StudioCompanionToolCommandExecution {
  switch (command) {
    case "select":
      actions.activatePrimaryCanvasTool("select");
      return HANDLED;
    case "pen":
      actions.activatePrimaryCanvasTool("draw", "pen");
      return HANDLED;
    case "eraser":
      actions.activatePrimaryCanvasTool("draw", "eraser");
      return HANDLED;
    default:
      return NOT_HANDLED;
  }
}
