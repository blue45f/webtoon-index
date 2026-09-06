// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, test } from "vitest";

import { HOME_COPY } from "./creator-home-content";
import { CreatorWorkflowPicker } from "./CreatorWorkflowPicker";

afterEach(cleanup);

function Harness() {
  const [stage, setStage] = useState(0);
  return <>
    <CreatorWorkflowPicker copy={HOME_COPY.ko} stage={stage} onChange={setStage} />
    <CreatorWorkflowPicker copy={HOME_COPY.ko} stage={stage} onChange={setStage} placement="process" />
    <p id="creator-stage-description">{HOME_COPY.ko.stages[stage].id}</p>
  </>;
}

test("both visible workflow pickers share selection without duplicating destination IDs", () => {
  const { container } = render(<Harness />);
  const preview = container.querySelectorAll<HTMLButtonElement>(".ch-preview-options button");
  const process = container.querySelectorAll<HTMLButtonElement>(".ch-process-options button");
  fireEvent.click(process[1]);
  assert.equal(preview[1].getAttribute("aria-pressed"), "true");
  assert.equal(process[1].getAttribute("aria-pressed"), "true");
  assert.equal(container.querySelector("#creator-stage-description")?.textContent, "comic");
  fireEvent.click(preview[2]);
  assert.equal(process[2].getAttribute("aria-pressed"), "true");
  assert.equal(process[1].getAttribute("aria-pressed"), "false");
  assert.equal(container.querySelectorAll("#creator-stage-description").length, 1);
});

test("keyboard selection moves focus only within the currently operated picker", () => {
  const { container } = render(<Harness />);
  const process = container.querySelectorAll<HTMLButtonElement>(".ch-process-options button");
  process[0].focus();
  fireEvent.keyDown(process[0], { key: "End" });
  assert.equal(document.activeElement, process[2]);
  assert.equal(process[2].getAttribute("aria-pressed"), "true");
  fireEvent.keyDown(process[2], { key: "ArrowRight" });
  assert.equal(document.activeElement, process[0]);
  fireEvent.keyDown(process[0], { key: "ArrowLeft" });
  assert.equal(document.activeElement, process[2]);
  fireEvent.keyDown(process[2], { key: "Home" });
  assert.equal(document.activeElement, process[0]);
  assert.equal(process[0].getAttribute("aria-pressed"), "true");
});

test("browser navigation modifiers and Tab do not select another workflow", () => {
  const { container } = render(<Harness />);
  const process = container.querySelectorAll<HTMLButtonElement>(".ch-process-options button");
  process[0].focus();
  assert.equal(fireEvent.keyDown(process[0], { key: "ArrowLeft", altKey: true }), true);
  assert.equal(fireEvent.keyDown(process[0], { key: "Tab" }), true);
  assert.equal(document.activeElement, process[0]);
  assert.equal(process[0].getAttribute("aria-pressed"), "true");
});
