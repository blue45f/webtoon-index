import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_STUDIO_WORKSPACE_STATE,
  normalizeStudioWorkspaceLayout,
} from "./studio-workspaces";
import { StudioWorkspaceMenuGate } from "./StudioWorkspaceMenuGate";

const persisted = { status: "persisted", failure: null } as const;

function renderGate(
  liveLayout = DEFAULT_STUDIO_WORKSPACE_STATE.liveLayout,
  persistence: { status: "persisted" | "session-only"; failure: null | "write-failed" } = persisted
): string {
  return renderToStaticMarkup(
    <StudioWorkspaceMenuGate
      state={DEFAULT_STUDIO_WORKSPACE_STATE}
      liveLayout={liveLayout}
      persistence={persistence}
      onStateChange={() => persisted}
      onApplyLayout={() => undefined}
    />
  );
}

describe("StudioWorkspaceMenuGate", () => {
  it("renders a complete lightweight trigger without mounting the heavy manager", () => {
    const html = renderGate();

    expect(html).toContain('data-testid="studio-workspace-menu-gate"');
    expect(html).toContain('data-testid="studio-workspace-toggle"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("작업공간: 스토리보드, 이 기기 저장 확인됨");
    expect(html).not.toContain('data-testid="studio-workspace-dialog"');
    expect(html).not.toContain('data-testid="studio-workspace-menu"');
  });

  it("keeps dirty and session-only truth visible before the optional chunk loads", () => {
    const liveLayout = normalizeStudioWorkspaceLayout({
      ...DEFAULT_STUDIO_WORKSPACE_STATE.liveLayout,
      inspector: {
        ...DEFAULT_STUDIO_WORKSPACE_STATE.liveLayout.inspector,
        primary: "layers",
      },
    });
    const html = renderGate(liveLayout, {
      status: "session-only",
      failure: "write-failed",
    });

    expect(html).toContain("저장되지 않은 배치 변경 있음");
    expect(html).toContain("변경은 이 세션에서만 유지");
    expect(html).toContain(">변경됨</span>");
    expect(html).toContain(">세션</span>");
  });

  it("lets only the workspace name absorb width pressure so status badges stay inside the chip", () => {
    const gateSource = readFileSync(
      fileURLToPath(new URL("./StudioWorkspaceMenuGate.tsx", import.meta.url)),
      "utf8"
    );
    const menuSource = readFileSync(
      fileURLToPath(new URL("./StudioWorkspaceMenu.tsx", import.meta.url)),
      "utf8"
    );

    for (const source of [gateSource, menuSource]) {
      const classLine = source
        .slice(source.indexOf("inline-flex min-h-11"))
        .split("\n")[0];
      expect(classLine).toContain("max-w-52");
      // `overflow-hidden` 은 flex 자동 최소 크기를 0 으로 풀어 배지가 잘리게 만든다.
      // 겹침은 이름 truncate 로 이미 흡수되므로 이 칩에는 넣지 않는다(2026-08-09 실측).
      expect(classLine).not.toContain("overflow-hidden");
    }
    // 유일한 shrink 대상은 이름이고, 두 상태 배지는 shrink-0 로 남는다.
    expect(gateSource).toContain(
      '<span className="min-w-0 truncate max-[359px]:sr-only">'
    );
    expect(gateSource).toContain('className="shrink-0 rounded-full bg-warn/15');
    expect(gateSource).toContain('className="shrink-0 rounded-full bg-cool/15');
    expect(menuSource).toContain('<span className="min-w-0 truncate">');
    expect(menuSource).toContain('className="shrink-0 rounded-full bg-warn/15');
    expect(menuSource).toContain('className="shrink-0 rounded-full bg-cool/15');
  });

  it("compacts the trigger without losing its accessible name at 320px", () => {
    const html = renderGate(undefined, {
      status: "session-only",
      failure: "write-failed",
    });

    expect(html).toContain("max-[359px]:size-11");
    expect(html).toContain("max-[359px]:justify-center");
    expect(html).toContain("max-[359px]:sr-only");
    expect(html.match(/max-\[359px\]:hidden/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain("작업공간: 스토리보드 세션, 변경은 이 세션에서만 유지");
  });

  it("uses one analyzable lazy import and all three intent preload signals", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./StudioWorkspaceMenuGate.tsx", import.meta.url)),
      "utf8"
    );

    expect(source.match(/import\("\.\/StudioWorkspaceMenu"\)/g)).toHaveLength(1);
    expect(source).toContain("onPointerEnter={preloadStudioWorkspaceMenu}");
    expect(source).toContain("onPointerDown={preloadStudioWorkspaceMenu}");
    expect(source).toContain("onFocus={preloadStudioWorkspaceMenu}");
    expect(source).toContain("busy={activated}");
    expect(source).toContain("setActivationAttempt((attempt) => attempt + 1)");
    expect(source).toContain("key={activationAttempt}");
    expect(source).toContain("onInitialOpenReady={setManagerReady}");
    expect(source).toContain("<Suspense fallback={null}>");
    expect(source).toContain("aria-expanded={false}");
    expect(source).toContain("<LazyStudioWorkspaceMenu");
    expect(source).toContain("{...props}");
    expect(source).toContain("initialOpen");
  });
});
