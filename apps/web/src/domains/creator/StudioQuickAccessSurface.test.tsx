// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  DEFAULT_STUDIO_QUICK_ACCESS_STATE,
  type StudioQuickAccessState,
} from "./studio-quick-access";
import {
  buildStudioQuickAccessCommandCatalog,
} from "./studio-quick-access-integration";
import {
  STUDIO_QUICK_ACCESS_FLOATING_LAYOUT_SESSION_KEY,
} from "./studio-quick-access-surface-layout";
import { StudioQuickAccessSurface } from "./StudioQuickAccessSurface";

const CATALOG = buildStudioQuickAccessCommandCatalog({
  undo: true,
  redo: true,
  save: true,
  pen: true,
  eraser: true,
  fill: true,
  eyedropper: true,
  select: true,
  transform: false,
  "fit-canvas": true,
  properties: true,
  duplicate: false,
  delete: false,
  "bring-front": false,
  "add-bubble": true,
  "quick-mask": false,
  "wet-mix": false,
  "dodge-burn": false,
});

beforeEach(() => {
  window.sessionStorage.clear();
  Object.defineProperty(globalThis, "innerWidth", {
    configurable: true,
    value: 1_024,
  });
  Object.defineProperty(globalThis, "innerHeight", {
    configurable: true,
    value: 768,
  });
});

afterEach(cleanup);

