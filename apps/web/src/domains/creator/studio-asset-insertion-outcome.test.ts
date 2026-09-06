import { describe, expect, it, vi } from "vitest";

import { completeStudioAssetInsertion } from "./studio-asset-insertion-outcome";

describe("completeStudioAssetInsertion", () => {
  it("삽입 커밋이 실패하면 에셋 메뉴를 닫지 않는다", () => {
    const close = vi.fn();

    expect(completeStudioAssetInsertion(() => false, close)).toBe(false);
    expect(close).not.toHaveBeenCalled();
  });

  it("삽입 커밋이 성공한 뒤에만 에셋 메뉴를 닫는다", () => {
    const close = vi.fn();

    expect(completeStudioAssetInsertion(() => true, close)).toBe(true);
    expect(close).toHaveBeenCalledOnce();
  });
});
