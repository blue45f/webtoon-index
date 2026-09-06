import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const panelSource = readFileSync(
  new URL("./StudioLiveCollaborationPanel.tsx", import.meta.url),
  "utf8"
);

describe("Studio live collaboration command center integration", () => {
  it("keeps the command center inside the existing authoritative team panel", () => {
    expect(panelSource).toContain(
      'import { StudioLiveCollaborationCommandCenter } from "./StudioLiveCollaborationCommandCenter";'
    );
    expect(panelSource).toContain("<StudioLiveCollaborationCommandCenter");
    expect(panelSource).toContain("availability={availability}");
    expect(panelSource).toContain("chatMessages={chatMessages}");
    expect(panelSource).toContain("screenState={screenState}");
    expect(panelSource).toContain("syncSnapshot={syncSnapshot}");
    expect(panelSource).toContain("recovery={recovery}");
  });

  it("provides focusable direct destinations for people, chat, screen sharing, and sync safety", () => {
    expect(panelSource).toContain('id="studio-live-people-section"');
    expect(panelSource).toContain('id="studio-live-chat-section"');
    expect(panelSource).toContain('id="studio-live-screen-section"');
    expect(panelSource).toContain('id="studio-live-sync-section"');
    expect(panelSource.match(/tabIndex=\{-1\}/gu)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });
});
