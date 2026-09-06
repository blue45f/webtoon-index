import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_WORKSPACE_INTERCHANGE_KIND,
  STUDIO_WORKSPACE_INTERCHANGE_MAX_BYTES,
  STUDIO_WORKSPACE_INTERCHANGE_MAX_WORKSPACES,
  STUDIO_WORKSPACE_INTERCHANGE_VERSION,
  decodeStudioWorkspaceInterchange,
  encodeStudioWorkspaceInterchange,
  planStudioWorkspaceInterchangeImport,
  type StudioWorkspaceInterchangePresentation,
  type StudioWorkspaceInterchangeTargetState,
  type StudioWorkspaceInterchangeWorkspace,
} from "./studio-workspace-interchange";
import { DEFAULT_STUDIO_COMMAND_BAR } from "./studio-workspaces";

function presentation(
  variant: "current" | "imported" = "current",
): StudioWorkspaceInterchangePresentation {
  const imported = variant === "imported";
  return {
    panels: {
      inspector: {
        primary: imported ? "layers" : "properties",
        image: imported ? "retouch" : "quick",
        document: imported ? "navigator" : "canvas",
      },
      desktop: {
        leftPanelOpen: !imported,
        rightPanelOpen: true,
        leftPanelWidth: imported ? 248 : 160,
        rightPanelWidth: imported ? 360 : 280,
      },
    },
    drawingPalettes: {
      order: imported
        ? ["tool-properties", "sub-tools"]
        : ["sub-tools", "tool-properties"],
      collapsed: {
        "sub-tools": imported,
        "tool-properties": false,
      },
      sizes: {
        "sub-tools": imported ? 52 : 36,
        "tool-properties": imported ? 48 : 64,
      },
      locks: {
        "sub-tools": {
          position: imported,
          height: false,
        },
        "tool-properties": {
          position: false,
          height: imported,
        },
      },
    },
    quickActions: {
      version: 1,
      slots: {
        north: imported ? "redo" : "undo",
        northEast: imported ? "undo" : "redo",
        southEast: imported ? "pen" : "select",
        south: imported ? "advanced-fill" : "pen",
        southWest: imported ? "eyedropper" : "eraser",
        northWest: imported ? "fit-width" : "eyedropper",
      },
    },
    quickAccess: {
      version: 1,
      sets: [{
        id: imported ? "quick-imported" : "quick-current",
        name: imported ? "가져온 빠른 액세스" : "현재 빠른 액세스",
        commandIds: imported
          ? ["redo", "advanced-fill"]
          : ["undo", "pen"],
      }],
      activeSetId: imported ? "quick-imported" : "quick-current",
      displayMode: imported ? "list" : "tiles",
      density: imported ? "compact" : "comfortable",
    },
    commandBar: {
      version: 1,
      visible: !imported,
      slots: imported
        ? ["export-open", "download", "bubbles", "publish", null, "redo", "undo", "save"]
        : ["undo", "redo", "save", "publish", "zoom-fit", null, "bubbles", null],
    },
  };
}

function legacyPresentation(
  variant: "current" | "imported" = "imported",
): StudioWorkspaceInterchangePresentation {
  const { commandBar: _commandBar, ...rest } = presentation(variant);
  return rest;
}

function workspace(
  id: string,
  name: string,
  workspacePresentation = presentation("imported"),
): StudioWorkspaceInterchangeWorkspace {
  return { id, name, presentation: workspacePresentation };
}

function currentState(
  workspaces: readonly StudioWorkspaceInterchangeWorkspace[] = [
    workspace("custom-current", "현재 작업공간", presentation("current")),
  ],
): StudioWorkspaceInterchangeTargetState {
  return {
    activeWorkspaceId: "storyboard",
    livePresentation: presentation("current"),
    workspaces,
  };
}

function encoded(
  workspaces: readonly StudioWorkspaceInterchangeWorkspace[],
): string {
  const result = encodeStudioWorkspaceInterchange(workspaces);
  if (!result.ok) throw new Error(result.reason);
  return result.text;
}

