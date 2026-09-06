// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  consumeStudioAiEpisodeProductionOpenRequest,
  requestStudioAiEpisodeProductionOpen,
} from "./studio-ai-episode-production-intent";
import { StudioAiEpisodeProductionGateway } from "./StudioAiEpisodeProductionGateway";

vi.mock("./StudioAiEpisodeProductionModal", () => ({
  StudioAiEpisodeProductionModal: (props: {
    onClose: () => void;
    onApplyPrompt: (prompt: string) => void;
  }) => (
    <section role="dialog" aria-label="Episode director">
      <button onClick={props.onClose}>Close director</button>
      <button onClick={() => props.onApplyPrompt("first batch prompt")}>Apply batch</button>
    </section>
  ),
}));

afterEach(() => {
  cleanup();
  consumeStudioAiEpisodeProductionOpenRequest();
  vi.clearAllMocks();
});

describe("intent-owned AI episode production director", () => {
  it("stays closed until explicit intent and handles repeated open/close cycles", async () => {
    const apply = vi.fn();
    render(<StudioAiEpisodeProductionGateway onApplyPrompt={apply} />);
    expect(screen.queryByRole("dialog")).toBeNull();

    act(() => requestStudioAiEpisodeProductionOpen());
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Close director" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    act(() => requestStudioAiEpisodeProductionOpen());
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Apply batch" }));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith("first batch prompt");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("retains a pre-mount request across StrictMode replay", async () => {
    requestStudioAiEpisodeProductionOpen();
    render(
      <StrictMode>
        <StudioAiEpisodeProductionGateway onApplyPrompt={vi.fn()} />
      </StrictMode>
    );
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("unsubscribes on unmount so a request is delivered to the next mounted gateway", async () => {
    const first = render(<StudioAiEpisodeProductionGateway onApplyPrompt={vi.fn()} />);
    first.unmount();
    requestStudioAiEpisodeProductionOpen();
    render(<StudioAiEpisodeProductionGateway onApplyPrompt={vi.fn()} />);
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });
});
