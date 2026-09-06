import { describe, expect, it } from "vitest";

import { createEmptyStudioAiProvenanceDocument } from "./studio-ai-provenance";
import {
  parseStudioAiRequestedSize,
  recordPendingStudioAiOperation,
  recoverInterruptedStudioAiOperations,
  settleStudioAiOperation,
  studioAiProvenanceToPublishPack,
  studioImageAiProviderContext,
  studioTextAiProviderContext,
} from "./studio-ai-provenance-recorder";

const START = new Date("2026-07-10T00:00:00.000Z");
const END = new Date("2026-07-10T00:00:01.000Z");
const SECRET = "비공개 창작 프롬프트와 010-0000-0000";

function pending(kind: "text" | "image" = "text") {
  return recordPendingStudioAiOperation(
    createEmptyStudioAiProvenanceDocument(),
    {
      id: "operation-1",
      kind,
      task: kind === "text" ? "scenario" : "background-image",
      provider: "deepseek",
      model: kind === "text" ? "deepseek-chat" : "image-model",
      transport: kind === "text" ? "server" : "byok",
      promptVersion: 1,
      prompt: SECRET,
      target: { pageId: "private-page" },
      references: [],
    },
    START
  );
}

describe("Studio AI provenance recorder", () => {
  it.each([
    ["composition", "text"],
    ["scenario", "text"],
    ["translation", "text"],
    ["dialogue", "text"],
    ["palette", "text"],
    ["background-image", "image"],
    ["character-image", "image"],
    ["colorize", "image"],
    ["image-other", "image"],
  ] as const)("accepts the Studio integration lifecycle for %s", (task, kind) => {
    const started = recordPendingStudioAiOperation(
      createEmptyStudioAiProvenanceDocument(),
      {
        id: `operation-${task}`,
        kind,
        task,
        provider: kind === "text" ? "deepseek" : "images.example.test",
        model: kind === "text" ? "deepseek-chat" : "image-model",
        transport: kind === "text" ? "server" : "byok",
        promptVersion: 1,
        prompt: SECRET,
      },
      START
    );
    const completed = settleStudioAiOperation(started, `operation-${task}`, { ok: true }, { now: END });

    expect(started.operations[0]).toMatchObject({ task, kind, status: "pending" });
    expect(completed.operations[0]).toMatchObject({ task, kind, status: "succeeded" });
    expect(JSON.stringify(completed)).not.toContain(SECRET);
  });

  it("records a hash-only pending text operation and completes it with actual usage", () => {
    const started = pending();
    const completed = settleStudioAiOperation(
      started,
      "operation-1",
      { ok: true },
      {
        now: END,
        provider: "deepseek",
        model: "deepseek-chat-v2",
        usage: { promptTokens: 12, completionTokens: 8, totalTokens: 20 },
      }
    );

    expect(started.operations[0]).toMatchObject({ status: "pending", prompt: { retention: "hash-only" } });
    expect(completed.operations[0]).toMatchObject({
      status: "succeeded",
      provider: "deepseek",
      model: "deepseek-chat-v2",
      usage: { promptTokens: 12, completionTokens: 8, totalTokens: 20 },
    });
    expect(JSON.stringify(completed)).not.toContain(SECRET);
  });

  it("replaces the attempted provider/model with the provider/model that actually completed after failover", () => {
    const started = recordPendingStudioAiOperation(
      createEmptyStudioAiProvenanceDocument(),
      {
        id: "failover-operation",
        kind: "text",
        task: "scenario",
        provider: "zai",
        model: "glm-5.1",
        transport: "server",
        promptVersion: 1,
        prompt: SECRET,
      },
      START
    );
    const completed = settleStudioAiOperation(
      started,
      "failover-operation",
      { ok: true },
      {
        now: END,
        provider: "deepseek",
        model: "deepseek-v4-flash",
        usage: { totalTokens: 77 },
      }
    );

    expect(started.operations[0]).toMatchObject({
      status: "pending",
      provider: "zai",
      model: "glm-5.1",
    });
    expect(completed.operations[0]).toMatchObject({
      status: "succeeded",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      usage: { totalTokens: 77 },
    });
    expect(JSON.stringify(completed)).not.toContain(SECRET);
  });

  it("classifies provider failures without persisting provider error text", () => {
    const failed = settleStudioAiOperation(
      pending("image"),
      "operation-1",
      { ok: false, code: "http_error", error: `provider echoed ${SECRET}` } as never,
      { now: END }
    );

    expect(failed.operations[0]).toMatchObject({
      status: "failed",
      error: {
        category: "provider",
        code: "http_error",
        retriable: true,
      },
    });
    expect(JSON.stringify(failed)).not.toContain(SECRET);
  });

  it("marks an aborted image operation cancelled and never mislabels it as a network failure", () => {
    const cancelled = settleStudioAiOperation(
      pending("image"),
      "operation-1",
      { ok: false, code: "network_error" },
      { now: END, aborted: true }
    );

    expect(cancelled.operations[0]).toMatchObject({
      status: "cancelled",
      error: { category: "cancelled", code: "USER_CANCELLED", retriable: false },
    });
  });

  it("recovers persisted pending work as a privacy-safe interrupted-session cancellation", () => {
    const started = pending();
    const recovered = recoverInterruptedStudioAiOperations(started, END);

    expect(recovered.operations[0]).toMatchObject({
      status: "cancelled",
      error: {
        category: "cancelled",
        code: "SESSION_INTERRUPTED",
        retriable: true,
      },
      updatedAt: END.toISOString(),
    });
    expect(JSON.stringify(recovered)).not.toContain(SECRET);
  });

  it("does not rewrite already settled work during interrupted-session recovery", () => {
    const succeeded = settleStudioAiOperation(pending(), "operation-1", { ok: true }, { now: END });

    expect(recoverInterruptedStudioAiOperations(succeeded, new Date("2026-07-11T00:00:00.000Z")))
      .toBe(succeeded);
  });

  it("fails open when a bounded log rejects an invalid operation", () => {
    const empty = createEmptyStudioAiProvenanceDocument();
    const result = recordPendingStudioAiOperation(
      empty,
      {
        id: "bad",
        kind: "text",
        task: "background-image",
        provider: "provider",
        model: "model",
        transport: "server",
        promptVersion: 1,
        prompt: SECRET,
      },
      START
    );
    expect(result).toBe(empty);
  });

  it("derives provider context without retaining base URL credentials or query strings", () => {
    expect(studioImageAiProviderContext({
      baseUrl: "https://user:secret@images.example.test/v1?api_key=secret",
      imageModel: " image-v1 ",
    })).toEqual({ provider: "images.example.test", model: "image-v1", transport: "byok" });
    expect(studioTextAiProviderContext(
      { baseUrl: "https://unused.test", textModel: "unused" },
      { mode: "server" },
      { provider: "deepseek", model: "deepseek-chat" }
    )).toEqual({ provider: "deepseek", model: "deepseek-chat", transport: "server" });
    expect(studioTextAiProviderContext(
      { baseUrl: "not a URL with secret", textModel: "custom-chat" },
      { mode: "byok" }
    ).provider).toBe("custom");
  });

  it("parses only bounded requested image sizes", () => {
    expect(parseStudioAiRequestedSize("1024x1792")).toEqual({ width: 1024, height: 1792 });
    expect(parseStudioAiRequestedSize("0x1024")).toBeUndefined();
    expect(parseStudioAiRequestedSize("99999x1024")).toBeUndefined();
    expect(parseStudioAiRequestedSize("auto")).toBeUndefined();
  });

  it("projects Publish Pack history without private or correlating fields", () => {
    const document = settleStudioAiOperation(
      pending("image"),
      "operation-1",
      { ok: true },
      { now: END, target: { pageId: "private-page", elementId: "private-element" } }
    );
    const projection = studioAiProvenanceToPublishPack(document);
    const serialized = JSON.stringify(projection);

    expect(projection).toEqual([
      expect.objectContaining({
        action: "generated",
        provider: "deepseek",
        model: "image-model",
        transport: "byok",
        promptVersion: 1,
      }),
    ]);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain("private-page");
    expect(serialized).not.toContain("private-element");
    expect(serialized).not.toContain(document.operations[0].prompt.sha256);
  });
});
