import { describe, expect, it } from "vitest";

import {
  findStudioAiAssistTool,
  loadStudioAiRecentPrompts,
  normalizeStudioAiRecentPrompts,
  presetsForAssistTool,
  pushStudioAiRecentPrompt,
  recentPromptsForTool,
  rememberStudioAiRecentPrompt,
  STUDIO_AI_ASSIST_TOOLS,
  STUDIO_AI_BG_PROMPT_PRESETS,
} from "./studio-ai-assist-ux";

describe("studio-ai-assist-ux", () => {
  it("lists assist tools with unique ids", () => {
    const ids = STUDIO_AI_ASSIST_TOOLS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("background");
    expect(ids).toContain("dialogue");
  });

  it("returns presets per tool", () => {
    expect(presetsForAssistTool("background").length).toBeGreaterThanOrEqual(4);
    expect(presetsForAssistTool("composition").some((p) => p.id === "entrance")).toBe(true);
    expect(STUDIO_AI_BG_PROMPT_PRESETS[0]!.prompt.length).toBeGreaterThan(10);
  });

  it("remembers recent prompts MRU and filters by tool", () => {
    let state = rememberStudioAiRecentPrompt(
      { version: 1, entries: [] },
      "background",
      "교실 배경"
    );
    state = rememberStudioAiRecentPrompt(state, "dialogue", "어색한 인사");
    state = rememberStudioAiRecentPrompt(state, "background", "교실 배경");
    expect(state.entries[0]!.prompt).toBe("교실 배경");
    expect(recentPromptsForTool(state, "background")).toEqual(["교실 배경"]);
  });

  it("persists recent prompts via storage", () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
    };
    pushStudioAiRecentPrompt(storage, "palette", "봄 파스텔", 100);
    const loaded = loadStudioAiRecentPrompts(storage);
    expect(loaded.entries[0]?.prompt).toBe("봄 파스텔");
    expect(normalizeStudioAiRecentPrompts(null).entries).toEqual([]);
  });

  it("finds tool meta", () => {
    expect(findStudioAiAssistTool("composition")?.label).toContain("구도");
    expect(findStudioAiAssistTool("nope")).toBeNull();
  });
});
