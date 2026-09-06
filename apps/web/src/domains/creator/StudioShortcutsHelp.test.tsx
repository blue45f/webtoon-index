import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultStudioAppSettings } from "./studio-app-settings";
import { StudioShortcutsHelp } from "./StudioShortcutsHelp";

import { useI18n } from "@/shared/lib/i18n";

const { createPortalMock } = vi.hoisted(() => ({
  createPortalMock: vi.fn((children: unknown, _container: unknown) => children),
}));

vi.mock("react-dom", () => ({
  createPortal: createPortalMock,
}));

describe("StudioShortcutsHelp", () => {
  afterEach(() => {
    createPortalMock.mockClear();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    useI18n.getState().setLang("ko");
  });

  it("드로잉 단축키와 모달 단축키 경계를 함께 안내한다", () => {
    const html = renderToStaticMarkup(<StudioShortcutsHelp open onClose={() => undefined} />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('data-studio-shortcut-boundary="true"');
    expect(html).toContain("펜으로 전환");
    expect(html).toContain("펜·지우개 전환");
    expect(html).toContain("브러시 크기 ±5px");
    expect(html).toContain("불투명도 ±5%");
    expect(html).toContain("대화상자·검토 또는 협업 잠금");
  });

  it("픽셀 보정·선택 신규 단축키(N·⇧N·O·Q)를 안내한다", () => {
    const html = renderToStaticMarkup(<StudioShortcutsHelp open onClose={() => undefined} />);
    expect(html).toContain("혼합(스머지) · 혼색 브러시");
    expect(html).toContain("닷지/번/스펀지");
    expect(html).toContain("퀵 마스크 켬 · 선택 영역으로 완료");
  });

  it("접근 가능한 제목을 가진 고정 모달과 모바일 44px 닫기 타깃을 유지한다", () => {
    const html = renderToStaticMarkup(<StudioShortcutsHelp open onClose={() => undefined} />);

    expect(html).toContain('class="fixed inset-0');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="studio-shortcuts-title"');
    expect(html).toContain('id="studio-shortcuts-title"');
    expect(html).toMatch(/<button[^>]*aria-label="닫기"[^>]*class="[^"]*\bsize-11\b[^"]*\bsm:size-9\b[^"]*"/);
  });

  it("브라우저 렌더에서는 도움말을 document.body 포털에 배치한다", () => {
    const body = { nodeName: "BODY" };
    vi.stubGlobal("document", { body });

    const html = renderToStaticMarkup(<StudioShortcutsHelp open onClose={() => undefined} />);

    expect(createPortalMock).toHaveBeenCalledOnce();
    expect(createPortalMock.mock.calls[0]?.[1]).toBe(body);
    expect(html).toContain('role="dialog"');
  });

  it("닫힌 상태에서는 아무것도 렌더하지 않는다", () => {
    expect(renderToStaticMarkup(<StudioShortcutsHelp open={false} onClose={() => undefined} />)).toBe("");
  });

  it("optional shortcuts prop이 있으면 리맵된 코드를 formatStudioShortcutChord로 표시한다", () => {
    const shortcuts = {
      ...defaultStudioAppSettings().shortcuts,
      "tool-pen": "K",
      "flip-canvas": "Mod+H",
      "swap-colors": "",
    };
    const html = renderToStaticMarkup(
      <StudioShortcutsHelp open onClose={() => undefined} shortcuts={shortcuts} />
    );
    expect(html).toContain("펜으로 전환");
    expect(html).toContain(">K<");
    expect(html).toContain("⌘·H");
    expect(html).toContain("없음");
    // Unrelated static rows stay as documented defaults.
    expect(html).toContain("1–6");
  });

});