function expectDeepFrozen(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

describe("Studio workspace interchange codec", () => {
  it("round-trips the exact v1 presentation allowlist into deeply frozen canonical values", () => {
    const source = workspace("portable-1", "선화 작업공간");
    const exported = encodeStudioWorkspaceInterchange([source]);

    expect(exported).toMatchObject({
      ok: true,
      document: {
        kind: STUDIO_WORKSPACE_INTERCHANGE_KIND,
        version: STUDIO_WORKSPACE_INTERCHANGE_VERSION,
        workspaces: [{ id: "portable-1", name: "선화 작업공간" }],
      },
    });
    if (!exported.ok) return;

    const decoded = decodeStudioWorkspaceInterchange(exported.text);
    expect(decoded).toEqual({
      ok: true,
      document: exported.document,
    });
    if (!decoded.ok) return;
    expectDeepFrozen(decoded);
    expect(Object.keys(decoded.document)).toEqual(["kind", "version", "workspaces"]);
    expect(Object.keys(decoded.document.workspaces[0] ?? {})).toEqual([
      "id",
      "name",
      "presentation",
    ]);
  });

  it("always exports panels and independently omits optional palette and quick-access scopes", () => {
    const exported = encodeStudioWorkspaceInterchange(
      [workspace("portable-2", "간결한 작업공간")],
      {
        includeDrawingPalettes: false,
        includeQuickActions: false,
        includeQuickAccess: false,
        includeCommandBar: false,
      },
    );

    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.document.workspaces[0]?.presentation).toEqual({
      panels: presentation("imported").panels,
    });
    expect(exported.text).not.toContain("drawingPalettes");
    expect(exported.text).not.toContain("quickActions");
    expect(exported.text).not.toContain("quickAccess");
    expect(exported.text).not.toContain("commandBar");
  });

  it("rejects duplicate IDs, duplicate normalized names, and more than 24 user workspaces", () => {
    expect(
      encodeStudioWorkspaceInterchange([
        workspace("duplicate", "첫 번째"),
        workspace("duplicate", "두 번째"),
      ]),
    ).toEqual({ ok: false, reason: "duplicate-workspace-id" });
    expect(
      encodeStudioWorkspaceInterchange([
        workspace("first", "  같은   이름 "),
        workspace("second", "같은 이름"),
      ]),
    ).toEqual({ ok: false, reason: "duplicate-workspace-name" });

    const tooMany = Array.from(
      { length: STUDIO_WORKSPACE_INTERCHANGE_MAX_WORKSPACES + 1 },
      (_, index) => workspace(`portable-${index}`, `작업공간 ${index}`),
    );
    expect(encodeStudioWorkspaceInterchange(tooMany)).toEqual({
      ok: false,
      reason: "too-many-workspaces",
    });
  });
});

