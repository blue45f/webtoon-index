import { readFileSync } from "node:fs";



import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readStudioCanvasViewportStack } from "./canvas/read-studio-canvas-viewport-stack";
import {
  defaultStudioAppSettings,
  type StudioAppSettings,
  type StudioAppSettingsTab,
} from "./studio-app-settings";
import { readStudioCuttoonEditorSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";
import {
  MAX_STUDIO_TOOL_HINT_TOUCH_HOLD_MS,
  MIN_STUDIO_TOOL_HINT_TOUCH_HOLD_MS,
} from "./studio-tool-hint-preferences";
import { StudioAppSettingsPanel } from "./StudioAppSettingsPanel";

import { useI18n } from "@/shared/lib/i18n";


const { createPortalMock } = vi.hoisted(() => ({
  createPortalMock: vi.fn((children: unknown, _container: unknown) => children),
}));

vi.mock("react-dom", () => ({
  createPortal: createPortalMock,
}));

const studioPageSource = readStudioCuttoonEditorSource();
const studioCanvasViewportSource = readStudioCanvasViewportStack(import.meta.url, "./canvas/");
const appSettingsPanelSource = readFileSync(
  new URL("./StudioAppSettingsPanel.tsx", import.meta.url),
  "utf8"
);

function renderSettings(
  initialTab: StudioAppSettingsTab = "general",
  settings: StudioAppSettings = defaultStudioAppSettings()
) {
  const body = { nodeName: "BODY" };
  vi.stubGlobal("document", { body });
  const html = renderToStaticMarkup(
    <StudioAppSettingsPanel
      open
      settings={settings}
      initialTab={initialTab}
      onClose={() => undefined}
      onChange={() => undefined}
      onResetAll={() => undefined}
    />
  );
  return { body, html };
}

function openingButtonTagByAriaLabel(html: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return html.match(new RegExp(`<button(?=[^>]*aria-label="${escaped}")[^>]*>`, "u"))?.[0] ?? "";
}

function openingButtonTagByText(html: string, text: string): string {
  const button = (html.match(/<button\b[^>]*>[\s\S]*?<\/button>/gu) ?? []).find((markup) =>
    markup.replace(/<[^>]+>/gu, "").trim() === text
  );
  return button?.match(/^<button\b[^>]*>/u)?.[0] ?? "";
}

describe("StudioAppSettingsPanel", () => {
  beforeEach(() => {
    useI18n.getState().setLang("ko");
  });

  afterEach(() => {
    createPortalMock.mockClear();
    vi.unstubAllGlobals();
  });

  it("모바일 하단 시트와 데스크톱 중앙 모달을 같은 접근 가능한 대화상자로 제공한다", () => {
    const { body, html } = renderSettings();

    expect(createPortalMock).toHaveBeenCalledOnce();
    expect(createPortalMock.mock.calls[0]?.[1]).toBe(body);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("place-items-end");
    expect(html).toContain("sm:place-items-center");
    expect(html).toContain("rounded-t-2xl");
    expect(html).toContain("sm:rounded-2xl");
    expect(html).toContain('aria-label="설정 탭"');
  });

  it("간단·동작 미리보기·끔 세 단계 도움말 모드를 노출한다", () => {
    const { html } = renderSettings();

    expect(html).toContain("도구 도움말");
    expect(html).toContain(">간단<");
    expect(html).toContain(">동작 미리보기<");
    expect(html).toContain(">끔<");
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>동작 미리보기<\/button>/);
  });

  it("입력 안정화 지연을 확인할 수 있는 필기 보조선 토글을 제공한다", () => {
    const { html } = renderSettings();

    expect(html).toContain("필기 보조선");
    expect(html).toContain("실제 포인터와 잉크 끝점을 연결합니다");
    expect(openingButtonTagByText(html, "숨김")).toContain('aria-pressed="false"');
  });

  it("터치 탭에서 조절 가능한 Motion Coach 길게 누르기 시간을 제공한다", () => {
    const { html } = renderSettings("touch");
    const range = html.match(
      /<input(?=[^>]*aria-label="도구 도움말 길게 누르기 시간")[^>]*>/u
    )?.[0] ?? "";

    expect(html).toContain('aria-label="도구 도움말 길게 누르기 시간"');
    expect(html).toContain(`min="${MIN_STUDIO_TOOL_HINT_TOUCH_HOLD_MS}"`);
    expect(html).toContain(`max="${MAX_STUDIO_TOOL_HINT_TOUCH_HOLD_MS}"`);
    expect(html).toContain("480ms");
    expect(range).toContain("min-h-11");
    expect(range).toContain("pointer-coarse:min-h-11");
  });

  it("공용 모달 계약으로 배경 격리·포커스 순환·Escape·복귀를 한 곳에서 관리한다", () => {
    expect(appSettingsPanelSource).toContain('import { activateStudioModalSheet } from "./useStudioModalSheet";');
    expect(appSettingsPanelSource).toContain("return activateStudioModalSheet({");
    expect(appSettingsPanelSource).toContain("root: dialog.ownerDocument.body");
    expect(appSettingsPanelSource).toContain("onDismiss: dismissModal");
    expect(appSettingsPanelSource).toContain("tabIndex={-1}");
    expect(appSettingsPanelSource).not.toContain("const focusable = Array.from(");
  });

  it("단축키·그리드·초기화 조작도 좁은 화면에서 44px 높이를 유지한다", () => {
    const shortcuts = renderSettings("shortcuts").html;
    const grids = renderSettings("grids").html;
    const other = renderSettings("other").html;
    const gridSelect = grids.match(/<select\b[^>]*>/u)?.[0] ?? "";

    expect(openingButtonTagByText(shortcuts, "V")).toContain("min-h-11");
    expect(openingButtonTagByText(shortcuts, "단축키 기본값")).toContain("min-h-11");
    expect(grids).toContain("캔버스 px 눈금자");
    expect(grids).toContain("실제 문서 좌표 표시");
    expect(gridSelect).toContain("min-h-11");
    expect(openingButtonTagByText(other, "기본값으로 재설정")).toContain("min-h-11");
  });

  it("단축키 충돌 시 안내와 행 배지를 표시한다", () => {
    const defaults = defaultStudioAppSettings();
    const settings: StudioAppSettings = {
      ...defaults,
      shortcuts: {
        ...defaults.shortcuts,
        "tool-pen": "K",
        "flip-canvas": "K",
      },
    };
    const { html } = renderSettings("shortcuts", settings);
    expect(html).toContain("같은 키 조합이");
    expect(html).toContain("충돌");
    expect(html).toContain("캔버스 좌우 반전");
  });

  it("툴바 설정을 검색 가능한 두 개의 독립 스크롤 목록으로 제공한다", () => {
    const { html } = renderSettings("toolbar");

    expect(html).toContain('type="search"');
    expect(html).toContain("툴바 도구 검색");
    expect(html).toContain("도구 이름 검색");
    expect(html).toContain("표시 중");
    expect(html).toContain("숨김 · 더보기에서 사용");
    expect(html.match(/max-h-\[min\(26rem,50dvh\)\]/g)).toHaveLength(1);
    expect(html).toContain("순서와 표시 상태는 즉시 적용됩니다.");
    expect(html).toContain("변경 내용은 이 기기에 자동 저장됩니다.");
  });

  it("브라우저 저장 실패를 세션 한정 상태와 재시도 동작으로 분명히 알린다", () => {
    const body = { nodeName: "BODY" };
    vi.stubGlobal("document", { body });
    const html = renderToStaticMarkup(
      <StudioAppSettingsPanel
        open
        settings={defaultStudioAppSettings()}
        persistenceState="session-only"
        onClose={() => undefined}
        onChange={() => undefined}
        onResetAll={() => undefined}
        onRetryPersistence={() => undefined}
      />
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("브라우저 저장소에 저장하지 못해 현재 세션에만 적용됩니다.");
    expect(html).toContain("다시 저장");
    expect(html).not.toContain("변경 내용은 이 기기에 자동 저장됩니다.");
    expect(studioCanvasViewportSource).toContain(
      "persistenceState={appSettingsPersistenceState}",
    );
    expect(studioCanvasViewportSource).toContain(
      "onRetryPersistence={retryAppSettingsPersistence}",
    );
  });

  it("SQLite/OPFS hydration이 끝나기 전에는 저장 완료로 표시하지 않는다", () => {
    const body = { nodeName: "BODY" };
    vi.stubGlobal("document", { body });
    const html = renderToStaticMarkup(
      <StudioAppSettingsPanel
        open
        settings={defaultStudioAppSettings()}
        persistenceState="loading"
        onClose={() => undefined}
        onChange={() => undefined}
        onResetAll={() => undefined}
      />
    );

    expect(html).toContain('data-studio-app-settings-persistence="loading"');
    expect(html).toContain("SQLite/OPFS에서 설정을 확인하는 중입니다.");
    expect(html).not.toContain("변경 내용은 이 기기에 자동 저장됩니다.");
  });

  it("가로형 터치 화면에서도 툴바 설정의 모든 핵심 조작을 44px 이상으로 유지한다", () => {
    const defaults = defaultStudioAppSettings();
    const settings: StudioAppSettings = {
      ...defaults,
      toolbar: { visibleIds: defaults.toolbar.visibleIds.slice(0, -1) },
    };
    const { html } = renderSettings("toolbar", settings);
    const activeToolbarTab = html.match(
      /<button(?=[^>]*aria-current="page")[^>]*>툴바<\/button>/u
    )?.[0] ?? "";
    const search = html.match(/<input(?=[^>]*type="search")[^>]*>/u)?.[0] ?? "";

    expect(openingButtonTagByAriaLabel(html, "설정 닫기")).toContain(
      "pointer-coarse:min-h-11 pointer-coarse:min-w-11"
    );
    expect(activeToolbarTab).toContain("pointer-coarse:min-h-11");
    expect(activeToolbarTab).toContain("pointer-coarse:min-w-11");
    expect(search).toContain("pointer-coarse:h-11");
    // slice(0, -1) hides the last catalog tool (view rotate after CSP rail regroup).
    for (const label of [
      "선택 위로",
      "선택 아래로",
      "선택 숨기기",
      "보기 회전 표시",
    ]) {
      const action = openingButtonTagByAriaLabel(html, label);
      expect(action, label).toContain("pointer-coarse:min-h-11");
      expect(action, label).toContain("pointer-coarse:min-w-11");
    }
    expect(openingButtonTagByText(html, "툴바 기본값")).toContain("pointer-coarse:min-h-11");
    expect(openingButtonTagByText(html, "완료")).toContain("pointer-coarse:min-h-11");
    expect(html.match(/max-h-\[min\(26rem,50dvh\)\]/gu)).toHaveLength(2);
  });

  it("설정 모달은 단축키 모달 상태와 독립적으로 마운트된다", () => {
    const shortcutsStart = studioCanvasViewportSource.indexOf("{shortcutsOpen ? (");
    const appSettingsStart = studioCanvasViewportSource.indexOf(
      "{appSettingsOpen ? (",
      shortcutsStart,
    );
    const shortcutsClose = studioCanvasViewportSource.indexOf(") : null}", shortcutsStart);

    expect(shortcutsStart).toBeGreaterThanOrEqual(0);
    expect(shortcutsClose).toBeGreaterThan(shortcutsStart);
    expect(appSettingsStart).toBeGreaterThan(shortcutsClose);
    expect(studioPageSource).toContain("<StudioToolHintPreferencesProvider");
    expect(studioPageSource).toContain("mode={appSettings.general.toolHintMode}");
    expect(studioPageSource).toContain("touchHoldDelayMs={appSettings.touch.toolHintHoldMs}");
    expect(studioPageSource).toContain("reduceMotion={appSettings.other.reduceMotion}");
  });

  it("닫힌 상태에서는 포털과 대화상자를 만들지 않는다", () => {
    const html = renderToStaticMarkup(
      <StudioAppSettingsPanel
        open={false}
        settings={defaultStudioAppSettings()}
        onClose={() => undefined}
        onChange={() => undefined}
        onResetAll={() => undefined}
      />
    );

    expect(html).toBe("");
    expect(createPortalMock).not.toHaveBeenCalled();
  });
});
