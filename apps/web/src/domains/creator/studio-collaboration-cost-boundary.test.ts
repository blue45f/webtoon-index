import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("studio collaboration cost boundary", () => {
  it("keeps microphone calling out of all reachable collaboration surfaces", () => {
    const reachableSource = [
      "./live/StudioLiveCollaborationProvider.tsx",
      "./live/studio-live-collaboration-context.ts",
      "./live/StudioLiveCollaborationPanel.tsx",
      "./live/StudioLiveCanvasOverlay.tsx",
    ].map(source).join("\n");

    expect(reachableSource).not.toMatch(/StudioVoiceCall|studio-voice-call|getUserMedia/u);
    expect(reachableSource).not.toContain("음성 작업실");
  });

  it("exposes only the screen-share ICE credential route", () => {
    const controllerSource = source(
      "../../../apps/api/src/modules/creator/studio-voice-ice-policy.controller.ts"
    );

    expect(controllerSource).toContain("/creator/works/:id/screen-share/ice");
    expect(controllerSource).not.toContain("/creator/works/:id/voice/ice");
  });
});
