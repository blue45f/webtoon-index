import { describe, expect, it } from "vitest";

import {
  captureStudioAiGeneratedAssetProvenance,
  finalizeStudioAiGeneratedAssetProvenance,
} from "./studio-ai-generated-asset-model";

describe("studio AI generated asset request snapshot", () => {
  it("captures generated-image provider metadata and time as one immutable-value snapshot", () => {
    const context = {
      provider: "images.example.test",
      model: "toon-image-v2",
      transport: "byok" as const,
    };
    const snapshot = captureStudioAiGeneratedAssetProvenance(
      context,
      "generated",
      new Date("2026-07-19T03:04:05.000Z")
    );

    context.provider = "changed-after-request.example.test";
    context.model = "changed-after-request";

    expect(snapshot).toEqual({
      action: "generated",
      provider: "images.example.test",
      model: "toon-image-v2",
      transport: "byok",
      promptVersion: 1,
      createdAt: "2026-07-19T03:04:05.000Z",
    });
  });

  it("uses the same request snapshot contract for image edits and server generation", () => {
    expect(
      captureStudioAiGeneratedAssetProvenance(
        { provider: "openai", model: "gpt-image-2", transport: "server" },
        "edited",
        new Date("2026-07-19T04:05:06.000Z")
      )
    ).toEqual({
      action: "edited",
      provider: "openai",
      model: "gpt-image-2",
      transport: "server",
      promptVersion: 1,
      createdAt: "2026-07-19T04:05:06.000Z",
    });
  });

  it("accepts a response-authoritative server model without changing request-start metadata", () => {
    const captured = captureStudioAiGeneratedAssetProvenance(
      { provider: "openai", model: "image-model-alias", transport: "server" },
      "generated",
      new Date("2026-07-19T05:06:07.000Z")
    );

    expect(finalizeStudioAiGeneratedAssetProvenance(captured, { model: "gpt-image-2-2026-07" })).toEqual({
      ...captured,
      model: "gpt-image-2-2026-07",
      createdAt: "2026-07-19T05:06:07.000Z",
    });
    expect(finalizeStudioAiGeneratedAssetProvenance(captured, { model: "  " })).toBe(captured);
  });
});