describe("Studio workspace import planner actions", () => {
  it("defaults to add-without-apply and never mutates or activates imported state", () => {
    const current = currentState();
    const before = JSON.stringify(current);
    const result = planStudioWorkspaceInterchangeImport(
      current,
      encoded([workspace("portable-add", "가져온 작업공간")]),
      { createConflictId: () => "unused-id" },
    );

    expect(result.ok).toBe(true);
    expect(JSON.stringify(current)).toBe(before);
    if (!result.ok) return;
    expect(result.plan.action).toBe("add");
    expect(result.plan.operations).toMatchObject([
      {
        kind: "add",
        sourceWorkspaceId: "portable-add",
        targetWorkspaceId: "portable-add",
        renamed: false,
        idRemapped: false,
      },
    ]);
    expect(result.plan.nextState.activeWorkspaceId).toBe("storyboard");
    expect(result.plan.nextState.livePresentation).toEqual(
      presentation("current"),
    );
    expect(result.plan.nextState.workspaces).toHaveLength(2);
    expectDeepFrozen(result);
  });

  it("supports the real first-run state with no saved user workspaces", () => {
    const result = planStudioWorkspaceInterchangeImport(
      currentState([]),
      encoded([workspace("first-portable", "첫 작업공간")]),
      { createConflictId: () => "unused-id" },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.nextState.workspaces).toHaveLength(1);
    expect(result.plan.nextState.activeWorkspaceId).toBe("storyboard");
    expect(result.plan.nextState.livePresentation).toEqual(
      presentation("current"),
    );
  });

  it("adds and applies only when add-and-apply is explicit", () => {
    const imported = workspace("portable-apply", "적용할 작업공간");
    const result = planStudioWorkspaceInterchangeImport(
      currentState(),
      encoded([imported]),
      {
        action: "add-and-apply",
        createConflictId: () => "unused-id",
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.nextState.activeWorkspaceId).toBe("portable-apply");
    expect(result.plan.nextState.livePresentation).toEqual(
      imported.presentation,
    );
  });

  it("replaces a same-name snapshot only when replace-same-name is explicit", () => {
    const existing = workspace(
      "custom-existing",
      "교체 대상",
      presentation("current"),
    );
    const current = currentState([existing]);
    const before = JSON.stringify(current);
    const imported = workspace(
      "portable-replacement",
      "교체 대상",
      presentation("imported"),
    );
    const result = planStudioWorkspaceInterchangeImport(
      current,
      encoded([imported]),
      {
        action: "replace-same-name",
        createConflictId: () => "unused-id",
      },
    );

    expect(result.ok).toBe(true);
    expect(JSON.stringify(current)).toBe(before);
    if (!result.ok) return;
    expect(result.plan.operations).toMatchObject([
      {
        kind: "replace",
        sourceWorkspaceId: "portable-replacement",
        targetWorkspaceId: "custom-existing",
        idRemapped: true,
      },
    ]);
    expect(result.plan.nextState.workspaces).toHaveLength(1);
    expect(result.plan.nextState.workspaces[0]?.presentation).toEqual(
      presentation("imported"),
    );
    expect(result.plan.nextState.activeWorkspaceId).toBe("storyboard");
    expect(result.plan.nextState.livePresentation).toEqual(
      presentation("current"),
    );
  });

  it("lets add-and-apply select one workspace from a multi-workspace file", () => {
    const first = workspace("portable-first", "첫 번째 가져오기");
    const second = workspace(
      "portable-second",
      "두 번째 가져오기",
      presentation("current"),
    );
    const result = planStudioWorkspaceInterchangeImport(
      currentState(),
      encoded([first, second]),
      {
        action: "add-and-apply",
        applyWorkspaceId: "portable-second",
        createConflictId: () => "unused-id",
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.nextState.activeWorkspaceId).toBe("portable-second");
    expect(result.plan.nextState.livePresentation).toEqual(
      second.presentation,
    );

    expect(
      planStudioWorkspaceInterchangeImport(
        currentState(),
        encoded([first]),
        {
          action: "add-and-apply",
          applyWorkspaceId: "not-in-file",
          createConflictId: () => "unused-id",
        },
      ),
    ).toEqual({ ok: false, reason: "unknown-apply-workspace" });
  });
});

describe("Studio workspace import scopes and conflicts", () => {
  it("restores only selected scopes and preserves every unselected current value", () => {
    const current = currentState();
    const imported = workspace("scoped", "패널만 가져오기");
    const result = planStudioWorkspaceInterchangeImport(
      current,
      encoded([imported]),
      {
        action: "add-and-apply",
        scopes: ["panels"],
        createConflictId: () => "unused-id",
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const restored = result.plan.nextState.livePresentation;
    expect(restored.panels).toEqual(imported.presentation.panels);
    expect(restored.drawingPalettes).toEqual(
      current.livePresentation.drawingPalettes,
    );
    expect(restored.quickActions).toEqual(
      current.livePresentation.quickActions,
    );
    expect(restored.quickAccess).toEqual(current.livePresentation.quickAccess);
    expect(restored.commandBar).toEqual(current.livePresentation.commandBar);
  });

  it("groups radial quick actions and Quick Access under the quickAccess restore scope", () => {
    const current = currentState();
    const imported = workspace("quick-scope", "빠른 액세스만");
    const result = planStudioWorkspaceInterchangeImport(
      current,
      encoded([imported]),
      {
        action: "add-and-apply",
        scopes: ["quickAccess"],
        createConflictId: () => "unused-id",
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const restored = result.plan.nextState.livePresentation;
    expect(restored.panels).toEqual(current.livePresentation.panels);
    expect(restored.drawingPalettes).toEqual(
      current.livePresentation.drawingPalettes,
    );
    expect(restored.quickActions).toEqual(imported.presentation.quickActions);
    expect(restored.quickAccess).toEqual(imported.presentation.quickAccess);
    expect(restored.commandBar).toEqual(imported.presentation.commandBar);
  });

  it("preserves the replacement snapshot, not the live layout, for unselected scopes", () => {
    const replacementPresentation = {
      ...presentation("current"),
      drawingPalettes: presentation("imported").drawingPalettes,
      quickActions: presentation("imported").quickActions,
      quickAccess: presentation("imported").quickAccess,
    };
    const replacement = workspace(
      "replace-scoped",
      "부분 교체",
      replacementPresentation,
    );
    const imported = workspace(
      "incoming-scoped",
      "부분 교체",
      presentation("imported"),
    );
    const result = planStudioWorkspaceInterchangeImport(
      currentState([replacement]),
      encoded([imported]),
      {
        action: "replace-same-name",
        scopes: ["panels"],
        createConflictId: () => "unused-id",
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const snapshot = result.plan.nextState.workspaces[0]?.presentation;
    expect(snapshot?.panels).toEqual(imported.presentation.panels);
    expect(snapshot?.drawingPalettes).toEqual(
      replacement.presentation.drawingPalettes,
    );
    expect(snapshot?.quickActions).toEqual(
      replacement.presentation.quickActions,
    );
    expect(snapshot?.quickAccess).toEqual(
      replacement.presentation.quickAccess,
    );
    expect(snapshot?.commandBar).toEqual(
      replacement.presentation.commandBar,
    );
    expect(result.plan.nextState.livePresentation).toEqual(
      presentation("current"),
    );
  });

  it("remaps colliding IDs through the injected factory and deterministically renames adds", () => {
    const current = currentState([
      workspace("collision", "이미 존재", presentation("current")),
    ]);
    const candidates = ["collision", "custom-remapped"];
    const createConflictId = vi.fn(() => candidates.shift() ?? "exhausted");
    const result = planStudioWorkspaceInterchangeImport(
      current,
      encoded([workspace("collision", "이미 존재")]),
      { createConflictId },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(createConflictId).toHaveBeenCalledTimes(2);
    expect(result.plan.operations).toMatchObject([
      {
        kind: "add",
        sourceWorkspaceId: "collision",
        targetWorkspaceId: "custom-remapped",
        renamed: true,
        idRemapped: true,
        workspace: { name: "이미 존재 가져옴" },
      },
    ]);
  });

  it("fails atomically when the catalog limit or ID factory budget is exhausted", () => {
    const fullCatalog = Array.from(
      { length: STUDIO_WORKSPACE_INTERCHANGE_MAX_WORKSPACES },
      (_, index) =>
        workspace(`current-${index}`, `현재 ${index}`, presentation("current")),
    );
    expect(
      planStudioWorkspaceInterchangeImport(
        currentState(fullCatalog),
        encoded([workspace("one-more", "하나 더")]),
        { createConflictId: () => "unused-id" },
      ),
    ).toEqual({ ok: false, reason: "catalog-full" });

    expect(
      planStudioWorkspaceInterchangeImport(
        currentState([
          workspace("collision", "기존", presentation("current")),
        ]),
        encoded([workspace("collision", "새 이름")]),
        { createConflictId: () => "collision" },
      ),
    ).toEqual({ ok: false, reason: "id-factory-exhausted" });
  });
});

describe("Studio workspace interchange hostile input boundary", () => {
  it("rejects malformed roots, unknown kind/version, cycles, and oversized UTF-8 input", () => {
    expect(decodeStudioWorkspaceInterchange("{")).toEqual({
      ok: false,
      reason: "invalid-shape",
    });
    expect(
      decodeStudioWorkspaceInterchange({
        kind: "some.other.format",
        version: STUDIO_WORKSPACE_INTERCHANGE_VERSION,
        workspaces: [workspace("portable", "포터블")],
      }),
    ).toEqual({ ok: false, reason: "unsupported-kind" });
    expect(
      decodeStudioWorkspaceInterchange({
        kind: STUDIO_WORKSPACE_INTERCHANGE_KIND,
        version: 99,
        workspaces: [workspace("portable", "포터블")],
      }),
    ).toEqual({ ok: false, reason: "unsupported-version" });

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(
      encodeStudioWorkspaceInterchange([
        workspace("cyclic", "순환", {
          ...presentation(),
          quickAccess:
            cyclic as unknown as StudioWorkspaceInterchangePresentation["quickAccess"],
        }),
      ]),
    ).toEqual({ ok: false, reason: "invalid-shape" });

    const oversized = JSON.stringify({
      kind: STUDIO_WORKSPACE_INTERCHANGE_KIND,
      version: STUDIO_WORKSPACE_INTERCHANGE_VERSION,
      workspaces: [],
      padding: "가".repeat(STUDIO_WORKSPACE_INTERCHANGE_MAX_BYTES),
    });
    expect(decodeStudioWorkspaceInterchange(oversized)).toEqual({
      ok: false,
      reason: "payload-too-large",
    });
  });

  it("never invokes accessors and fails closed when Proxy reflection is hostile", () => {
    const getter = vi.fn(() => STUDIO_WORKSPACE_INTERCHANGE_KIND);
    const accessorRoot = {
      version: STUDIO_WORKSPACE_INTERCHANGE_VERSION,
      workspaces: [workspace("portable", "포터블")],
    };
    Object.defineProperty(accessorRoot, "kind", {
      enumerable: true,
      get: getter,
    });

    expect(decodeStudioWorkspaceInterchange(accessorRoot)).toEqual({
      ok: false,
      reason: "invalid-shape",
    });
    expect(getter).not.toHaveBeenCalled();

    const nestedGetter = vi.fn(() => "nested-secret");
    const nestedQuickAccess = {
      ...presentation().quickAccess,
    };
    Object.defineProperty(nestedQuickAccess, "sets", {
      enumerable: true,
      get: nestedGetter,
    });
    expect(
      encodeStudioWorkspaceInterchange([
        workspace("nested-getter", "중첩 접근자", {
          ...presentation(),
          quickAccess:
            nestedQuickAccess as StudioWorkspaceInterchangePresentation["quickAccess"],
        }),
      ]),
    ).toEqual({ ok: false, reason: "invalid-shape" });
    expect(nestedGetter).not.toHaveBeenCalled();

    const hostileProxy = new Proxy(accessorRoot, {
      ownKeys: () => {
        throw new Error("hostile ownKeys");
      },
    });
    expect(decodeStudioWorkspaceInterchange(hostileProxy)).toEqual({
      ok: false,
      reason: "invalid-shape",
    });
  });

  it("rejects every unknown Quick Access field, including innocuous credential wrappers", () => {
    const secret = "sk-never-serialize-this-value";
    for (const unknownKey of [
      "apiKey",
      "deepseek_api_key",
      "accessToken",
      "sessionToken",
      "identity",
      "email",
      "phone",
      "session",
      "cookie",
      "oauth",
      "refresh",
      "key",
      "value",
      "project",
      "artwork",
      "assets",
      "assetId",
      "comments",
      "account",
      "user",
      "userName",
      "provider",
      "providerModel",
    ]) {
      const baseQuickAccess = presentation().quickAccess!;
      const firstSet = baseQuickAccess.sets[0]!;
      const quickAccessLeak = encodeStudioWorkspaceInterchange([
        workspace(`leak-${unknownKey.replaceAll("_", "-")}`, "누출 방지", {
          ...presentation(),
          quickAccess: {
            ...baseQuickAccess,
            sets: [{
              ...firstSet,
              [unknownKey]: {
                value: secret,
              },
            }],
          } as StudioWorkspaceInterchangePresentation["quickAccess"],
        }),
      ]);
      expect(quickAccessLeak.ok, unknownKey).toBe(false);
      expect(JSON.stringify(quickAccessLeak)).not.toContain(secret);
    }

    const sourceWithAccount = {
      ...workspace("leak-account", "계정 누출 방지"),
      account: { id: secret },
    };
    const accountLeak = encodeStudioWorkspaceInterchange([sourceWithAccount]);
    expect(accountLeak).toEqual({
      ok: false,
      reason: "sensitive-field",
    });
    expect(JSON.stringify(accountLeak)).not.toContain(secret);

    const safe = encodeStudioWorkspaceInterchange([
      workspace("safe", "안전한 작업공간"),
    ]);
    expect(safe.ok).toBe(true);
    if (!safe.ok) return;
    for (const forbidden of [
      "project",
      "artwork",
      "assets",
      "comments",
      "account",
      "user",
      "provider",
      "apiKey",
    ]) {
      expect(safe.text).not.toContain(`"${forbidden}"`);
    }
    expect(new TextEncoder().encode(safe.text).byteLength).toBeLessThanOrEqual(
      STUDIO_WORKSPACE_INTERCHANGE_MAX_BYTES,
    );
  });

  it("accepts only the exact six-slot radial quick-action preference schema", () => {
    const baseQuickActions = presentation().quickActions!;
    const unknownRoot = {
      ...baseQuickActions,
      identity: "must-not-cross",
    };
    const unknownSlot = {
      ...baseQuickActions,
      slots: {
        ...baseQuickActions.slots,
        credential: "undo",
      },
    };
    const missingSlot = {
      ...baseQuickActions,
      slots: {
        north: "undo",
      },
    };

    for (const quickActions of [unknownRoot, unknownSlot, missingSlot]) {
      const result = encodeStudioWorkspaceInterchange([
        workspace("radial-exact", "정확한 퀵 액션", {
          ...presentation(),
          quickActions:
            quickActions as StudioWorkspaceInterchangePresentation["quickActions"],
        }),
      ]);
      expect(result.ok).toBe(false);
    }
  });

  it("rejects prototype-shaped Quick Access keys instead of preserving extension data", () => {
    for (const unknownKey of ["__proto__", "constructor", "prototype"]) {
      const unsafe = Object.assign(Object.create(null), presentation().quickAccess);
      Object.defineProperty(unsafe, unknownKey, {
        configurable: true,
        enumerable: true,
        value: { polluted: true },
        writable: true,
      });
      const exported = encodeStudioWorkspaceInterchange([
        workspace("prototype-safe", "프로토타입 안전", {
          ...presentation(),
          quickAccess:
            unsafe as StudioWorkspaceInterchangePresentation["quickAccess"],
        }),
      ]);
      expect(exported.ok, unknownKey).toBe(false);
    }
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});

describe("Studio workspace interchange command bar", () => {
  function documentTextWithCommandBar(commandBar: unknown): string {
    return JSON.stringify({
      kind: STUDIO_WORKSPACE_INTERCHANGE_KIND,
      version: STUDIO_WORKSPACE_INTERCHANGE_VERSION,
      workspaces: [{
        id: "portable-bar",
        name: "커맨드 바",
        presentation: { ...legacyPresentation(), commandBar },
      }],
    });
  }

  it("round-trips command-bar slots and visibility through export, decode, and apply", () => {
    const text = encoded([workspace("portable-bar", "커맨드 바 이동")]);
    expect(text).toContain('"commandBar"');

    const decoded = decodeStudioWorkspaceInterchange(text);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.document.workspaces[0]?.presentation.commandBar).toEqual(
      presentation("imported").commandBar,
    );

    const result = planStudioWorkspaceInterchangeImport(
      currentState(),
      text,
      { action: "add-and-apply", createConflictId: () => "unused-id" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.nextState.livePresentation.commandBar).toEqual(
      presentation("imported").commandBar,
    );
    expectDeepFrozen(result.plan.nextState.livePresentation.commandBar);
  });

  it("imports legacy files without the commandBar key exactly as today", () => {
    const text = encoded([
      workspace("legacy-portable", "레거시 파일", legacyPresentation()),
    ]);
    expect(text).not.toContain("commandBar");

    const decoded = decodeStudioWorkspaceInterchange(text);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(
      "commandBar" in (decoded.document.workspaces[0]?.presentation ?? {}),
    ).toBe(false);

    // A current state with a customized bar keeps it: legacy files never overwrite it.
    const applied = planStudioWorkspaceInterchangeImport(
      currentState(),
      text,
      { action: "add-and-apply", createConflictId: () => "unused-id" },
    );
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.plan.nextState.livePresentation.commandBar).toEqual(
      presentation("current").commandBar,
    );

    // A fully legacy pipeline stays legacy: no commandBar key materializes anywhere.
    const legacyState: StudioWorkspaceInterchangeTargetState = {
      activeWorkspaceId: "storyboard",
      livePresentation: legacyPresentation("current"),
      workspaces: [],
    };
    const legacyResult = planStudioWorkspaceInterchangeImport(
      legacyState,
      text,
      { action: "add-and-apply", createConflictId: () => "unused-id" },
    );
    expect(legacyResult.ok).toBe(true);
    if (!legacyResult.ok) return;
    expect(
      "commandBar" in legacyResult.plan.nextState.livePresentation,
    ).toBe(false);
    expect(
      "commandBar" in (legacyResult.plan.nextState.workspaces[0]?.presentation ?? {}),
    ).toBe(false);
  });

  it("drops every malformed commandBar to the default bar without failing the file", () => {
    const malformedVariants: readonly unknown[] = [
      "visible",
      42,
      [],
      {},
      { version: 2, visible: false, slots: presentation("imported").commandBar?.slots },
      { version: 1, visible: false, slots: "all" },
      { version: 1, visible: false, slots: Array.from({ length: 9 }, () => null) },
      { ...presentation("imported").commandBar, unknownField: true },
    ];
    for (const commandBar of malformedVariants) {
      const decoded = decodeStudioWorkspaceInterchange(
        documentTextWithCommandBar(commandBar),
      );
      expect(decoded.ok, JSON.stringify(commandBar)).toBe(true);
      if (!decoded.ok) continue;
      expect(decoded.document.workspaces[0]?.presentation.commandBar).toEqual(
        DEFAULT_STUDIO_COMMAND_BAR,
      );
    }
  });

  it("recovers slot by slot so one corrupt slot never discards the customization", () => {
    const decoded = decodeStudioWorkspaceInterchange(
      documentTextWithCommandBar({
        version: 1,
        visible: false,
        slots: ["publish", "not-a-command"],
      }),
    );
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.document.workspaces[0]?.presentation.commandBar).toEqual({
      version: 1,
      visible: false,
      slots: ["publish", "redo", "save", "export-open", "zoom-fit", null, null, null],
    });
  });

  it("never invokes commandBar accessors and normalizes hostile shapes on export", () => {
    const getter = vi.fn(() => presentation("imported").commandBar?.slots);
    const hostileBar: Record<string, unknown> = { version: 1, visible: true };
    Object.defineProperty(hostileBar, "slots", {
      enumerable: true,
      get: getter,
    });
    const decoded = decodeStudioWorkspaceInterchange({
      kind: STUDIO_WORKSPACE_INTERCHANGE_KIND,
      version: STUDIO_WORKSPACE_INTERCHANGE_VERSION,
      workspaces: [{
        id: "portable-bar",
        name: "커맨드 바",
        presentation: { ...legacyPresentation(), commandBar: hostileBar },
      }],
    });
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.document.workspaces[0]?.presentation.commandBar).toEqual(
      DEFAULT_STUDIO_COMMAND_BAR,
    );
    expect(getter).not.toHaveBeenCalled();

    const exported = encodeStudioWorkspaceInterchange([
      workspace("normalized-bar", "정규화된 바", {
        ...legacyPresentation(),
        commandBar: {
          version: 99,
        } as unknown as StudioWorkspaceInterchangePresentation["commandBar"],
      }),
    ]);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.document.workspaces[0]?.presentation.commandBar).toEqual(
      DEFAULT_STUDIO_COMMAND_BAR,
    );
  });

  it("hard-fails on sensitive keys inside commandBar and never serializes the secret", () => {
    const secret = "sk-command-bar-never-crosses";
    const decoded = decodeStudioWorkspaceInterchange(
      documentTextWithCommandBar({ apiKey: { value: secret } }),
    );
    expect(decoded).toEqual({ ok: false, reason: "sensitive-field" });
    expect(JSON.stringify(decoded)).not.toContain(secret);

    const exported = encodeStudioWorkspaceInterchange([
      workspace("leak-bar", "커맨드 바 누출 방지", {
        ...legacyPresentation(),
        commandBar: {
          accessToken: secret,
        } as unknown as StudioWorkspaceInterchangePresentation["commandBar"],
      }),
    ]);
    expect(exported).toEqual({ ok: false, reason: "sensitive-field" });
    expect(JSON.stringify(exported)).not.toContain(secret);
  });

  it("omits the command bar from exports when includeCommandBar is false", () => {
    const exported = encodeStudioWorkspaceInterchange(
      [workspace("bar-opt-out", "바 제외 내보내기")],
      { includeCommandBar: false },
    );
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.text).not.toContain("commandBar");
    expect(exported.document.workspaces[0]?.presentation.quickAccess).toEqual(
      presentation("imported").quickAccess,
    );
  });
});
