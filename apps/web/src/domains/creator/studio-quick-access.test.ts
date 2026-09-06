import { describe, expect, it, vi } from "vitest";

import {
  activateStudioQuickAccessSet,
  addStudioQuickAccessCommand,
  configureStudioQuickAccessView,
  createStudioQuickAccessSet,
  DEFAULT_STUDIO_QUICK_ACCESS_COMMAND_IDS,
  DEFAULT_STUDIO_QUICK_ACCESS_STATE,
  deleteStudioQuickAccessSet,
  duplicateStudioQuickAccessSet,
  encodeStudioQuickAccessState,
  normalizeStudioQuickAccessState,
  planStudioQuickAccessExecution,
  projectStudioQuickAccessSet,
  removeStudioQuickAccessCommand,
  renameStudioQuickAccessSet,
  reorderStudioQuickAccessCommand,
  reorderStudioQuickAccessSet,
  restoreActiveStudioQuickAccessSetDefaults,
  restoreAllStudioQuickAccessDefaults,
  searchStudioQuickAccessCommands,
  STUDIO_QUICK_ACCESS_MAX_COMMANDS,
  STUDIO_QUICK_ACCESS_MAX_SERIALIZED_LENGTH,
  STUDIO_QUICK_ACCESS_MAX_SETS,
  STUDIO_QUICK_ACCESS_VERSION,
  type StudioQuickAccessCommandMeta,
  type StudioQuickAccessState,
} from "./studio-quick-access";

const CATALOG: readonly StudioQuickAccessCommandMeta[] = [
  {
    id: "undo",
    label: "실행 취소",
    description: "마지막 편집을 되돌립니다",
    category: "편집",
    keywords: ["되돌리기", "Undo"],
    shortcut: "Ctrl+Z",
  },
  {
    id: "pen",
    label: "Ｇ펜",
    description: "부드러운 잉크 선",
    category: "그리기 도구",
    keywords: ["브러시", "INK"],
    shortcut: "P",
  },
  {
    id: "locked-command",
    label: "잠긴 명령",
    available: false,
  },
];

function stateWith(
  sets: StudioQuickAccessState["sets"],
  activeSetId = sets[0]!.id
): StudioQuickAccessState {
  return normalizeStudioQuickAccessState({
    version: STUDIO_QUICK_ACCESS_VERSION,
    sets,
    activeSetId,
    displayMode: "tiles",
    density: "comfortable",
  });
}

