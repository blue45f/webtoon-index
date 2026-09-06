import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createStudioCommandExecutionBindings,
  getStudioCommandExecutionBindings,
  installStudioCommandExecutionBindings,
  resetStudioCommandExecutionBindingsForTests,
  subscribeStudioCommandExecutionBindings,
} from "./studio-command-execution-registry";

afterEach(resetStudioCommandExecutionBindingsForTests);

describe("studio command execution registry", () => {
  it("publishes only explicitly opted-in, non-dangerous menu rows", () => {
    const execute = vi.fn();
    const bindings = createStudioCommandExecutionBindings([
      {
        items: [
          { commandId: "filter.blur", label: "블러", onSelect: execute, searchActivation: "execute" },
          { commandId: "file.publish", label: "게시", onSelect: vi.fn() },
          {
            commandId: "edit.delete",
            label: "삭제",
            onSelect: vi.fn(),
            searchActivation: "execute",
            danger: true,
          },
        ],
      },
    ]);

    expect(bindings.map((binding) => binding.commandId)).toEqual(["filter.blur"]);
    expect(bindings[0]?.execute).toBe(execute);
  });

  it("keeps the first duplicate CommandId and exposes live disabled reasons", () => {
    const first = vi.fn();
    const bindings = createStudioCommandExecutionBindings([
      {
        items: [
          {
            commandId: "filter.blur",
            label: "블러",
            onSelect: first,
            searchActivation: "execute",
            disabled: true,
            unavailableReason: "이미지를 선택하세요.",
          },
          {
            commandId: "filter.blur",
            label: "중복",
            onSelect: vi.fn(),
            searchActivation: "execute",
          },
        ],
      },
    ]);

    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toMatchObject({
      label: "블러",
      disabled: true,
      unavailableReason: "이미지를 선택하세요.",
    });
    expect(bindings[0]?.execute).toBe(first);
  });

  it("notifies subscribers and ignores stale installation cleanup", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeStudioCommandExecutionBindings(listener);
    const disposeFirst = installStudioCommandExecutionBindings([
      { commandId: "view.fit", label: "맞춤", execute: vi.fn(), disabled: false },
    ]);
    const disposeSecond = installStudioCommandExecutionBindings([
      { commandId: "filter.blur", label: "블러", execute: vi.fn(), disabled: false },
    ]);

    disposeFirst();
    expect([...getStudioCommandExecutionBindings().keys()]).toEqual(["filter.blur"]);
    disposeSecond();
    expect(getStudioCommandExecutionBindings().size).toBe(0);
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
  });
});
