import { describe, expect, it } from "vitest";

import {
  STUDIO_UPLOAD_ACTION_DOCK_CLASS,
  STUDIO_UPLOAD_CONTAINER_CLASS,
  STUDIO_UPLOAD_PAGE_CONTROLS_CLASS,
  STUDIO_UPLOAD_PAGE_CONTROL_CLASS,
  STUDIO_UPLOAD_PAGE_LIST_CLASS,
  STUDIO_UPLOAD_PAGE_ROW_CLASS,
} from "./studio-upload-layout";

describe("studio upload mobile layout contract", () => {
  it("40장 목록을 viewport 기반 독립 스크롤로 제한한다", () => {
    expect(STUDIO_UPLOAD_PAGE_LIST_CLASS).toContain("max-h-[min(52dvh,36rem)]");
    expect(STUDIO_UPLOAD_PAGE_LIST_CLASS).toContain("overflow-y-auto");
    expect(STUDIO_UPLOAD_PAGE_LIST_CLASS).toContain("overscroll-contain");
    expect(STUDIO_UPLOAD_PAGE_LIST_CLASS).toContain("[scrollbar-gutter:stable]");
    expect(STUDIO_UPLOAD_PAGE_ROW_CLASS).toContain("[content-visibility:auto]");
    expect(STUDIO_UPLOAD_PAGE_ROW_CLASS).toContain("[contain-intrinsic-size:auto_8.5rem]");
  });

  it("320px 행은 3개 조작을 별도 2행 grid에 놓고 coarse pointer 44px를 보장한다", () => {
    expect(STUDIO_UPLOAD_PAGE_ROW_CLASS).toContain(
      "grid-cols-[1.5rem_3.5rem_minmax(0,1fr)]"
    );
    expect(STUDIO_UPLOAD_PAGE_CONTROLS_CLASS).toContain("col-span-3");
    expect(STUDIO_UPLOAD_PAGE_CONTROLS_CLASS).toContain("grid-cols-3");
    expect(STUDIO_UPLOAD_PAGE_CONTROL_CLASS).toContain("pointer-coarse:h-11");
    expect(STUDIO_UPLOAD_PAGE_CONTROL_CLASS).toContain("pointer-coarse:min-w-11");
  });

  it("모바일 저장 도크는 입력을 덮지 않고 도달한 뒤 상단 safe-area에 머문다", () => {
    expect(STUDIO_UPLOAD_CONTAINER_CLASS).toContain("env(safe-area-inset-bottom)");
    expect(STUDIO_UPLOAD_ACTION_DOCK_CLASS).toContain("top-[calc(env(safe-area-inset-top)");
    expect(STUDIO_UPLOAD_ACTION_DOCK_CLASS).not.toContain("bottom-[calc(");
    expect(STUDIO_UPLOAD_ACTION_DOCK_CLASS).toContain("sticky");
    expect(STUDIO_UPLOAD_ACTION_DOCK_CLASS).toContain("lg:static");
  });
});
