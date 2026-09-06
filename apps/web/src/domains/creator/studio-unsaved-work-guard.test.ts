import { describe, expect, it, vi } from "vitest";

import {
  allowStudioProgrammaticReload,
  hasStudioUnloadPromptWork,
  hasUnsavedStudioWork,
  installStudioUnloadGuard,
  studioPendingStrokeFingerprint,
} from "./studio-unsaved-work-guard";

function signals(overrides: Partial<Parameters<typeof hasUnsavedStudioWork>[0]> = {}) {
  return {
    hydrated: true,
    editGeneration: 4,
    durableGeneration: 4,
    pendingStrokeFingerprint: "",
    durablePendingStrokeFingerprint: "",
    ...overrides,
  };
}

describe("studio unsaved work signal", () => {
  it("stays quiet before hydration — there is nothing of the user's to lose yet", () => {
    expect(
      hasUnsavedStudioWork(
        signals({ hydrated: false, editGeneration: 9, durableGeneration: 0 }),
      ),
    ).toBe(false);
  });

  it("reports a dirty tool-operation SQLite snapshot even before document hydration", () => {
    expect(
      hasUnsavedStudioWork(signals({
        hydrated: false,
        toolOperationMemoryDirty: true,
      })),
    ).toBe(true);
  });

  it("stays quiet when the durable authority already caught up", () => {
    expect(hasUnsavedStudioWork(signals())).toBe(false);
  });

  it("reports unsaved work when the edit generation is ahead of durable storage", () => {
    expect(
      hasUnsavedStudioWork(signals({ editGeneration: 5, durableGeneration: 4 })),
    ).toBe(true);
  });

  it("reports unsaved work for a stroke that has not reached the page yet", () => {
    // 세대는 같지만 아직 커밋되지 않은 획이 있다. 이 상태에서 조용히 닫히면 방금 그은
    // 선이 서버 원고에 없다.
    expect(
      hasUnsavedStudioWork(
        signals({
          pendingStrokeFingerprint: "page-1:stroke-a",
          durablePendingStrokeFingerprint: "",
        }),
      ),
    ).toBe(true);
  });

  it("does not use brush-slot dirt alone for the native leave dialog", () => {
    expect(
      hasStudioUnloadPromptWork(signals({
        toolOperationMemoryDirty: true,
        editGeneration: 4,
        durableGeneration: 4,
      })),
    ).toBe(false);
  });

  it("still prompts while a document generation or deferred stroke is not durable", () => {
    expect(
      hasStudioUnloadPromptWork(signals({ editGeneration: 5, durableGeneration: 4 })),
    ).toBe(true);
    expect(
      hasStudioUnloadPromptWork(signals({
        pendingStrokeFingerprint: "page-1:stroke-a",
        durablePendingStrokeFingerprint: "",
      })),
    ).toBe(true);
  });

  it("builds one fingerprint shape for both the autosave path and the close guard", () => {
    expect(studioPendingStrokeFingerprint(null)).toBe("");
    expect(
      studioPendingStrokeFingerprint({
        pageId: "page-1",
        strokes: [{ id: "a" }, { id: "b" }],
      }),
    ).toBe("page-1:a,b");
  });
});

describe("studio unload guard", () => {
  function fakeTarget() {
    let listener: ((event: BeforeUnloadEvent) => void) | null = null;
    return {
      target: {
        addEventListener: (_type: "beforeunload", next: (event: BeforeUnloadEvent) => void) => {
          listener = next;
        },
        removeEventListener: () => {
          listener = null;
        },
      },
      fire(): { prevented: boolean } {
        let prevented = false;
        const event = {
          preventDefault: () => {
            prevented = true;
          },
          returnValue: undefined as unknown,
        } as unknown as BeforeUnloadEvent;
        listener?.(event);
        return { prevented };
      },
      get attached() {
        return listener !== null;
      },
    };
  }

  it("does not interrupt the close when everything is saved", () => {
    const harness = fakeTarget();
    installStudioUnloadGuard({ target: harness.target, hasUnsavedWork: () => false });
    expect(harness.fire().prevented).toBe(false);
  });

  it("interrupts the close while work is unsaved", () => {
    const harness = fakeTarget();
    installStudioUnloadGuard({ target: harness.target, hasUnsavedWork: () => true });
    expect(harness.fire().prevented).toBe(true);
  });

  it("re-reads the signal on every close attempt instead of freezing it", () => {
    const harness = fakeTarget();
    const hasUnsavedWork = vi.fn<() => boolean>().mockReturnValueOnce(true).mockReturnValue(false);
    installStudioUnloadGuard({ target: harness.target, hasUnsavedWork });

    expect(harness.fire().prevented).toBe(true);
    expect(harness.fire().prevented).toBe(false);
  });

  it("lets an app or HMR reload through without the leave dialog", () => {
    const harness = fakeTarget();
    installStudioUnloadGuard({ target: harness.target, hasUnsavedWork: () => true });
    allowStudioProgrammaticReload();
    expect(harness.fire().prevented).toBe(false);
    expect(harness.fire().prevented).toBe(true);
  });

  it("detaches so a closed studio cannot keep prompting", () => {
    const harness = fakeTarget();
    const detach = installStudioUnloadGuard({
      target: harness.target,
      hasUnsavedWork: () => true,
    });
    expect(harness.attached).toBe(true);
    detach();
    expect(harness.attached).toBe(false);
  });
});