function expectDeepFrozen(value: unknown): void {
  expect(Object.isFrozen(value)).toBe(true);
  if (!value || typeof value !== "object") return;
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

describe("studio quick access durable state", () => {
  it("starts with one bounded CLIP-style set and deep-freezes every canonical branch", () => {
    expect(DEFAULT_STUDIO_QUICK_ACCESS_STATE).toMatchObject({
      version: 1,
      activeSetId: "quick-access-default",
      displayMode: "tiles",
      density: "comfortable",
    });
    expect(DEFAULT_STUDIO_QUICK_ACCESS_STATE.sets).toHaveLength(1);
    expect(DEFAULT_STUDIO_QUICK_ACCESS_STATE.sets[0]!.commandIds).toEqual(
      DEFAULT_STUDIO_QUICK_ACCESS_COMMAND_IDS
    );
    expectDeepFrozen(DEFAULT_STUDIO_QUICK_ACCESS_STATE);
  });

  it("preserves identity for internally canonical defaults, normalized state, and no-op operations", () => {
    expect(normalizeStudioQuickAccessState(DEFAULT_STUDIO_QUICK_ACCESS_STATE))
      .toBe(DEFAULT_STUDIO_QUICK_ACCESS_STATE);
    const normalized = stateWith([{
      id: "drawing",
      name: "Drawing",
      commandIds: ["pen", "undo"],
    }]);
    expect(normalizeStudioQuickAccessState(normalized)).toBe(normalized);

    expect(renameStudioQuickAccessSet(normalized, "drawing", "Drawing")).toBe(normalized);
    expect(deleteStudioQuickAccessSet(normalized, "missing")).toBe(normalized);
    expect(reorderStudioQuickAccessSet(normalized, "drawing", 0)).toBe(normalized);
    expect(activateStudioQuickAccessSet(normalized, "drawing")).toBe(normalized);
    expect(configureStudioQuickAccessView(normalized, {
      displayMode: "tiles",
      density: "comfortable",
    })).toBe(normalized);
    expect(addStudioQuickAccessCommand(normalized, "drawing", "pen")).toBe(normalized);
    expect(removeStudioQuickAccessCommand(normalized, "drawing", "missing")).toBe(normalized);
    expect(reorderStudioQuickAccessCommand(normalized, "drawing", "pen", 0)).toBe(normalized);
    expect(duplicateStudioQuickAccessSet(
      normalized,
      "missing",
      () => "must-not-be-used"
    )).toBe(normalized);
    expect(restoreActiveStudioQuickAccessSetDefaults(
      DEFAULT_STUDIO_QUICK_ACCESS_STATE
    )).toBe(DEFAULT_STUDIO_QUICK_ACCESS_STATE);
  });

  it("never trusts externally frozen unknown, hidden, or accessor shapes as canonical", () => {
    const frozenSet = Object.freeze({
      id: "external",
      name: "External",
      commandIds: Object.freeze(["pen"]),
    });
    const exactExternal = Object.freeze({
      version: STUDIO_QUICK_ACCESS_VERSION,
      sets: Object.freeze([frozenSet]),
      activeSetId: "external",
      displayMode: "tiles" as const,
      density: "comfortable" as const,
    });
    const normalizedExact = normalizeStudioQuickAccessState(exactExternal);
    expect(normalizedExact).toEqual(exactExternal);
    expect(normalizedExact).not.toBe(exactExternal);

    const withUnknown = Object.freeze({
      ...exactExternal,
      apiKey: "must-drop",
    });
    const normalizedUnknown = normalizeStudioQuickAccessState(withUnknown);
    expect(normalizedUnknown).not.toBe(withUnknown);
    expect(normalizedUnknown).not.toHaveProperty("apiKey");

    const withHidden = {
      ...exactExternal,
    };
    Object.defineProperty(withHidden, "providerKey", {
      value: "must-drop",
      enumerable: false,
    });
    Object.freeze(withHidden);
    const normalizedHidden = normalizeStudioQuickAccessState(withHidden);
    expect(normalizedHidden).not.toBe(withHidden);
    expect(Object.hasOwn(normalizedHidden, "providerKey")).toBe(false);

    let activeSetReads = 0;
    const withAccessor = {
      version: STUDIO_QUICK_ACCESS_VERSION,
      sets: exactExternal.sets,
      displayMode: "tiles" as const,
      density: "comfortable" as const,
    } as Record<string, unknown>;
    Object.defineProperty(withAccessor, "activeSetId", {
      get() {
        activeSetReads += 1;
        return "external";
      },
      enumerable: true,
    });
    Object.freeze(withAccessor);
    activeSetReads = 0;
    const normalizedAccessor = normalizeStudioQuickAccessState(withAccessor);
    expect(activeSetReads).toBe(1);
    expect(normalizedAccessor).not.toBe(withAccessor);
    expect(normalizedAccessor.activeSetId).toBe("external");
    expect(Object.getOwnPropertyDescriptor(normalizedAccessor, "activeSetId"))
      .not.toHaveProperty("get");
  });

  it.each([
    undefined,
    null,
    false,
    1,
    [],
    {},
    { version: 2, sets: [] },
    { version: 1, sets: [] },
    "{bad-json",
  ])("falls back safely for malformed or unsupported roots: %j", (raw) => {
    expect(normalizeStudioQuickAccessState(raw)).toEqual(
      DEFAULT_STUDIO_QUICK_ACCESS_STATE
    );
  });

  it("normalizes field-by-field, deduplicates IDs, preserves unknown commands, and repairs active/view fields", () => {
    const normalized = normalizeStudioQuickAccessState({
      version: 1,
      sets: [
        {
          id: "set-a",
          name: "  Ｍｙ   세트  ",
          commandIds: ["pen", "future.command", "pen", "", null],
          provider: "must-drop",
        },
        {
          id: "set-a",
          name: "duplicate id",
          commandIds: ["undo"],
        },
        {
          id: "set-b",
          name: "\u200B",
          commandIds: "not-an-array",
        },
      ],
      activeSetId: "missing",
      displayMode: "cards",
      density: "tiny",
      accountId: "acct-secret",
      projectId: "project-secret",
      apiKey: "sk-secret",
    });

    expect(normalized).toEqual({
      version: 1,
      sets: [
        {
          id: "set-a",
          name: "My 세트",
          commandIds: ["pen", "future.command"],
        },
        {
          id: "set-b",
          name: "빠른 액세스 2",
          commandIds: [],
        },
      ],
      activeSetId: "set-a",
      displayMode: "tiles",
      density: "comfortable",
    });
    expectDeepFrozen(normalized);
  });

  it("round-trips JSON while serializing only the exact durable allowlist", () => {
    const encoded = encodeStudioQuickAccessState({
      version: 1,
      sets: [{
        id: "safe-set",
        name: "내 도구",
        commandIds: ["pen", "unknown.future"],
        handler: () => undefined,
        token: "provider-key",
      }],
      activeSetId: "safe-set",
      displayMode: "list",
      density: "compact",
      account: { id: "account-id" },
      project: { id: "project-id" },
      provider: "secret-provider",
      apiKey: "secret-key",
    });
    const parsed = JSON.parse(encoded) as Record<string, unknown>;

    expect(Object.keys(parsed)).toEqual([
      "version",
      "sets",
      "activeSetId",
      "displayMode",
      "density",
    ]);
    expect(Object.keys((parsed.sets as Record<string, unknown>[])[0]!)).toEqual([
      "id",
      "name",
      "commandIds",
    ]);
    expect(encoded).not.toContain("account");
    expect(encoded).not.toContain("project");
    expect(encoded).not.toContain("provider");
    expect(encoded).not.toContain("secret");
    expect(normalizeStudioQuickAccessState(encoded)).toEqual(
      normalizeStudioQuickAccessState(parsed)
    );
  });

  it("bounds hostile arrays and serialized input without losing valid unknown IDs", () => {
    const commandIds = Array.from(
      { length: STUDIO_QUICK_ACCESS_MAX_COMMANDS * 8 },
      (_, index) => `future.command-${index}`
    );
    const sets = Array.from(
      { length: STUDIO_QUICK_ACCESS_MAX_SETS * 8 },
      (_, index) => ({
        id: `set-${index}`,
        name: `Set ${index}`,
        commandIds,
      })
    );
    const normalized = normalizeStudioQuickAccessState({
      version: 1,
      sets,
      activeSetId: "set-99",
      displayMode: "list",
      density: "large",
    });

    expect(normalized.sets).toHaveLength(STUDIO_QUICK_ACCESS_MAX_SETS);
    expect(normalized.sets.every(
      (set) => set.commandIds.length === STUDIO_QUICK_ACCESS_MAX_COMMANDS
    )).toBe(true);
    expect(normalized.sets[0]!.commandIds.at(-1)).toBe(
      `future.command-${STUDIO_QUICK_ACCESS_MAX_COMMANDS - 1}`
    );
    expect(normalizeStudioQuickAccessState(
      "x".repeat(STUDIO_QUICK_ACCESS_MAX_SERIALIZED_LENGTH + 1)
    )).toEqual(DEFAULT_STUDIO_QUICK_ACCESS_STATE);
  });

  it("contains getter/proxy failures and does not mutate hostile input", () => {
    const throwing = new Proxy({}, {
      get() {
        throw new Error("hostile getter");
      },
      has() {
        throw new Error("hostile has");
      },
    });
    expect(() => normalizeStudioQuickAccessState(throwing)).not.toThrow();
    expect(normalizeStudioQuickAccessState(throwing)).toEqual(
      DEFAULT_STUDIO_QUICK_ACCESS_STATE
    );

    const raw = {
      version: 1,
      sets: [{ id: "a", name: "A", commandIds: ["pen"] }],
      activeSetId: "a",
      displayMode: "tiles",
      density: "comfortable",
    };
    const snapshot = structuredClone(raw);
    normalizeStudioQuickAccessState(raw);
    expect(raw).toEqual(snapshot);
  });
});

describe("studio quick access set operations", () => {
  it("creates, renames, duplicates, activates, reorders, and deletes sets deterministically", () => {
    const ids = ["set-two", "set-three"];
    const idFactory = vi.fn(() => ids.shift() ?? "unused");
    let state = createStudioQuickAccessSet(
      DEFAULT_STUDIO_QUICK_ACCESS_STATE,
      "  펜   도구  ",
      idFactory
    );
    expect(state.activeSetId).toBe("set-two");
    expect(state.sets[1]).toEqual({
      id: "set-two",
      name: "펜 도구",
      commandIds: [],
    });

    state = renameStudioQuickAccessSet(state, "set-two", "  자주 쓰는 도구 ");
    state = duplicateStudioQuickAccessSet(state, "set-two", idFactory);
    expect(state.activeSetId).toBe("set-three");
    expect(state.sets.map((set) => set.id)).toEqual([
      "quick-access-default",
      "set-two",
      "set-three",
    ]);
    expect(state.sets[2]).toMatchObject({
      name: "자주 쓰는 도구 복사본",
      commandIds: [],
    });

    state = reorderStudioQuickAccessSet(state, "set-three", -99);
    expect(state.sets.map((set) => set.id)).toEqual([
      "set-three",
      "quick-access-default",
      "set-two",
    ]);
    state = activateStudioQuickAccessSet(state, "set-two");
    state = deleteStudioQuickAccessSet(state, "set-two");
    expect(state.activeSetId).toBe("quick-access-default");
    expect(state.sets.map((set) => set.id)).toEqual([
      "set-three",
      "quick-access-default",
    ]);
    expect(idFactory).toHaveBeenCalledTimes(2);
    expectDeepFrozen(state);
  });

  it("selects the nearest survivor when deleting the active middle set", () => {
    const state = stateWith([
      { id: "a", name: "A", commandIds: [] },
      { id: "b", name: "B", commandIds: [] },
      { id: "c", name: "C", commandIds: [] },
    ], "b");
    const deleted = deleteStudioQuickAccessSet(state, "b");
    expect(deleted.activeSetId).toBe("c");
    expect(deleteStudioQuickAccessSet(
      stateWith([{ id: "only", name: "Only", commandIds: [] }]),
      "only"
    ).sets).toHaveLength(1);
  });

  it("retries duplicate/invalid factory IDs within a fixed bound and contains factory errors", () => {
    const sequence = ["quick-access-default", " invalid ", "valid-id"];
    const created = createStudioQuickAccessSet(
      DEFAULT_STUDIO_QUICK_ACCESS_STATE,
      "",
      () => sequence.shift() ?? "never"
    );
    expect(created.activeSetId).toBe("valid-id");
    expect(created.sets[1]!.name).toBe("빠른 액세스 2");

    const throwingFactory = () => {
      throw new Error("no entropy");
    };
    expect(() => createStudioQuickAccessSet(
      DEFAULT_STUDIO_QUICK_ACCESS_STATE,
      "A",
      throwingFactory
    )).not.toThrow();
    expect(createStudioQuickAccessSet(
      DEFAULT_STUDIO_QUICK_ACCESS_STATE,
      "A",
      throwingFactory
    )).toEqual(DEFAULT_STUDIO_QUICK_ACCESS_STATE);
  });

  it("never exceeds twelve sets and keeps view configuration allowlisted", () => {
    let state = DEFAULT_STUDIO_QUICK_ACCESS_STATE;
    for (let index = 1; index < STUDIO_QUICK_ACCESS_MAX_SETS + 4; index += 1) {
      state = createStudioQuickAccessSet(state, `Set ${index}`, () => `set-${index}`);
    }
    expect(state.sets).toHaveLength(STUDIO_QUICK_ACCESS_MAX_SETS);

    const configured = configureStudioQuickAccessView(state, {
      displayMode: "list",
      density: "large",
    });
    expect(configured).toMatchObject({ displayMode: "list", density: "large" });
    expect(configureStudioQuickAccessView(configured, {
      displayMode: "bad" as "tiles",
      density: "tiny" as "compact",
    })).toMatchObject({ displayMode: "list", density: "large" });
  });
});

describe("studio quick access command operations and restore", () => {
  it("adds at a position, deduplicates, reorders, and removes commands immutably", () => {
    const source = stateWith([{ id: "set", name: "Set", commandIds: ["undo", "pen"] }]);
    let state = addStudioQuickAccessCommand(source, "set", "future.command", 1);
    expect(state.sets[0]!.commandIds).toEqual(["undo", "future.command", "pen"]);
    state = addStudioQuickAccessCommand(state, "set", "future.command", 0);
    expect(state.sets[0]!.commandIds).toEqual(["undo", "future.command", "pen"]);
    state = reorderStudioQuickAccessCommand(state, "set", "pen", 0);
    expect(state.sets[0]!.commandIds).toEqual(["pen", "undo", "future.command"]);
    state = removeStudioQuickAccessCommand(state, "set", "undo");
    expect(state.sets[0]!.commandIds).toEqual(["pen", "future.command"]);
    expect(source.sets[0]!.commandIds).toEqual(["undo", "pen"]);
    expectDeepFrozen(state);
  });

  it("enforces command caps and rejects unsafe IDs", () => {
    const full = stateWith([{
      id: "set",
      name: "Set",
      commandIds: Array.from(
        { length: STUDIO_QUICK_ACCESS_MAX_COMMANDS },
        (_, index) => `command-${index}`
      ),
    }]);
    expect(addStudioQuickAccessCommand(full, "set", "overflow").sets[0]!.commandIds)
      .toHaveLength(STUDIO_QUICK_ACCESS_MAX_COMMANDS);
    expect(addStudioQuickAccessCommand(full, "set", "../unsafe command"))
      .toEqual(full);
  });

  it("restores only active contents or the complete default model as requested", () => {
    const custom = configureStudioQuickAccessView(stateWith([
      { id: "a", name: "A", commandIds: ["custom-a"] },
      { id: "b", name: "My B", commandIds: ["custom-b"] },
    ], "b"), {
      displayMode: "list",
      density: "large",
    });
    const currentRestored = restoreActiveStudioQuickAccessSetDefaults(custom);
    expect(currentRestored.sets[0]!.commandIds).toEqual(["custom-a"]);
    expect(currentRestored.sets[1]).toEqual({
      id: "b",
      name: "My B",
      commandIds: [...DEFAULT_STUDIO_QUICK_ACCESS_COMMAND_IDS],
    });
    expect(currentRestored).toMatchObject({
      activeSetId: "b",
      displayMode: "list",
      density: "large",
    });

    const fullyRestored = restoreAllStudioQuickAccessDefaults();
    expect(fullyRestored).toEqual(DEFAULT_STUDIO_QUICK_ACCESS_STATE);
    expect(fullyRestored).not.toBe(DEFAULT_STUDIO_QUICK_ACCESS_STATE);
    expectDeepFrozen(fullyRestored);
  });
});

describe("studio quick access command catalog boundary", () => {
  it("performs NFKC/case-insensitive AND-token search across inert metadata", () => {
    expect(searchStudioQuickAccessCommands(CATALOG, "g펜 ink")).toEqual([
      expect.objectContaining({ id: "pen", label: "G펜" }),
    ]);
    expect(searchStudioQuickAccessCommands(CATALOG, "편집 CTRL+Z")).toEqual([
      expect.objectContaining({ id: "undo" }),
    ]);
    expect(searchStudioQuickAccessCommands(CATALOG, "잉크 되돌리기")).toEqual([]);
    expect(searchStudioQuickAccessCommands(CATALOG, "  ")).toHaveLength(3);
  });

  it("deduplicates and sanitizes injected metadata without retaining handlers or secrets", () => {
    const results = searchStudioQuickAccessCommands([
      {
        id: "pen",
        label: "  Ｇ펜 ",
        keywords: [" Ink ", "INK"],
        handler: () => "must-drop",
        apiKey: "must-drop",
      } as StudioQuickAccessCommandMeta,
      { id: "pen", label: "Duplicate" },
      { id: " unsafe ", label: "Unsafe" },
    ], "");
    expect(results).toEqual([{
      id: "pen",
      label: "G펜",
      keywords: ["Ink"],
      available: true,
    }]);
    expectDeepFrozen(results);
    expect(JSON.stringify(results)).not.toContain("handler");
    expect(JSON.stringify(results)).not.toContain("apiKey");
  });

  it("skips hostile metadata getters and keeps search and execution planning fail-closed", () => {
    const hostileEntry = new Proxy({}, {
      get() {
        throw new Error("hostile catalog getter");
      },
      getOwnPropertyDescriptor() {
        throw new Error("hostile catalog descriptor");
      },
    }) as StudioQuickAccessCommandMeta;
    const state = stateWith([{
      id: "drawing",
      name: "Drawing",
      commandIds: ["pen"],
    }]);

    expect(() => searchStudioQuickAccessCommands([hostileEntry], "pen")).not.toThrow();
    expect(searchStudioQuickAccessCommands([hostileEntry], "pen")).toEqual([]);
    expect(planStudioQuickAccessExecution(state, [hostileEntry], "pen")).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("keeps unknown durable commands visible but unavailable in projection", () => {
    const state = stateWith([{
      id: "drawing",
      name: "Drawing",
      commandIds: ["pen", "future.command", "locked-command"],
    }]);
    const projection = projectStudioQuickAccessSet(state, CATALOG);

    expect(projection).toEqual({
      setId: "drawing",
      setName: "Drawing",
      active: true,
      commands: [
        expect.objectContaining({ id: "pen", label: "G펜", available: true }),
        {
          id: "future.command",
          label: "future.command",
          keywords: [],
          available: false,
        },
        expect.objectContaining({
          id: "locked-command",
          label: "잠긴 명령",
          available: false,
        }),
      ],
    });
    expect(projectStudioQuickAccessSet(state, CATALOG, "missing")).toBeNull();
    expectDeepFrozen(projection);
  });

  it("plans execution only for present, registered, currently available commands", () => {
    const state = stateWith([{
      id: "drawing",
      name: "Drawing",
      commandIds: ["pen", "future.command", "locked-command"],
    }]);

    expect(planStudioQuickAccessExecution(state, CATALOG, "pen")).toEqual({
      ok: true,
      setId: "drawing",
      commandId: "pen",
    });
    expect(planStudioQuickAccessExecution(state, CATALOG, "future.command")).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(planStudioQuickAccessExecution(state, CATALOG, "locked-command")).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(planStudioQuickAccessExecution(state, CATALOG, "undo")).toEqual({
      ok: false,
      reason: "not-in-set",
    });
    expect(planStudioQuickAccessExecution(state, CATALOG, "bad command")).toEqual({
      ok: false,
      reason: "invalid-command",
    });
    expect(planStudioQuickAccessExecution(state, CATALOG, "pen", "missing")).toEqual({
      ok: false,
      reason: "set-unavailable",
    });
  });

  it("fails closed when duplicate catalog metadata disagrees about availability", () => {
    const state = stateWith([{
      id: "drawing",
      name: "Drawing",
      commandIds: ["pen"],
    }]);
    expect(planStudioQuickAccessExecution(state, [
      { id: "pen", label: "Pen", available: false },
      { id: "pen", label: "Pen duplicate", available: true },
    ], "pen")).toEqual({ ok: false, reason: "unavailable" });
  });
});