function SurfaceHarness({
  isMobile,
  onExecute = () => undefined,
}: {
  isMobile: boolean;
  onExecute?: (commandId: string, setId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<StudioQuickAccessState>(
    DEFAULT_STUDIO_QUICK_ACCESS_STATE,
  );
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        빠른 액세스 열기
      </button>
      {open ? (
        <StudioQuickAccessSurface
          state={state}
          catalog={CATALOG}
          isMobile={isMobile}
          onStateChange={setState}
          onExecute={onExecute}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

describe("StudioQuickAccessSurface", () => {
  it("keeps desktop non-modal, movable, resizable, and restores launcher focus", async () => {
    render(<SurfaceHarness isMobile={false} />);
    const launcher = screen.getByRole("button", {
      name: "빠른 액세스 열기",
    });
    launcher.focus();
    fireEvent.click(launcher);

    const surface = screen.getByRole("dialog", {
      name: "빠른 액세스 팔레트",
    });
    expect(surface.getAttribute("aria-modal")).toBeNull();
    expect(surface.getAttribute("data-mobile")).toBe("false");
    expect(surface.getAttribute("data-studio-floating-surface")).toBe("true");
    expect(surface.style.left).not.toBe("");
    expect(surface.style.top).not.toBe("");
    expect(screen.getByRole("button", {
      name: "빠른 액세스 팔레트 이동",
    })).toBeTruthy();
    expect(screen.getByRole("button", {
      name: "빠른 액세스 팔레트 크기 조절",
    })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "빠른 액세스 닫기" }),
    ).toBeNull();

    await waitFor(() => {
      expect(document.activeElement?.getAttribute("aria-label")).toBe(
        "되돌리기 실행",
      );
    });
    fireEvent.click(screen.getByRole("button", {
      name: "빠른 액세스 팔레트 닫기",
    }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(launcher);
  });

  it("restores the desktop floating position after close and reopen in the same tab", () => {
    render(<SurfaceHarness isMobile={false} />);
    const launcher = screen.getByRole("button", {
      name: "빠른 액세스 열기",
    });
    fireEvent.click(launcher);

    const moveHandle = screen.getByRole("button", {
      name: "빠른 액세스 팔레트 이동",
    });
    fireEvent.keyDown(moveHandle, {
      key: "ArrowLeft",
      altKey: true,
    });

    const encoded = window.sessionStorage.getItem(
      STUDIO_QUICK_ACCESS_FLOATING_LAYOUT_SESSION_KEY,
    );
    expect(encoded).not.toBeNull();
    const parsed = JSON.parse(encoded!) as { readonly xRatio: number };
    expect(parsed.xRatio).toBeLessThan(1);
    const movedLeft = screen.getByRole("dialog", {
      name: "빠른 액세스 팔레트",
    }).style.left;

    fireEvent.click(screen.getByRole("button", {
      name: "빠른 액세스 팔레트 닫기",
    }));
    fireEvent.click(launcher);

    expect(screen.getByRole("dialog", {
      name: "빠른 액세스 팔레트",
    }).style.left).toBe(movedLeft);
  });

  it("uses a bounded mobile sheet, backdrop dismissal, and one trusted executor", () => {
    const onExecute = vi.fn();
    render(<SurfaceHarness isMobile onExecute={onExecute} />);
    fireEvent.click(screen.getByRole("button", {
      name: "빠른 액세스 열기",
    }));

    const surface = screen.getByRole("dialog", {
      name: "빠른 액세스 팔레트",
    });
    expect(surface.getAttribute("aria-modal")).toBe("true");
    expect(surface.getAttribute("data-mobile")).toBe("true");
    expect(surface.getAttribute("data-studio-floating-surface")).toBeNull();
    expect(surface.className).toContain("h-[min(78dvh,44rem)]");
    expect(surface.className).toContain("max-h-[calc(100dvh-4rem)]");

    fireEvent.click(screen.getByRole("button", { name: "펜 실행" }));
    expect(onExecute).toHaveBeenCalledWith(
      "pen",
      DEFAULT_STUDIO_QUICK_ACCESS_STATE.activeSetId,
    );

    fireEvent.pointerDown(screen.getByRole("button", {
      name: "빠른 액세스 닫기",
    }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("lets inner customization consume Escape before closing the surface", () => {
    render(<SurfaceHarness isMobile={false} />);
    fireEvent.click(screen.getByRole("button", {
      name: "빠른 액세스 열기",
    }));
    fireEvent.click(screen.getByRole("button", {
      name: "빠른 액세스 편집",
    }));

    const search = screen.getByRole("searchbox", {
      name: "추가할 빠른 액세스 명령 검색",
    });
    fireEvent.keyDown(search, { key: "Escape" });
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.getByRole("dialog", {
      name: "빠른 액세스 팔레트",
    })).toBeTruthy();

    fireEvent.keyDown(screen.getByRole("dialog", {
      name: "빠른 액세스 팔레트",
    }), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("cancels a floating drag with Escape without closing the palette", () => {
    render(<SurfaceHarness isMobile={false} />);
    fireEvent.click(screen.getByRole("button", {
      name: "빠른 액세스 열기",
    }));
    const handle = screen.getByRole("button", {
      name: "빠른 액세스 팔레트 이동",
    });

    fireEvent.pointerDown(handle, {
      pointerId: 51,
      pointerType: "mouse",
      button: 0,
      clientX: 900,
      clientY: 90,
    });
    fireEvent.pointerMove(window, {
      pointerId: 51,
      pointerType: "mouse",
      buttons: 1,
      clientX: 860,
      clientY: 120,
    });
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.getByRole("dialog", {
      name: "빠른 액세스 팔레트",
    })).toBeTruthy();
    expect(window.sessionStorage.getItem(
      STUDIO_QUICK_ACCESS_FLOATING_LAYOUT_SESSION_KEY,
    )).toBeNull();
  });

  it("closes with the same Shift+Q chord inside its shortcut boundary", () => {
    render(<SurfaceHarness isMobile={false} />);
    fireEvent.click(screen.getByRole("button", {
      name: "빠른 액세스 열기",
    }));

    fireEvent.keyDown(screen.getByRole("dialog", {
      name: "빠른 액세스 팔레트",
    }), {
      code: "KeyQ",
      key: "Q",
      shiftKey: true,
    });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps Shift+Q available as text while the command search field is focused", () => {
    render(<SurfaceHarness isMobile={false} />);
    fireEvent.click(screen.getByRole("button", {
      name: "빠른 액세스 열기",
    }));
    fireEvent.click(screen.getByRole("button", {
      name: "빠른 액세스 편집",
    }));
    const search = screen.getByRole("searchbox", {
      name: "추가할 빠른 액세스 명령 검색",
    });

    fireEvent.keyDown(search, {
      code: "KeyQ",
      key: "Q",
      shiftKey: true,
    });

    expect(screen.getByRole("dialog", {
      name: "빠른 액세스 팔레트",
    })).toBeTruthy();
  });
});
