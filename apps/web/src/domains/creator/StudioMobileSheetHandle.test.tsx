import { readFileSync } from "node:fs";

import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StudioMobileSheetHandle } from "./StudioMobileSheetHandle";

describe("StudioMobileSheetHandle", () => {
  it("renders one semantic 44px drag-and-tap close target with a stable sheet selector", () => {
    const html = renderToStaticMarkup(
      <StudioMobileSheetHandle
        active
        kind="pages"
        label="페이지 시트"
        onDismiss={() => undefined}
        sheetRef={createRef<HTMLElement>()}
      />,
    );

    expect(html).toContain('type="button"');
    expect(html).toContain('data-studio-sheet-drag-handle="true"');
    expect(html).toContain('data-studio-sheet-kind="pages"');
    expect(html).toContain("min-h-11");
    expect(html).toContain("touch-action:none");
    expect(html).toContain("아래로 밀거나 눌러 닫기");
  });

  it("removes an inactive mounted sheet handle from sequential keyboard navigation", () => {
    const html = renderToStaticMarkup(
      <StudioMobileSheetHandle
        active={false}
        kind="props"
        label="속성 시트"
        onDismiss={() => undefined}
        sheetRef={createRef<HTMLElement>()}
      />,
    );

    expect(html).toContain('tabindex="-1"');
  });

  it("announces the current snap height while preserving a 44px touch target", () => {
    const html = renderToStaticMarkup(
      <StudioMobileSheetHandle
        active
        kind="props"
        label="속성 시트"
        onDismiss={() => undefined}
        onSnapChange={() => undefined}
        sheetRef={createRef<HTMLElement>()}
        snap="medium"
      />,
    );

    expect(html).toContain('data-studio-sheet-snap="medium"');
    expect(html).toContain('role="slider"');
    expect(html).toContain('aria-valuenow="1"');
    expect(html).toContain('aria-valuetext="시트 높이 중간"');
    expect(html).toContain("현재 중간");
    expect(html).toContain("min-h-11");
  });

  it("clamps slider keyboard collapse at compact while retaining swipe and X dismissal", () => {
    const source = readFileSync(new URL("./StudioMobileSheetHandle.tsx", import.meta.url), "utf8");

    expect(source).toContain("onKeyboardCollapse: snapEnabled");
    expect(source).toContain("onDismiss");
    expect(source).toContain("else onDismiss();");
  });
});
