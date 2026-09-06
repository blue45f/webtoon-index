import { describe, expect, it, vi } from "vitest";

import {
  useStudioSelectionTransform as createStudioSelectionTransform,
} from "./studio-selection-transform-controller";

import type { StudioSelectionTransformOptions } from "./studio-selection-transform-controller";
import type { El, ImageEl } from "../studio-element-model";

function image(id: string, x: number, overrides: Partial<ImageEl> = {}): ImageEl {
  return {
    id,
    type: "image",
    src: "data:image/png;base64,AA==",
    x,
    y: 0,
    width: 40,
    height: 20,
    rotation: 0,
    ...overrides,
  } as ImageEl;
}

function setup(elements: El[], marqueeIds: string[]) {
  const commit = vi.fn(() => true);
  const commitCoalesced = vi.fn();
  const patchEl = vi.fn();
  const setError = vi.fn();
  const announceDrawingShortcut = vi.fn();
  const options: StudioSelectionTransformOptions = {
    elements,
    selectedId: null,
    selected: null,
    marqueeIds,
    groups: [],
    activeGroupIdRef: { current: null },
    canvasH: 2_000,
    completeSelectedGroupId: () => null,
    commit,
    commitCoalesced,
    patchEl,
    reorderSelectedElements: vi.fn(),
    setError,
    announceDrawingShortcut,
  };
  return {
    transform: createStudioSelectionTransform(options),
    commit,
    commitCoalesced,
    patchEl,
    setError,
    announceDrawingShortcut,
  };
}

describe("studio selection transform controller", () => {
  it("refuses numeric transforms that include a hidden member", () => {
    const a = image("a", 0);
    const b = { ...image("b", 60), hidden: true } as El;
    const { transform, commit, setError } = setup([a, b], ["a", "b"]);

    transform.applyFigmaSelectionLayoutPatch({ width: 160 });

    expect(commit).not.toHaveBeenCalled();
    expect(setError).toHaveBeenCalledWith(expect.stringContaining("숨긴 레이어"));
  });

  it("commits one atomic group resize and announces the completed action", () => {
    const a = image("a", 0);
    const b = image("b", 60);
    const { transform, commit, patchEl, setError, announceDrawingShortcut } = setup(
      [a, b],
      ["a", "b"],
    );

    transform.applyFigmaSelectionLayoutPatch({ width: 200, resizeAnchor: "center" });

    expect(commit).toHaveBeenCalledTimes(1);
    expect(patchEl).not.toHaveBeenCalled();
    expect(setError).toHaveBeenLastCalledWith(null);
    expect(announceDrawingShortcut).toHaveBeenCalledWith(
      expect.stringContaining("전체 크기를 조절"),
    );
  });

  it("reports an all-or-nothing failure instead of partially rotating a frame selection", () => {
    const picture = image("a", 0);
    const frame = {
      id: "f",
      type: "frame",
      x: 60,
      y: 0,
      width: 40,
      height: 40,
    } as unknown as El;
    const { transform, commit, setError } = setup([picture, frame], ["a", "f"]);

    transform.applyFigmaSelectionLayoutPatch({ rotation: 30 });

    expect(commit).not.toHaveBeenCalled();
    expect(setError).toHaveBeenCalledWith(expect.stringContaining("원자적으로 적용"));
  });
});
