import { describe, expect, it } from "vitest";

import {
  activatePlugin,
  checkPluginPermission,
  createPluginRegistry,
  deactivatePlugin,
  deserializeBridgeMessage,
  dispatchPluginLifecycleEvent,
  registerPluginManifest,
  serializeBridgeMessage,
  type StudioPluginManifest,
} from "./studio-plugin-sdk-bridge";

describe("Studio Plugin Extension SDK & Runtime Bridge", () => {
  const samplePlugin: StudioPluginManifest = {
    id: "com.example.speedline-pro",
    name: "Speedline Pro Generator",
    version: "1.2.0",
    author: "ToonDev",
    description: "고급 속도선 생성기",
    permissions: ["canvas:read", "canvas:write", "ui:custom-panel"],
    contributedTools: [
      { id: "tool_speedline", name: "속도선 펜", type: "generator", iconName: "zap", defaultShortcut: "Alt+S" },
    ],
    contributedPanels: [
      { id: "panel_speedline_opt", title: "속도선 옵션", location: "right-inspector" },
    ],
    entrypointUri: "https://plugins.toonspectrum.com/speedline-pro/index.js",
  };

  it("registers, activates, and deactivates plugins", () => {
    let reg = createPluginRegistry();
    reg = registerPluginManifest(reg, samplePlugin);

    expect(reg.plugins).toHaveLength(1);
    expect(reg.activePluginIds).toHaveLength(0);

    // Activate
    reg = activatePlugin(reg, "com.example.speedline-pro");
    expect(reg.activePluginIds).toContain("com.example.speedline-pro");

    // Deactivate
    reg = deactivatePlugin(reg, "com.example.speedline-pro");
    expect(reg.activePluginIds).not.toContain("com.example.speedline-pro");
  });

  it("checks plugin permissions accurately", () => {
    expect(checkPluginPermission(samplePlugin, "canvas:read")).toBe(true);
    expect(checkPluginPermission(samplePlugin, "canvas:write")).toBe(true);
    expect(checkPluginPermission(samplePlugin, "network:fetch")).toBe(false); // not declared
  });

  it("dispatches lifecycle events to active plugins", () => {
    let reg = createPluginRegistry();
    reg = registerPluginManifest(reg, samplePlugin);
    reg = activatePlugin(reg, "com.example.speedline-pro");

    const events = dispatchPluginLifecycleEvent(
      reg,
      "onBeforeExport",
      { episodeId: "ep_1", format: "naver-webtoon" },
      1_700_000_000_000,
    );

    expect(events).toHaveLength(1);
    expect(events[0].pluginId).toBe("com.example.speedline-pro");
    expect(events[0].action).toBe("onBeforeExport");
    expect(events[0].payload.format).toBe("naver-webtoon");
  });

  it("serializes and deserializes bridge messages", () => {
    const raw = serializeBridgeMessage({
      pluginId: "plugin_1",
      type: "command-request",
      action: "generate-lines",
      payload: { density: 0.8 },
      timestampMs: 1_000,
    });

    const parsed = deserializeBridgeMessage(raw);
    expect(parsed.pluginId).toBe("plugin_1");
    expect(parsed.action).toBe("generate-lines");
    expect(parsed.payload.density).toBe(0.8);
  });
});
