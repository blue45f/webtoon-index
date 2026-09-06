// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { compileStudioAiSuitePromptHandoff, createStudioAiSuitePromptHandoff } from "./studio-ai-suite-handoff";
import { consumeStudioAiSuperSuiteOpenRequest, requestStudioAiSuperSuiteOpen } from "./studio-ai-super-suite-intent";
import { StudioAiSuperSuiteGateway } from "./StudioAiSuperSuiteGateway";

import type { StudioAiSuitePromptHandoff } from "./studio-ai-suite-handoff";

vi.mock("./StudioAiSuperSuiteModal", () => ({
  StudioAiSuperSuiteModal: (props: { onClose: () => void; onApplyPrompt: (prompt: string) => void; onApplyPromptRecipe: (recipe: StudioAiSuitePromptHandoff) => void }) => (
    <section role="dialog" aria-label="Recipe dialog">
      <button onClick={props.onClose}>Close recipe</button>
      <button onClick={() => props.onApplyPrompt("an authored scene")}>Apply prompt</button>
      <button onClick={() => props.onApplyPromptRecipe(createStudioAiSuitePromptHandoff({ positivePrompt: "rainy alley", negativePrompt: "watermark", denoiseStrength: 0.65, recommendedSettings: { lineFactor: 1.6, contrast: 1.35, saturation: 1 } }))}>Apply recipe</button>
    </section>
  ),
}));
afterEach(() => { cleanup(); consumeStudioAiSuperSuiteOpenRequest(); vi.clearAllMocks(); });

describe("intent-owned AI recipe dialog", () => {
  it("stays closed until explicit intent and handles repeated open/close cycles", async () => {
    const apply = vi.fn();
    render(<StudioAiSuperSuiteGateway onApplyPrompt={apply} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => requestStudioAiSuperSuiteOpen());
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Close recipe" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => requestStudioAiSuperSuiteOpen());
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Apply prompt" }));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith("an authored scene");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("retains a pre-mount request across StrictMode replay and hands off every recipe control", async () => {
    requestStudioAiSuperSuiteOpen();
    const apply = vi.fn();
    render(<StrictMode><StudioAiSuperSuiteGateway onApplyPrompt={apply} /></StrictMode>);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Apply recipe" }));
    const expected = compileStudioAiSuitePromptHandoff(createStudioAiSuitePromptHandoff({ positivePrompt: "rainy alley", negativePrompt: "watermark", denoiseStrength: 0.65, recommendedSettings: { lineFactor: 1.6, contrast: 1.35, saturation: 1 } }));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(expected);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
  it("unsubscribes on unmount so a request is delivered to the next mounted gateway", async () => {
    const first = render(<StudioAiSuperSuiteGateway onApplyPrompt={vi.fn()} />);
    first.unmount();
    requestStudioAiSuperSuiteOpen();
    render(<StudioAiSuperSuiteGateway onApplyPrompt={vi.fn()} />);
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });
});
