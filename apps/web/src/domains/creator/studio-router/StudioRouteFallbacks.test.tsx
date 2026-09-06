// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { StudioRouteFailure, StudioRoutePlaceholder } from "./StudioRouteFallbacks";

import type { StudioPlaceholderRouteId } from "./studio-route-manifest";
import type { StudioWorkspaceRouteErrorCode } from "../studio-workspace-route";

/**
 * 인앱 브라우저에는 주소창도 뒤로 가기 크롬도 없다. 이 두 화면은 문서 런타임을 끝내고
 * 아무것도 렌더링하지 않는 막다른 지점이라, 화면 안 컨트롤이 유일한 출구다. 출구가
 * 하나라도 사라지면 사용자에게 남는 선택지는 앱을 끄는 것뿐이므로 계약으로 고정한다.
 */
const PLACEHOLDER_IDS: readonly StudioPlaceholderRouteId[] = ["assets"];

const ERROR_CODES: readonly StudioWorkspaceRouteErrorCode[] = [
  "identity-conflict",
  "invalid-mode",
  "invalid-path",
  "invalid-remix-id",
  "invalid-work-id",
  "work-id-conflict",
];

afterEach(cleanup);

describe("studio route dead ends", () => {
  it.each(PLACEHOLDER_IDS)("gives the %s placeholder both exits", (placeholderId) => {
    render(
      <MemoryRouter>
        <StudioRoutePlaceholder placeholderId={placeholderId} onOpenStudio={() => undefined} />
      </MemoryRouter>,
    );
    const exits = document.querySelectorAll("[data-studio-route-exit]");
    expect(exits).toHaveLength(2);
    expect(document.querySelector('[data-studio-route-exit="site"]')?.getAttribute("href"))
      .toBe("/create");
  });

  it.each(ERROR_CODES)("gives the %s failure screen both exits", (errorCode) => {
    render(
      <MemoryRouter>
        <StudioRouteFailure errorCode={errorCode} onOpenStudio={() => undefined} />
      </MemoryRouter>,
    );
    expect(document.querySelectorAll("[data-studio-route-exit]")).toHaveLength(2);
    // 원인 문구가 비어 있으면 사용자는 무엇을 고쳐야 할지 알 수 없다.
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Studio 작업 주소");
  });

  it("keeps every exit at the 44px touch contract", () => {
    render(
      <MemoryRouter>
        <StudioRoutePlaceholder placeholderId="assets" onOpenStudio={() => undefined} />
      </MemoryRouter>,
    );
    for (const exit of document.querySelectorAll("[data-studio-route-exit]")) {
      expect(exit.className).toContain("min-h-11");
    }
  });
});
