// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { STUDIO_AI_DEFAULT_SETTINGS } from "./studio-ai-client";
import { StudioAiCompositionPanel } from "./StudioAiCompositionPanel";

const { suggestSceneCompositionMock } = vi.hoisted(() => ({
  suggestSceneCompositionMock: vi.fn(),
}));

vi.mock("./studio-ai-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./studio-ai-client")>();
  return {
    ...actual,
    suggestSceneComposition: suggestSceneCompositionMock,
  };
});

const OPERATION_ID = "composition-00000000-0000-4000-8000-000000000031";

beforeEach(() => {
  suggestSceneCompositionMock.mockReset();
  suggestSceneCompositionMock.mockResolvedValue({
    ok: true,
    data: {
      suggestion: "미디엄샷",
      textProvenance: {
        provider: "zai",
        model: "glm-5.1",
        transport: "server",
        promptVersion: 1,
        createdAt: "2026-07-22T00:00:00.000Z",
      },
    },
  });
});

afterEach(cleanup);

describe("StudioAiCompositionPanel server operation identity", () => {
  it("binds the tracked operation ID to the server request and settlement", async () => {
    const onOperationStart = vi.fn(() => OPERATION_ID);
    const onOperationSettled = vi.fn();
    render(
      <StudioAiCompositionPanel
        settings={STUDIO_AI_DEFAULT_SETTINGS}
        transport={{ mode: "server", provider: "zai" }}
        configured
        onOperationStart={onOperationStart}
        onOperationSettled={onOperationSettled}
      />
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "비 오는 옥상" } });
    fireEvent.click(screen.getByRole("button", { name: "구도 제안 받기" }));

    await waitFor(() => expect(suggestSceneCompositionMock).toHaveBeenCalledOnce());
    expect(onOperationStart).toHaveBeenCalledWith("비 오는 옥상");
    expect(suggestSceneCompositionMock).toHaveBeenCalledWith(
      STUDIO_AI_DEFAULT_SETTINGS,
      "비 오는 옥상",
      { mode: "server", provider: "zai", operationId: OPERATION_ID }
    );
    expect(onOperationSettled).toHaveBeenCalledWith(expect.objectContaining({
      operationId: OPERATION_ID,
      result: expect.objectContaining({ ok: true }),
    }));
  });
});
