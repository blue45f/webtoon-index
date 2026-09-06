import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdSlot } from "./ad-slot";

// 훅/설정을 가변 상태로 모킹해 게이팅 분기(수익화 on·off, AdDesk 연동 유무)를 검증한다.
// vitest 가 vi.hoisted/vi.mock 을 import 위로 끌어올리므로 모킹은 ad-slot 평가 전에 적용된다.
const state = vi.hoisted(() => ({ monetizationEnabled: false, hasAdDesk: false }));

vi.mock("@/src/hooks/use-app-config", () => ({
  useAppConfig: () => ({ monetizationEnabled: state.monetizationEnabled, loading: false }),
}));

vi.mock("@/src/components/deskcloud-native/config", () => ({
  adConfig: () =>
    state.hasAdDesk ? { endpoint: "https://addesk.example", publishableKey: "pk_demo" } : null,
}));

afterEach(() => {
  state.monetizationEnabled = false;
  state.hasAdDesk = false;
});

describe("AdSlot", () => {
  it("renders nothing while monetization is off (default) — ads never leak", () => {
    const html = renderToStaticMarkup(<AdSlot />);
    expect(html).toBe("");
    expect(html).not.toContain("AD");
  });

  it("falls back to the house placeholder (with AD disclosure) when AdDesk is unconfigured", () => {
    state.monetizationEnabled = true;
    state.hasAdDesk = false;

    const html = renderToStaticMarkup(<AdSlot label="광고 문의" />);

    expect(html).toContain("AD · 광고");
    expect(html).toContain("광고 문의");
    expect(html).toContain('aria-label="광고 자리표시자"');
  });

  it("defers the sponsored network rail to the client — no markup leaks during SSR", () => {
    state.monetizationEnabled = true;
    state.hasAdDesk = true;

    // 서빙은 useEffect(클라이언트)에서 일어나므로 서버 렌더에는 아무 광고도 노출되지 않는다.
    const html = renderToStaticMarkup(<AdSlot />);
    expect(html).toBe("");
  });
});
