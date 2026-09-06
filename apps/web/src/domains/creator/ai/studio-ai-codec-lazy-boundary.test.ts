import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./studio-ai-client.ts", import.meta.url),
  "utf8",
);

function functionSource(startToken: string, endToken: string): string {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start + startToken.length);
  if (start < 0 || end <= start) {
    throw new Error(`Missing AI codec boundary: ${startToken} -> ${endToken}`);
  }
  return source.slice(start, end);
}

describe("Studio AI on-demand codec boundary", () => {
  it("keeps scenario planning validation ahead of its optional prompt codec", () => {
    const generateScenario = functionSource(
      "export async function generateScenarioScenes",
      "export async function generateStudioWriterRoomDraft",
    );

    expect(source).toContain(
      'import type { ScenarioScenesPlan } from "../studio-scenario-scenes";',
    );
    expect(source).not.toMatch(
      /import\s*{[\s\S]*?buildScenarioScenesPrompt[\s\S]*?}\s*from\s*"\.\/studio-scenario-scenes"/,
    );
    expect(generateScenario).toContain(
      'import("../studio-scenario-scenes")',
    );
    expect(generateScenario.indexOf("if (!trimmed)")).toBeLessThan(
      generateScenario.indexOf("loadOptionalStudioAiCodec(importScenarioCodec"),
    );
    expect(
      generateScenario.indexOf(
        "if (!isStudioTextAiConfigured(settings, transport))",
      ),
    ).toBeLessThan(
      generateScenario.indexOf("loadOptionalStudioAiCodec(importScenarioCodec"),
    );
    expect(generateScenario).toContain(
      "loadOptionalStudioAiCodec(importScenarioCodec, signal)",
    );
    expect(generateScenario).toContain(
      'return { ok: false, code: "network_error", error: networkErrorMessage(error) };',
    );
  });

  it("loads palette prompt parsing only for a configured palette request", () => {
    const suggestPalette = functionSource(
      "export async function suggestColorPalette",
      "export async function testAiConnection",
    );

    expect(source).toContain(
      'import type { PaletteSuggestion } from "../studio-palette-suggest";',
    );
    expect(source).not.toMatch(
      /import\s*{[\s\S]*?buildPaletteSuggestPrompt[\s\S]*?}\s*from\s*"\.\/studio-palette-suggest"/,
    );
    expect(suggestPalette).toContain(
      'import("../studio-palette-suggest")',
    );
    expect(suggestPalette.indexOf("if (!trimmed)")).toBeLessThan(
      suggestPalette.indexOf("loadOptionalStudioAiCodec(importPaletteCodec"),
    );
    expect(
      suggestPalette.indexOf(
        "if (!isStudioTextAiConfigured(settings, transport))",
      ),
    ).toBeLessThan(
      suggestPalette.indexOf("loadOptionalStudioAiCodec(importPaletteCodec"),
    );
    expect(suggestPalette).toContain(
      "loadOptionalStudioAiCodec(importPaletteCodec, transport.signal)",
    );
    expect(suggestPalette).toContain(
      'return { ok: false, code: "network_error", error: networkErrorMessage(error) };',
    );
  });
});
