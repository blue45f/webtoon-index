import { describe, expect, it } from "vitest";

import {
  DEFAULT_STUDIO_DRAWING_PALETTE_LAYOUT,
  moveStudioDrawingPalette,
  resizeStudioDrawingPalettes,
  setStudioDrawingPaletteLock,
  toggleStudioDrawingPalette,
} from "./brush/studio-drawing-palettes";
import { STUDIO_INSPECTOR_LAYOUT_STORAGE_KEY } from "./studio-inspector-layout";
import {
  QUICK_ACTION_IDS,
  QUICK_ACTION_SLOTS,
  STUDIO_QUICK_ACTIONS_STORAGE_KEY,
} from "./studio-quick-actions";
import {
  DEFAULT_STUDIO_COMMAND_BAR,
  DEFAULT_STUDIO_WORKSPACE_STATE,
  STUDIO_CLASSIC_WORKSPACE_IDS,
  STUDIO_COMMAND_BAR_COMMAND_IDS,
  STUDIO_COMMAND_BAR_SLOT_COUNT,
  STUDIO_DEFAULT_WORKSPACE_IDS,
  STUDIO_DEFAULT_WORKSPACES,
  STUDIO_EXPANDED_WORKSPACE_IDS,
  STUDIO_LEGACY_LEFT_PANEL_WIDTH_STORAGE_KEY,
  STUDIO_LEGACY_RIGHT_PANEL_WIDTH_STORAGE_KEY,
  STUDIO_PRO_COMIC_PALETTE_PRIORITY,
  STUDIO_WORKSPACE_LEFT_PANEL_WIDTH,
  STUDIO_WORKSPACE_MAX_CUSTOM,
  STUDIO_WORKSPACE_NAME_MAX_LENGTH,
  STUDIO_WORKSPACE_PAYLOAD_VERSION,
  STUDIO_WORKSPACE_RAW_MAX_BYTES,
  STUDIO_WORKSPACE_RIGHT_PANEL_WIDTH,
  STUDIO_WORKSPACE_STATE_VERSION,
  STUDIO_WORKSPACE_ABSENT_CATALOGUE_REQUIREMENTS,
  STUDIO_WORKSPACE_CATALOGUE_COVERAGE,
  studioWorkspaceLaunchSurface,
  STUDIO_WORKSPACE_DEVICE_KINDS,
  STUDIO_WORKSPACE_STORAGE_KEY,
  areStudioWorkspaceLayoutsEqual,
  deleteStudioWorkspace,
  duplicateStudioWorkspace,
  isStudioWorkspaceDirty,
  listStudioWorkspaces,
  loadStudioWorkspacePersistence,
  loadStudioWorkspaceState,
  migrateLegacyStudioWorkspaceState,
  moveStudioWorkspace,
  normalizeStudioCommandBarPreferences,
  normalizeStudioWorkspaceLayout,
  normalizeStudioWorkspaceState,
  setStudioCommandBarVisible,
  updateStudioCommandBarSlot,
  overwriteStudioWorkspace,
  reloadStudioWorkspace,
  renameStudioWorkspace,
  reorderStudioWorkspace,
  resolveStudioWorkspace,
  resolveStudioWorkspaceControlSide,
  resolveStudioWorkspaceDeviceKind,
  resolveStudioWorkspaceDeviceLayout,
  saveStudioWorkspace,
  saveStudioWorkspaceState,
  studioWorkspaceOwnerScope,
  studioWorkspaceStorageKey,
  switchStudioWorkspace,
  updateStudioWorkspaceLiveLayout,
  updateStudioWorkspacePreferences,
  type StudioWorkspaceLayout,
  type StudioWorkspaceState,
  type StudioWorkspaceStorage,
} from "./studio-workspaces";

function memoryStorage(initial: Record<string, string> = {}): StudioWorkspaceStorage & {
  readonly values: Map<string, string>;
} {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

function withInspector(
  layout: StudioWorkspaceLayout,
  primary: StudioWorkspaceLayout["inspector"]["primary"]
): StudioWorkspaceLayout {
  return normalizeStudioWorkspaceLayout({
    ...layout,
    inspector: { ...layout.inspector, primary },
  });
}

function withNorthAction(
  layout: StudioWorkspaceLayout,
  action: StudioWorkspaceLayout["quickActions"]["slots"]["north"]
): StudioWorkspaceLayout {
  return normalizeStudioWorkspaceLayout({
    ...layout,
    quickActions: {
      version: 1,
      slots: { ...layout.quickActions.slots, north: action },
    },
  });
}

function withLeftPanelWidth(
  layout: StudioWorkspaceLayout,
  leftPanelWidth: number
): StudioWorkspaceLayout {
  return normalizeStudioWorkspaceLayout({
    ...layout,
    desktop: { ...layout.desktop, leftPanelWidth },
  });
}

function withEditedDrawingPalettes(
  layout: StudioWorkspaceLayout
): StudioWorkspaceLayout {
  const resized = resizeStudioDrawingPalettes(
    layout.drawingPalettes,
    "tool-properties",
    73
  );
  const moved = moveStudioDrawingPalette(resized, "tool-properties", "up");
  return normalizeStudioWorkspaceLayout({
    ...layout,
    drawingPalettes: toggleStudioDrawingPalette(moved, "sub-tools"),
  });
}

/** The only profiles allowed to depart from the default dock widths. */
const WIDTH_TUNED_WORKSPACE_IDS = new Set<string>([
  "pro-comic",
  "csp-migration",
  "pen-display",
  "mobile-draw",
  "photo-edit",
  "vector-design",
  "animation",
  "pose-3d",
]);

describe("built-in Studio workspaces", () => {
  it("starts in the storyboard workspace with Page routed to navigator/minimap", () => {
    expect(DEFAULT_STUDIO_WORKSPACE_STATE.activeWorkspaceId).toBe("storyboard");
    expect(DEFAULT_STUDIO_WORKSPACE_STATE.liveLayout.inspector).toEqual({
      primary: "document",
      image: "quick",
      document: "navigator",
    });
    expect(
      STUDIO_DEFAULT_WORKSPACES.find((workspace) => workspace.id === "storyboard")
        ?.layout.inspector,
    ).toEqual(DEFAULT_STUDIO_WORKSPACE_STATE.liveLayout.inspector);
  });

  it("preserves the seven shipped presets and completes an immutable twelve-profile catalogue", () => {
    expect(STUDIO_CLASSIC_WORKSPACE_IDS).toEqual([
      "storyboard",
      "lineart",
      "coloring",
      "lettering",
      "review",
      "publish",
    ]);
    expect(STUDIO_DEFAULT_WORKSPACES.map((workspace) => workspace.id)).toEqual(
      STUDIO_DEFAULT_WORKSPACE_IDS
    );
    // Every previously shipped id survives verbatim, so a saved activeWorkspaceId still resolves.
    expect(STUDIO_DEFAULT_WORKSPACE_IDS.slice(0, 7)).toEqual([
      ...STUDIO_CLASSIC_WORKSPACE_IDS,
      "pro-comic",
    ]);
    expect(STUDIO_DEFAULT_WORKSPACE_IDS).toEqual([
      ...STUDIO_CLASSIC_WORKSPACE_IDS,
      "pro-comic",
      ...STUDIO_EXPANDED_WORKSPACE_IDS,
    ]);
    expect(STUDIO_DEFAULT_WORKSPACE_IDS).toHaveLength(15);
    expect(new Set(STUDIO_DEFAULT_WORKSPACES.map((workspace) => workspace.name)).size)
      .toBe(15);
    expect(new Set(STUDIO_DEFAULT_WORKSPACE_IDS).size).toBe(15);

    for (const workspace of STUDIO_DEFAULT_WORKSPACES) {
      expect(Object.isFrozen(workspace)).toBe(true);
      expect(Object.isFrozen(workspace.layout)).toBe(true);
      expect(Object.isFrozen(workspace.layout.inspector)).toBe(true);
      expect(Object.isFrozen(workspace.layout.desktop)).toBe(true);
      expect(Object.isFrozen(workspace.layout.drawingPalettes)).toBe(true);
      expect(Object.isFrozen(workspace.layout.drawingPalettes.order)).toBe(true);
      expect(Object.isFrozen(workspace.layout.drawingPalettes.collapsed)).toBe(true);
      expect(Object.isFrozen(workspace.layout.drawingPalettes.sizes)).toBe(true);
      expect(Object.isFrozen(workspace.layout.quickActions.slots)).toBe(true);
      expect(Object.keys(workspace.layout.quickActions.slots)).toHaveLength(6);
      expect(workspace.layout.drawingPalettes).toEqual(
        DEFAULT_STUDIO_DRAWING_PALETTE_LAYOUT
      );
      if (!WIDTH_TUNED_WORKSPACE_IDS.has(workspace.id)) {
        expect(workspace.layout.desktop.leftPanelWidth).toBe(
          STUDIO_WORKSPACE_LEFT_PANEL_WIDTH.default
        );
        expect(workspace.layout.desktop.rightPanelWidth).toBe(
          STUDIO_WORKSPACE_RIGHT_PANEL_WIDTH.default
        );
      }
    }

    const professional = STUDIO_DEFAULT_WORKSPACES.find(
      ({ id }) => id === "pro-comic"
    );
    expect(professional).toMatchObject({
      name: "프로 만화",
      layout: {
        inspector: {
          primary: "properties",
          image: "fill",
          document: "navigator",
        },
        desktop: {
          leftPanelOpen: true,
          rightPanelOpen: true,
          leftPanelWidth: 176,
          rightPanelWidth: 304,
        },
        drawingPalettes: DEFAULT_STUDIO_DRAWING_PALETTE_LAYOUT,
        quickActions: {
          version: 1,
          slots: {
            north: "undo",
            northEast: "redo",
            southEast: "pen",
            south: "advanced-fill",
            southWest: "add-bubble",
            northWest: "fit-width",
          },
        },
      },
    });
    expect(STUDIO_PRO_COMIC_PALETTE_PRIORITY).toEqual([
      "tool-properties",
      "layers",
      "pages",
      "materials-quick-access",
    ]);
  });

  it("only arranges inspector sections, docks, palettes and quick actions this build renders", () => {
    // A profile that named a panel Studio does not expose would resolve to an unrelated pane.
    // These are the four axes StudioWorkspaceLayout can actually address.
    const primarySections = new Set(["properties", "layers", "document", "publish"]);
    const imageSections = new Set(["quick", "fill", "retouch", "mask", "transform"]);
    const documentSections = new Set(["canvas", "grade", "navigator"]);
    const quickActionIds = new Set(QUICK_ACTION_IDS);

    for (const workspace of STUDIO_DEFAULT_WORKSPACES) {
      expect(primarySections.has(workspace.layout.inspector.primary)).toBe(true);
      expect(imageSections.has(workspace.layout.inspector.image)).toBe(true);
      expect(documentSections.has(workspace.layout.inspector.document)).toBe(true);
      for (const slot of QUICK_ACTION_SLOTS) {
        expect(quickActionIds.has(workspace.layout.quickActions.slots[slot])).toBe(true);
      }
      expect([...workspace.layout.drawingPalettes.order].sort()).toEqual(
        [...DEFAULT_STUDIO_DRAWING_PALETTE_LAYOUT.order].sort(),
      );
      expect(workspace.name.length).toBeGreaterThan(0);
      expect(workspace.description.length).toBeGreaterThan(0);
    }
  });

  it("maps every requested catalogue profile to a real workspace or records its absence", () => {
    expect(STUDIO_WORKSPACE_CATALOGUE_COVERAGE).toHaveLength(12);
    const shippedIds = new Set<string>(STUDIO_DEFAULT_WORKSPACE_IDS);

    for (const entry of STUDIO_WORKSPACE_CATALOGUE_COVERAGE) {
      expect(Object.isFrozen(entry)).toBe(true);
      if (entry.workspaceId === null) {
        // An absence must say why, so the gap stays auditable instead of looking like an oversight.
        expect(entry.absence).toBeTruthy();
        expect((entry.absence ?? "").length).toBeGreaterThan(20);
        continue;
      }
      expect(entry.absence).toBeNull();
      expect(shippedIds.has(entry.workspaceId)).toBe(true);
    }

    expect(new Set(STUDIO_WORKSPACE_CATALOGUE_COVERAGE.map((entry) => entry.requirement)).size)
      .toBe(12);
    expect(STUDIO_WORKSPACE_ABSENT_CATALOGUE_REQUIREMENTS).toEqual([]);
    // Every profile the catalogue does claim must be a distinct workspace, never a duplicate.
    const claimed = STUDIO_WORKSPACE_CATALOGUE_COVERAGE
      .filter((entry) => entry.workspaceId !== null)
      .map((entry) => entry.workspaceId);
    expect(new Set(claimed).size).toBe(claimed.length);
  });

  it("maps the three specialist profiles to real one-shot production surfaces", () => {
    expect(studioWorkspaceLaunchSurface("vector-design")).toBe("vector-design");
    expect(studioWorkspaceLaunchSurface("animation")).toBe("animation");
    expect(studioWorkspaceLaunchSurface("pose-3d")).toBe("pose-3d");
    expect(studioWorkspaceLaunchSurface("lineart")).toBeNull();
    expect(studioWorkspaceLaunchSurface("custom-artist-layout")).toBeNull();
  });

  it("keeps built-ins outside owner storage and lists custom workspaces after them", () => {
    const custom = saveStudioWorkspace(DEFAULT_STUDIO_WORKSPACE_STATE, "내 선화 공간");
    const listed = listStudioWorkspaces(custom);

    expect(listed).toHaveLength(STUDIO_DEFAULT_WORKSPACES.length + 1);
    expect(
      listed.slice(0, STUDIO_DEFAULT_WORKSPACES.length).map((workspace) => workspace.id)
    ).toEqual(
      STUDIO_DEFAULT_WORKSPACE_IDS
    );
    expect(listed.at(-1)?.id).toBe("custom-1");
    expect(custom.customWorkspaces).toHaveLength(1);
  });
});

describe("Studio workspace normalization boundaries", () => {
  it("fails closed for malformed, cyclic, oversized, and unknown-version roots", () => {
    const cyclic: Record<string, unknown> = { version: 1 };
    cyclic.self = cyclic;
    const oversized = JSON.stringify({
      version: 1,
      padding: "가".repeat(STUDIO_WORKSPACE_RAW_MAX_BYTES),
    });

    for (const raw of [null, [], "{bad json", cyclic, oversized, { version: 999 }]) {
      expect(normalizeStudioWorkspaceState(raw)).toEqual(DEFAULT_STUDIO_WORKSPACE_STATE);
    }
  });

  it("migrates v1 layouts and clamps finite desktop widths to the supported pixel bounds", () => {
    const v1 = normalizeStudioWorkspaceState({
      ...DEFAULT_STUDIO_WORKSPACE_STATE,
      version: 1,
      liveLayout: {
        ...DEFAULT_STUDIO_WORKSPACE_STATE.liveLayout,
        desktop: {
          leftPanelOpen: false,
          rightPanelOpen: true,
        },
      },
    });
    const clamped = normalizeStudioWorkspaceLayout({
      ...v1.liveLayout,
      desktop: {
        leftPanelOpen: true,
        rightPanelOpen: false,
        leftPanelWidth: -500.4,
        rightPanelWidth: 9_999.8,
      },
    });
    const malformed = normalizeStudioWorkspaceLayout({
      ...v1.liveLayout,
      desktop: {
        leftPanelOpen: true,
        rightPanelOpen: true,
        leftPanelWidth: Number.NaN,
        rightPanelWidth: Number.POSITIVE_INFINITY,
      },
    });

    expect(v1.version).toBe(STUDIO_WORKSPACE_STATE_VERSION);
    expect(v1.liveLayout.desktop.leftPanelWidth).toBe(
      STUDIO_WORKSPACE_LEFT_PANEL_WIDTH.default
    );
    expect(v1.liveLayout.desktop.rightPanelWidth).toBe(
      STUDIO_WORKSPACE_RIGHT_PANEL_WIDTH.default
    );
    expect(clamped.desktop.leftPanelWidth).toBe(STUDIO_WORKSPACE_LEFT_PANEL_WIDTH.minimum);
    expect(clamped.desktop.rightPanelWidth).toBe(
      STUDIO_WORKSPACE_RIGHT_PANEL_WIDTH.maximum
    );
    expect(malformed.desktop.leftPanelWidth).toBe(
      STUDIO_WORKSPACE_LEFT_PANEL_WIDTH.default
    );
    expect(malformed.desktop.rightPanelWidth).toBe(
      STUDIO_WORKSPACE_RIGHT_PANEL_WIDTH.default
    );
  });

  it("recovers known v1 fields, strips unrelated payloads, and caps custom entries", () => {
    const customWorkspaces: Array<Record<string, unknown>> = Array.from(
      { length: STUDIO_WORKSPACE_MAX_CUSTOM + 4 },
      (_, index) => ({
        id: `saved-${index}`,
        name: `작업공간 ${index}`,
        layout: {
          ...DEFAULT_STUDIO_WORKSPACE_STATE.liveLayout,
          unrelatedLayoutMarker: `layout-${index}`,
        },
        unrelatedWorkspaceMarker: `workspace-${index}`,
      })
    );
    customWorkspaces.splice(2, 0, {
      id: "saved-0",
      name: "중복 ID",
      layout: DEFAULT_STUDIO_WORKSPACE_STATE.liveLayout,
      unrelatedWorkspaceMarker: "duplicate",
    });

    const normalized = normalizeStudioWorkspaceState({
      ...DEFAULT_STUDIO_WORKSPACE_STATE,
      activeWorkspaceId: "saved-3",
      customWorkspaces,
      unrelatedRootMarker: "must-not-persist",
      documentPayload: { pages: ["must-not-persist"] },
      providerConfiguration: { marker: "must-not-persist" },
    });
    const serialized = JSON.stringify(normalized);

    expect(normalized.customWorkspaces).toHaveLength(STUDIO_WORKSPACE_MAX_CUSTOM);
    expect(new Set(normalized.customWorkspaces.map((workspace) => workspace.id)).size).toBe(
      STUDIO_WORKSPACE_MAX_CUSTOM
    );
    expect(normalized.activeWorkspaceId).toBe("saved-3");
    expect(serialized).not.toContain("unrelatedRootMarker");
    expect(serialized).not.toContain("unrelatedWorkspaceMarker");
    expect(serialized).not.toContain("unrelatedLayoutMarker");
    expect(serialized).not.toContain("documentPayload");
    expect(serialized).not.toContain("providerConfiguration");
  });

  it("drops unsafe custom identifiers and invalid names without corrupting valid entries", () => {
    const valid = {
      id: "valid.custom-1",
      name: "  나의   작업공간  ",
      layout: DEFAULT_STUDIO_WORKSPACE_STATE.liveLayout,
    };
    const normalized = normalizeStudioWorkspaceState({
      ...DEFAULT_STUDIO_WORKSPACE_STATE,
      activeWorkspaceId: "missing",
      customWorkspaces: [
        valid,
        { ...valid, id: "storyboard" },
        { ...valid, id: "has/slash" },
        { ...valid, id: "valid-2", name: "" },
        { ...valid, id: "valid-3", name: "x".repeat(STUDIO_WORKSPACE_NAME_MAX_LENGTH + 1) },
        { ...valid, id: "valid-4", name: "control\u0000name" },
      ],
    });

    expect(normalized.activeWorkspaceId).toBe("storyboard");
    expect(normalized.customWorkspaces).toEqual([
      expect.objectContaining({ id: "valid.custom-1", name: "나의 작업공간" }),
    ]);
  });

  it("returns independent deeply frozen defaults", () => {
    const first = normalizeStudioWorkspaceState(null);
    const second = normalizeStudioWorkspaceState(null);

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.liveLayout).not.toBe(second.liveLayout);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.liveLayout.quickActions.slots)).toBe(true);
  });
});

describe("Studio workspace owner-scoped persistence", () => {
  it("uses a stable opaque key namespace without leaking raw or encoded owner identifiers", () => {
    const guest = studioWorkspaceStorageKey(null);
    const namedGuest = studioWorkspaceStorageKey("guest");
    const email = "artist+studio@example.com";
    const emailKey = studioWorkspaceStorageKey(email);
    const longPrefix = "account-".repeat(30);
    const firstLong = studioWorkspaceStorageKey(`${longPrefix}a`);
    const secondLong = studioWorkspaceStorageKey(`${longPrefix}b`);

    expect(studioWorkspaceStorageKey("")).toBe(guest);
    expect(namedGuest).not.toBe(guest);
    expect(guest.startsWith(STUDIO_WORKSPACE_STORAGE_KEY)).toBe(true);
    expect(emailKey).not.toContain(email);
    expect(emailKey).not.toContain(encodeURIComponent(email));
    expect(emailKey).not.toMatch(/:v\d+/u);
    expect(studioWorkspaceOwnerScope(email)).toMatch(/^owner-[a-f0-9]{16}$/u);
    expect(studioWorkspaceStorageKey("user-a")).not.toBe(
      studioWorkspaceStorageKey("user-b")
    );
    expect(firstLong).not.toBe(secondLong);
    expect(Math.max(guest.length, namedGuest.length, firstLong.length, secondLong.length)).toBeLessThanOrEqual(
      160
    );
  });

  it("round-trips a verified v3 envelope and isolates owners", () => {
    const storage = memoryStorage();
    const state = saveStudioWorkspace(DEFAULT_STUDIO_WORKSPACE_STATE, "내 작업공간");
    const saved = saveStudioWorkspaceState(storage, "owner-a", state);
    const loaded = loadStudioWorkspacePersistence(storage, "owner-a");
    const envelope = JSON.parse(
      storage.values.get(studioWorkspaceStorageKey("owner-a")) ?? "null"
    ) as Record<string, unknown>;

    expect(saved.status).toBe("persisted");
    expect(saved.failure).toBeNull();
    expect(loaded).toMatchObject({
      state: saved.state,
      source: "current",
      status: "persisted",
      failure: null,
      ownerScope: studioWorkspaceOwnerScope("owner-a"),
    });
    expect(loadStudioWorkspaceState(storage, "owner-a")).toEqual(saved.state);
    expect(loadStudioWorkspaceState(storage, "owner-b")).toEqual(
      DEFAULT_STUDIO_WORKSPACE_STATE
    );
    expect(envelope.payloadVersion).toBe(STUDIO_WORKSPACE_PAYLOAD_VERSION);
    expect(envelope.ownerScope).toBe(studioWorkspaceOwnerScope("owner-a"));
    expect(JSON.stringify(envelope)).not.toContain("owner-a");
  });

  it("round-trips the professional comic widths, open state, quick order, and mobile fallback", () => {
    const storage = memoryStorage();
    const owner = "professional-comic-owner";
    const configured = updateStudioWorkspacePreferences(
      switchStudioWorkspace(DEFAULT_STUDIO_WORKSPACE_STATE, "pro-comic"),
      { mobileControlSide: "left" }
    );
    const saved = saveStudioWorkspaceState(storage, owner, configured);
    const loaded = loadStudioWorkspacePersistence(storage, owner);

    expect(saved).toMatchObject({ status: "persisted", failure: null });
    expect(loaded.state.activeWorkspaceId).toBe("pro-comic");
    expect(loaded.state.mobileControlSide).toBe("left");
    expect(loaded.state.liveLayout).toEqual(
      resolveStudioWorkspace(loaded.state, "pro-comic")?.layout
    );
    expect(loaded.state.liveLayout.desktop).toEqual({
      leftPanelOpen: true,
      rightPanelOpen: true,
      leftPanelWidth: 176,
      rightPanelWidth: 304,
    });
    expect(
      QUICK_ACTION_SLOTS.map(
        (slot) => loaded.state.liveLayout.quickActions.slots[slot]
      )
    ).toEqual([
      "undo",
      "redo",
      "pen",
      "advanced-fill",
      "add-bubble",
      "fit-width",
    ]);
  });

  it("reports storage absence, quota errors, silent writes, and verification reads truthfully", () => {
    const state = saveStudioWorkspace(DEFAULT_STUDIO_WORKSPACE_STATE, "세션 작업공간");
    const noStorage = saveStudioWorkspaceState(null, "owner-a", state);
    const throwingWrite: StudioWorkspaceStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    const ignoredWrite: StudioWorkspaceStorage = {
      getItem: () => null,
      setItem: () => undefined,
    };
    const throwingVerify: StudioWorkspaceStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => undefined,
    };

    expect(noStorage).toMatchObject({
      state,
      status: "session-only",
      failure: "storage-unavailable",
    });
    expect(saveStudioWorkspaceState(throwingWrite, "owner-a", state)).toMatchObject({
      status: "session-only",
      failure: "write-failed",
    });
    expect(saveStudioWorkspaceState(ignoredWrite, "owner-a", state)).toMatchObject({
      status: "session-only",
      failure: "verification-failed",
    });
    expect(saveStudioWorkspaceState(throwingVerify, "owner-a", state)).toMatchObject({
      status: "session-only",
      failure: "verification-failed",
    });

    const unavailable = loadStudioWorkspacePersistence(null, "owner-a");
    const blockedRead = loadStudioWorkspacePersistence(
      {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => undefined,
      },
      "owner-a"
    );
    expect(unavailable).toMatchObject({
      source: "default",
      status: "session-only",
      failure: "storage-unavailable",
    });
    expect(blockedRead).toMatchObject({
      source: "default",
      status: "session-only",
      failure: "read-failed",
    });
  });

  it("blocks guest state from crossing into an authenticated owner after an auth transition", () => {
    const storage = memoryStorage();
    const guestLoad = loadStudioWorkspacePersistence(storage, null);
    const guestEdit = saveStudioWorkspace(guestLoad.state, "게스트 작업공간");
    const crossOwner = saveStudioWorkspaceState(storage, "artist@example.com", guestEdit);
    const attemptedOverride = saveStudioWorkspaceState(
      storage,
      "artist@example.com",
      guestEdit,
      { sourceOwnerScope: studioWorkspaceOwnerScope("artist@example.com") }
    );

    expect(crossOwner).toMatchObject({
      status: "session-only",
      failure: "owner-mismatch",
      ownerScope: studioWorkspaceOwnerScope("artist@example.com"),
    });
    expect(attemptedOverride.failure).toBe("owner-mismatch");
    expect(storage.values.has(studioWorkspaceStorageKey("artist@example.com"))).toBe(false);

    const userLoad = loadStudioWorkspacePersistence(storage, "artist@example.com");
    const userEdit = saveStudioWorkspace(userLoad.state, "로그인 작업공간");
    expect(
      saveStudioWorkspaceState(storage, "artist@example.com", userEdit, {
        sourceOwnerScope: userLoad.ownerScope,
      }).status
    ).toBe("persisted");
  });

  it("rejects an envelope whose embedded owner does not match its opaque key", () => {
    const userId = "owner-a";
    const key = studioWorkspaceStorageKey(userId);
    const storage = memoryStorage({
      [key]: JSON.stringify({
        kind: "toonspectrum.studio-workspaces",
        payloadVersion: STUDIO_WORKSPACE_PAYLOAD_VERSION,
        ownerScope: studioWorkspaceOwnerScope("owner-b"),
        state: DEFAULT_STUDIO_WORKSPACE_STATE,
      }),
    });

    expect(loadStudioWorkspacePersistence(storage, userId)).toMatchObject({
      state: DEFAULT_STUDIO_WORKSPACE_STATE,
      source: "default",
      status: "session-only",
      failure: "owner-mismatch",
    });
  });

  it("starts V12 clean and ignores every pre-V12 workspace key by default", () => {
    const legacyKey = "toonspectrum-studio-workspaces:v1:guest";
    const storage = memoryStorage({
      [legacyKey]: JSON.stringify({
        ...DEFAULT_STUDIO_WORKSPACE_STATE,
        version: 1,
        mobileControlSide: "left",
      }),
      [STUDIO_INSPECTOR_LAYOUT_STORAGE_KEY]: JSON.stringify({ primary: "layers" }),
      "toonspectrum:studio:workspaces:guest": JSON.stringify({
        kind: "toonspectrum.studio-workspaces",
        payloadVersion: STUDIO_WORKSPACE_PAYLOAD_VERSION,
        ownerScope: "guest",
        state: DEFAULT_STUDIO_WORKSPACE_STATE,
      }),
    });

    expect(loadStudioWorkspacePersistence(storage, null)).toMatchObject({
      state: DEFAULT_STUDIO_WORKSPACE_STATE,
      source: "default",
      status: "session-only",
      failure: null,
    });
    expect(storage.values.has(legacyKey)).toBe(true);
    expect(storage.values.has(STUDIO_INSPECTOR_LAYOUT_STORAGE_KEY)).toBe(true);
    expect(studioWorkspaceStorageKey(null)).toContain("workspaces-v12");
  });

  it("migrates a prior owner-scoped v1 key and deletes it only after verified v3 write", () => {
    const userId = "legacy-owner@example.com";
    const currentKey = studioWorkspaceStorageKey(userId);
    const legacyState = {
      ...DEFAULT_STUDIO_WORKSPACE_STATE,
      version: 1,
      liveLayout: {
        ...DEFAULT_STUDIO_WORKSPACE_STATE.liveLayout,
        desktop: { leftPanelOpen: false, rightPanelOpen: true },
      },
    };
    const values = new Map<string, string>();
    const removed: string[] = [];
    let requestedLegacyKey = "";
    const storage: StudioWorkspaceStorage = {
      getItem: (key) => {
        if (values.has(key)) return values.get(key) ?? null;
        if (key.startsWith("toonspectrum-studio-workspaces:v1:user:")) {
          requestedLegacyKey = key;
          return JSON.stringify(legacyState);
        }
        return null;
      },
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => {
        removed.push(key);
      },
    };

    const loaded = loadStudioWorkspacePersistence(storage, userId, {
      legacyDataPolicy: "import-explicit",
    });
    const persistedEnvelope = JSON.parse(values.get(currentKey) ?? "null") as {
      payloadVersion?: unknown;
    };

    expect(loaded).toMatchObject({
      source: "legacy-v1",
      status: "persisted",
      failure: null,
    });
    expect(loaded.state.version).toBe(STUDIO_WORKSPACE_STATE_VERSION);
    expect(loaded.state.liveLayout.desktop.leftPanelWidth).toBe(
      STUDIO_WORKSPACE_LEFT_PANEL_WIDTH.default
    );
    expect(persistedEnvelope.payloadVersion).toBe(STUDIO_WORKSPACE_PAYLOAD_VERSION);
    expect(requestedLegacyKey).not.toBe("");
    expect(removed).toEqual([requestedLegacyKey]);
  });

  it("falls back to the matching v1 key when the stable guest payload is malformed", () => {
    const legacyKey = "toonspectrum-studio-workspaces:v1:guest";
    const storage = memoryStorage({
      [studioWorkspaceStorageKey(null)]: "{interrupted-write",
      [legacyKey]: JSON.stringify({
        ...DEFAULT_STUDIO_WORKSPACE_STATE,
        version: 1,
        mobileControlSide: "left",
      }),
    });

    const loaded = loadStudioWorkspacePersistence(storage, null, {
      legacyDataPolicy: "import-explicit",
    });

    expect(loaded).toMatchObject({
      source: "legacy-v1",
      status: "persisted",
      failure: null,
    });
    expect(loaded.state.mobileControlSide).toBe("left");
    expect(storage.values.has(legacyKey)).toBe(false);
  });

  it("retains legacy keys when quota or silent-write verification prevents migration", () => {
    const legacyKey = "toonspectrum-studio-workspaces:v1:guest";
    const removed: string[] = [];
    const storage: StudioWorkspaceStorage = {
      getItem: (key) =>
        key === legacyKey
          ? JSON.stringify({ ...DEFAULT_STUDIO_WORKSPACE_STATE, version: 1 })
          : null,
      setItem: () => undefined,
      removeItem: (key) => {
        removed.push(key);
      },
    };

    expect(loadStudioWorkspacePersistence(storage, null, {
      legacyDataPolicy: "import-explicit",
    })).toMatchObject({
      source: "legacy-v1",
      status: "session-only",
      failure: "verification-failed",
    });
    expect(removed).toEqual([]);
  });

  it("migrates real legacy JSON preference strings and clamped resize widths for guests only", () => {
    const quickActions = {
      version: 1,
      slots: {
        north: "delete",
        northEast: "redo",
        southEast: "select",
        south: "pen",
        southWest: "eraser",
        northWest: "eyedropper",
      },
    };
    const initial = {
      [STUDIO_INSPECTOR_LAYOUT_STORAGE_KEY]: JSON.stringify({
        primary: "layers",
        image: "mask",
        document: "grade",
      }),
      [STUDIO_QUICK_ACTIONS_STORAGE_KEY]: JSON.stringify(quickActions),
      [STUDIO_LEGACY_LEFT_PANEL_WIDTH_STORAGE_KEY]: "44",
      [STUDIO_LEGACY_RIGHT_PANEL_WIDTH_STORAGE_KEY]: "9999",
    };
    const guestStorage = memoryStorage(initial);
    const guest = loadStudioWorkspacePersistence(guestStorage, null, {
      legacyDataPolicy: "import-explicit",
    });

    expect(guest).toMatchObject({
      source: "legacy-preferences",
      status: "persisted",
      failure: null,
    });
    expect(guest.state.liveLayout.inspector).toEqual({
      primary: "layers",
      image: "mask",
      document: "grade",
    });
    expect(guest.state.liveLayout.quickActions.slots.north).toBe("delete");
    expect(guest.state.liveLayout.desktop.leftPanelWidth).toBe(
      STUDIO_WORKSPACE_LEFT_PANEL_WIDTH.minimum
    );
    expect(guest.state.liveLayout.desktop.rightPanelWidth).toBe(
      STUDIO_WORKSPACE_RIGHT_PANEL_WIDTH.maximum
    );
    for (const key of Object.keys(initial)) expect(guestStorage.values.has(key)).toBe(false);

    const userStorage = memoryStorage(initial);
    const user = loadStudioWorkspacePersistence(userStorage, "authenticated-owner");
    expect(user.source).toBe("default");
    for (const key of Object.keys(initial)) expect(userStorage.values.has(key)).toBe(true);
  });

  it("migrates a stable v1 envelope in place and fails closed for malformed current data", () => {
    const userId = "owner-a";
    const key = studioWorkspaceStorageKey(userId);
    const storage = memoryStorage({
      [key]: JSON.stringify({
        kind: "toonspectrum.studio-workspaces",
        payloadVersion: 1,
        ownerScope: studioWorkspaceOwnerScope(userId),
        state: { ...DEFAULT_STUDIO_WORKSPACE_STATE, version: 1 },
      }),
    });
    const migrated = loadStudioWorkspacePersistence(storage, userId);
    const rewritten = JSON.parse(storage.values.get(key) ?? "null") as {
      payloadVersion?: unknown;
    };

    expect(migrated).toMatchObject({ source: "legacy-v1", status: "persisted" });
    expect(rewritten.payloadVersion).toBe(STUDIO_WORKSPACE_PAYLOAD_VERSION);

    storage.values.set(key, "{malformed");
    expect(loadStudioWorkspacePersistence(storage, userId)).toMatchObject({
      state: DEFAULT_STUDIO_WORKSPACE_STATE,
      source: "default",
      status: "session-only",
      failure: "invalid-payload",
    });
  });

  it("migrates a stable v2 envelope to v3 with safe drawing-palette defaults", () => {
    const userId = "owner-v2";
    const key = studioWorkspaceStorageKey(userId);
    const {
      drawingPalettes: _discardLiveDrawingPalettes,
      ...legacyLiveLayout
    } = DEFAULT_STUDIO_WORKSPACE_STATE.liveLayout;
    const storage = memoryStorage({
      [key]: JSON.stringify({
        kind: "toonspectrum.studio-workspaces",
        payloadVersion: 2,
        ownerScope: studioWorkspaceOwnerScope(userId),
        state: {
          ...DEFAULT_STUDIO_WORKSPACE_STATE,
          version: 2,
          liveLayout: legacyLiveLayout,
          customWorkspaces: [
            {
              id: "legacy-custom",
              name: "이전 작업공간",
              layout: legacyLiveLayout,
            },
          ],
        },
      }),
    });

    const migrated = loadStudioWorkspacePersistence(storage, userId);
    const rewritten = JSON.parse(storage.values.get(key) ?? "null") as {
      payloadVersion?: unknown;
      state?: { version?: unknown };
    };

    expect(migrated).toMatchObject({
      source: "legacy-v2",
      status: "persisted",
      failure: null,
    });
    expect(migrated.state.version).toBe(STUDIO_WORKSPACE_STATE_VERSION);
    expect(migrated.state.liveLayout.drawingPalettes).toEqual(
      DEFAULT_STUDIO_DRAWING_PALETTE_LAYOUT
    );
    expect(migrated.state.customWorkspaces[0]?.layout.drawingPalettes).toEqual(
      DEFAULT_STUDIO_DRAWING_PALETTE_LAYOUT
    );
    expect(rewritten).toMatchObject({
      payloadVersion: STUDIO_WORKSPACE_PAYLOAD_VERSION,
      state: { version: STUDIO_WORKSPACE_STATE_VERSION },
    });
  });
});

describe("Studio custom workspace lifecycle", () => {
  it("saves, renames, overwrites, reloads, and deletes without mutating prior states", () => {
    const initial = DEFAULT_STUDIO_WORKSPACE_STATE;
    const saved = saveStudioWorkspace(initial, "  채색   집중  ");
    const id = saved.activeWorkspaceId;
    const renamed = renameStudioWorkspace(saved, id, "야간 채색");
    const changedLayout = withInspector(renamed.liveLayout, "publish");
    const edited = updateStudioWorkspaceLiveLayout(renamed, changedLayout);
    const overwritten = overwriteStudioWorkspace(edited, id);
    const dirtyAgain = updateStudioWorkspaceLiveLayout(
      overwritten,
      withInspector(overwritten.liveLayout, "layers")
    );
    const reloaded = reloadStudioWorkspace(dirtyAgain);
    const deleted = deleteStudioWorkspace(reloaded, id);

    expect(initial.customWorkspaces).toHaveLength(0);
    expect(saved.customWorkspaces[0]?.name).toBe("채색 집중");
    expect(renamed.customWorkspaces[0]?.name).toBe("야간 채색");
    expect(isStudioWorkspaceDirty(edited)).toBe(true);
    expect(isStudioWorkspaceDirty(overwritten)).toBe(false);
    expect(isStudioWorkspaceDirty(dirtyAgain)).toBe(true);
    expect(reloaded.liveLayout.inspector.primary).toBe("publish");
    expect(isStudioWorkspaceDirty(reloaded)).toBe(false);
    expect(deleted.customWorkspaces).toHaveLength(0);
    expect(deleted.activeWorkspaceId).toBe("storyboard");
    expect(isStudioWorkspaceDirty(deleted)).toBe(false);
  });

  it("never permits built-ins to be overwritten, renamed, or deleted", () => {
    expect(() => overwriteStudioWorkspace(DEFAULT_STUDIO_WORKSPACE_STATE, "lineart")).toThrow(
      TypeError
    );
    expect(() => renameStudioWorkspace(DEFAULT_STUDIO_WORKSPACE_STATE, "review", "새 이름")).toThrow(
      TypeError
    );
    expect(() => deleteStudioWorkspace(DEFAULT_STUDIO_WORKSPACE_STATE, "publish")).toThrow(
      TypeError
    );
    expect(resolveStudioWorkspace(DEFAULT_STUDIO_WORKSPACE_STATE, "lineart")?.id).toBe(
      "lineart"
    );
  });

  it("enforces the 48-character name and 24-custom-workspace limits", () => {
    const exactName = "가".repeat(STUDIO_WORKSPACE_NAME_MAX_LENGTH);
    const exact = saveStudioWorkspace(DEFAULT_STUDIO_WORKSPACE_STATE, exactName);
    expect(exact.customWorkspaces[0]?.name).toBe(exactName);
    expect(() => saveStudioWorkspace(exact, `${exactName}가`)).toThrow(TypeError);
    expect(() => saveStudioWorkspace(exact, "   ")).toThrow(TypeError);
    expect(() => saveStudioWorkspace(exact, "bad\u0000name")).toThrow(TypeError);
    expect(() => saveStudioWorkspace(exact, "bad\nname")).toThrow(TypeError);

    let full: StudioWorkspaceState = DEFAULT_STUDIO_WORKSPACE_STATE;
    for (let index = 0; index < STUDIO_WORKSPACE_MAX_CUSTOM; index += 1) {
      full = saveStudioWorkspace(full, `사용자 공간 ${index + 1}`);
    }
    expect(full.customWorkspaces).toHaveLength(STUDIO_WORKSPACE_MAX_CUSTOM);
    expect(() => saveStudioWorkspace(full, "한 개 더")).toThrow(RangeError);
  });

  it("throws for unknown custom workspaces instead of silently changing another one", () => {
    expect(() => renameStudioWorkspace(DEFAULT_STUDIO_WORKSPACE_STATE, "custom-404", "없음")).toThrow(
      RangeError
    );
    expect(() => overwriteStudioWorkspace(DEFAULT_STUDIO_WORKSPACE_STATE, "custom-404")).toThrow(
      RangeError
    );
    expect(() => deleteStudioWorkspace(DEFAULT_STUDIO_WORKSPACE_STATE, "custom-404")).toThrow(
      RangeError
    );
    expect(() => switchStudioWorkspace(DEFAULT_STUDIO_WORKSPACE_STATE, "custom-404")).toThrow(
      RangeError
    );
  });

  it("duplicates a saved custom snapshot beside its source without changing active dirty work", () => {
    const first = saveStudioWorkspace(DEFAULT_STUDIO_WORKSPACE_STATE, "선화 집중");
    const firstId = first.activeWorkspaceId;
    const second = saveStudioWorkspace(first, "채색 집중");
    const dirty = updateStudioWorkspaceLiveLayout(
      second,
      withInspector(second.liveLayout, "publish")
    );
    const sourceBefore = JSON.stringify(dirty);
    const sourceWorkspace = resolveStudioWorkspace(dirty, firstId);
    const duplicated = duplicateStudioWorkspace(dirty, firstId);
    const duplicate = duplicated.customWorkspaces[1];

    expect(duplicated.customWorkspaces.map((workspace) => workspace.id)).toEqual([
      firstId,
      duplicate?.id,
      second.activeWorkspaceId,
    ]);
    expect(duplicate).toMatchObject({ name: "선화 집중 복사본" });
    expect(duplicate?.layout).toEqual(sourceWorkspace?.layout);
    expect(duplicate?.layout).not.toBe(sourceWorkspace?.layout);
    expect(duplicated.activeWorkspaceId).toBe(dirty.activeWorkspaceId);
    expect(duplicated.liveLayout).toEqual(dirty.liveLayout);
    expect(isStudioWorkspaceDirty(duplicated)).toBe(true);
    expect(JSON.stringify(dirty)).toBe(sourceBefore);
    expect(Object.isFrozen(duplicated)).toBe(true);
    expect(Object.isFrozen(duplicated.customWorkspaces)).toBe(true);
    expect(Object.isFrozen(duplicate)).toBe(true);
    expect(Object.isFrozen(duplicate?.layout)).toBe(true);
  });

  it("creates collision-free, grapheme-safe duplicate names within the 48-code-point limit", () => {
    const artistEmoji = "🧑🏽‍🎨";
    const longName = artistEmoji.repeat(12);
    const source = saveStudioWorkspace(DEFAULT_STUDIO_WORKSPACE_STATE, longName);
    const sourceId = source.activeWorkspaceId;
    const firstCopy = duplicateStudioWorkspace(source, sourceId);
    const firstCopyId = firstCopy.customWorkspaces.find(
      (workspace) => workspace.id !== sourceId
    )?.id;
    const secondCopy = duplicateStudioWorkspace(firstCopy, sourceId);
    const firstCopyName = secondCopy.customWorkspaces.find(
      (workspace) => workspace.id === firstCopyId
    )?.name;
    const secondCopyName = secondCopy.customWorkspaces.find(
      (workspace) => workspace.id !== sourceId && workspace.id !== firstCopyId
    )?.name;

    expect(firstCopyName?.endsWith(" 복사본")).toBe(true);
    expect(secondCopyName?.endsWith(" 복사본 2")).toBe(true);
    expect(firstCopyName).not.toBe(secondCopyName);
    expect(Array.from(firstCopyName ?? "")).toHaveLength(
      STUDIO_WORKSPACE_NAME_MAX_LENGTH
    );
    expect(Array.from(secondCopyName ?? "").length).toBeLessThanOrEqual(
      STUDIO_WORKSPACE_NAME_MAX_LENGTH
    );
    expect(firstCopyName?.match(new RegExp(artistEmoji, "gu"))?.length).toBe(11);
    expect(secondCopyName?.match(new RegExp(artistEmoji, "gu"))?.length).toBe(10);
    expect(firstCopyName).not.toContain("\uFFFD");
    expect(secondCopyName).not.toContain("\uFFFD");
  });

  it("rejects duplicate and reorder operations for built-ins, unknown ids, invalid targets, and capacity", () => {
    expect(() => duplicateStudioWorkspace(DEFAULT_STUDIO_WORKSPACE_STATE, "lineart")).toThrow(
      TypeError
    );
    expect(() => duplicateStudioWorkspace(DEFAULT_STUDIO_WORKSPACE_STATE, "custom-404")).toThrow(
      RangeError
    );
    expect(() => reorderStudioWorkspace(DEFAULT_STUDIO_WORKSPACE_STATE, "review", 0)).toThrow(
      TypeError
    );
    expect(() => moveStudioWorkspace(DEFAULT_STUDIO_WORKSPACE_STATE, "custom-404", "up")).toThrow(
      RangeError
    );

    const one = saveStudioWorkspace(DEFAULT_STUDIO_WORKSPACE_STATE, "하나");
    expect(() => reorderStudioWorkspace(one, one.activeWorkspaceId, -1)).toThrow(RangeError);
    expect(() => reorderStudioWorkspace(one, one.activeWorkspaceId, 1)).toThrow(RangeError);
    expect(() => reorderStudioWorkspace(one, one.activeWorkspaceId, 0.5)).toThrow(TypeError);
    expect(() =>
      moveStudioWorkspace(one, one.activeWorkspaceId, "sideways" as "up")
    ).toThrow(TypeError);

    let full: StudioWorkspaceState = DEFAULT_STUDIO_WORKSPACE_STATE;
    for (let index = 0; index < STUDIO_WORKSPACE_MAX_CUSTOM; index += 1) {
      full = saveStudioWorkspace(full, `가득 찬 공간 ${index + 1}`);
    }
    const fullBefore = JSON.stringify(full);
    expect(() => duplicateStudioWorkspace(full, full.customWorkspaces[0]!.id)).toThrow(
      RangeError
    );
    expect(JSON.stringify(full)).toBe(fullBefore);
  });

  it("reorders custom workspaces deterministically while preserving active/live state", () => {
    const first = saveStudioWorkspace(DEFAULT_STUDIO_WORKSPACE_STATE, "첫째");
    const firstId = first.activeWorkspaceId;
    const second = saveStudioWorkspace(first, "둘째");
    const secondId = second.activeWorkspaceId;
    const third = saveStudioWorkspace(second, "셋째");
    const thirdId = third.activeWorkspaceId;
    const dirtyActive = updateStudioWorkspaceLiveLayout(
      third,
      withLeftPanelWidth(third.liveLayout, 300)
    );
    const reordered = reorderStudioWorkspace(dirtyActive, thirdId, 0);
    const movedDown = moveStudioWorkspace(reordered, thirdId, "down");
    const movedBackUp = moveStudioWorkspace(movedDown, thirdId, "up");
    const firstBoundary = moveStudioWorkspace(movedBackUp, thirdId, "up");
    const lastBoundary = moveStudioWorkspace(reordered, secondId, "down");
    const sameTarget = reorderStudioWorkspace(reordered, firstId, 1);

    expect(reordered.customWorkspaces.map((workspace) => workspace.id)).toEqual([
      thirdId,
      firstId,
      secondId,
    ]);
    expect(movedDown.customWorkspaces.map((workspace) => workspace.id)).toEqual([
      firstId,
      thirdId,
      secondId,
    ]);
    expect(movedBackUp.customWorkspaces.map((workspace) => workspace.id)).toEqual([
      thirdId,
      firstId,
      secondId,
    ]);
    expect(firstBoundary).toEqual(movedBackUp);
    expect(lastBoundary).toEqual(reordered);
    expect(sameTarget).toEqual(reordered);
    for (const result of [reordered, movedDown, movedBackUp, firstBoundary, lastBoundary]) {
      expect(result.activeWorkspaceId).toBe(thirdId);
      expect(result.liveLayout).toEqual(dirtyActive.liveLayout);
      expect(isStudioWorkspaceDirty(result)).toBe(true);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.customWorkspaces)).toBe(true);
    }
  });

  it("preserves owner provenance and the v3 envelope across duplicate and reorder saves", () => {
    const storage = memoryStorage();
    const ownerId = "workspace-manager-owner";
    const loaded = loadStudioWorkspacePersistence(storage, ownerId);
    const first = saveStudioWorkspace(loaded.state, "원본");
    const duplicated = duplicateStudioWorkspace(first, first.activeWorkspaceId);
    const copyId = duplicated.customWorkspaces.find(
      (workspace) => workspace.id !== first.activeWorkspaceId
    )!.id;
    const reordered = reorderStudioWorkspace(duplicated, copyId, 0);
    const saved = saveStudioWorkspaceState(storage, ownerId, reordered, {
      sourceOwnerScope: loaded.ownerScope,
    });
    const persisted = loadStudioWorkspacePersistence(storage, ownerId);
    const envelope = JSON.parse(
      storage.values.get(studioWorkspaceStorageKey(ownerId)) ?? "null"
    ) as { payloadVersion?: unknown };

    expect(saved).toMatchObject({ status: "persisted", failure: null });
    expect(persisted.state.customWorkspaces.map((workspace) => workspace.id)).toEqual([
      copyId,
      first.activeWorkspaceId,
    ]);
    expect(persisted.state.activeWorkspaceId).toBe(first.activeWorkspaceId);
    expect(envelope.payloadVersion).toBe(STUDIO_WORKSPACE_PAYLOAD_VERSION);
  });
});

describe("workspace switching and dirty comparison", () => {
  it("keeps dirty edits when the current workspace is selected and discards them only on reload", () => {
    const edited = updateStudioWorkspaceLiveLayout(
      DEFAULT_STUDIO_WORKSPACE_STATE,
      withLeftPanelWidth(DEFAULT_STUDIO_WORKSPACE_STATE.liveLayout, 240)
    );
    const selectedAgain = switchStudioWorkspace(edited, edited.activeWorkspaceId);
    const reloaded = reloadStudioWorkspace(selectedAgain);

    expect(isStudioWorkspaceDirty(edited)).toBe(true);
    expect(selectedAgain.liveLayout.desktop.leftPanelWidth).toBe(240);
    expect(isStudioWorkspaceDirty(selectedAgain)).toBe(true);
    expect(reloaded.liveLayout.desktop.leftPanelWidth).toBe(
      STUDIO_WORKSPACE_LEFT_PANEL_WIDTH.default
    );
    expect(isStudioWorkspaceDirty(reloaded)).toBe(false);
  });

  it("switches inspector, desktop panels, and quick actions when enabled", () => {
    const switched = switchStudioWorkspace(DEFAULT_STUDIO_WORKSPACE_STATE, "coloring");
    const target = resolveStudioWorkspace(switched, "coloring");

    expect(target).not.toBeNull();
    expect(switched.activeWorkspaceId).toBe("coloring");
    expect(switched.liveLayout).toEqual(target?.layout);
    expect(isStudioWorkspaceDirty(switched)).toBe(false);
  });

  it("preserves radial quick actions on switch and ignores them for dirty state when disabled", () => {
    const customQuickActions = withNorthAction(
      DEFAULT_STUDIO_WORKSPACE_STATE.liveLayout,
      "delete"
    );
    const edited = updateStudioWorkspaceLiveLayout(
      DEFAULT_STUDIO_WORKSPACE_STATE,
      customQuickActions
    );
    const preferences = updateStudioWorkspacePreferences(edited, {
      mobileControlSide: "left",
      applyQuickActionsOnSwitch: false,
    });
    const switched = switchStudioWorkspace(preferences, "coloring");
    const target = resolveStudioWorkspace(switched, "coloring");

    expect(switched.mobileControlSide).toBe("left");
    expect(switched.liveLayout.inspector).toEqual(target?.layout.inspector);
    expect(switched.liveLayout.desktop).toEqual(target?.layout.desktop);
    expect(switched.liveLayout.quickActions.slots.north).toBe("delete");
    expect(target?.layout.quickActions.slots.north).toBe("undo");
    expect(isStudioWorkspaceDirty(switched)).toBe(false);
    expect(
      areStudioWorkspaceLayoutsEqual(switched.liveLayout, target!.layout, true)
    ).toBe(false);
    expect(
      areStudioWorkspaceLayoutsEqual(switched.liveLayout, target!.layout, false)
    ).toBe(true);
  });

  it("reloads structural changes while preserving live quick actions when configured", () => {
    const noQuickSwitch = updateStudioWorkspacePreferences(
      DEFAULT_STUDIO_WORKSPACE_STATE,
      { applyQuickActionsOnSwitch: false }
    );
    const editedLayout = withNorthAction(
      withInspector(noQuickSwitch.liveLayout, "layers"),
      "delete"
    );
    const edited = updateStudioWorkspaceLiveLayout(noQuickSwitch, editedLayout);
    const reloaded = reloadStudioWorkspace(edited);

    expect(reloaded.liveLayout.inspector).toEqual(
      DEFAULT_STUDIO_WORKSPACE_STATE.liveLayout.inspector
    );
    expect(reloaded.liveLayout.quickActions.slots.north).toBe("delete");
    expect(isStudioWorkspaceDirty(reloaded)).toBe(false);
  });

  it("includes drawing palette order, collapse, sizes, and locks in save, switch, reload, and dirty state", () => {
    const editedLayout = withEditedDrawingPalettes(
      DEFAULT_STUDIO_WORKSPACE_STATE.liveLayout
    );
    const edited = updateStudioWorkspaceLiveLayout(
      DEFAULT_STUDIO_WORKSPACE_STATE,
      editedLayout
    );

    expect(isStudioWorkspaceDirty(edited)).toBe(true);
    expect(
      areStudioWorkspaceLayoutsEqual(
        edited.liveLayout,
        DEFAULT_STUDIO_WORKSPACE_STATE.liveLayout
      )
    ).toBe(false);

    const saved = saveStudioWorkspace(edited, "팔레트 작업공간");
    const customId = saved.activeWorkspaceId;
    expect(resolveStudioWorkspace(saved, customId)?.layout.drawingPalettes).toEqual(
      editedLayout.drawingPalettes
    );
    expect(isStudioWorkspaceDirty(saved)).toBe(false);

    const switchedAway = switchStudioWorkspace(saved, "coloring");
    const switchedBack = switchStudioWorkspace(switchedAway, customId);
    expect(switchedBack.liveLayout.drawingPalettes).toEqual(
      editedLayout.drawingPalettes
    );
    expect(isStudioWorkspaceDirty(switchedBack)).toBe(false);

    const dirtyAgain = updateStudioWorkspaceLiveLayout(
      switchedBack,
      normalizeStudioWorkspaceLayout({
        ...switchedBack.liveLayout,
        drawingPalettes: resizeStudioDrawingPalettes(
          switchedBack.liveLayout.drawingPalettes,
          "sub-tools",
          80
        ),
      })
    );
    const reloaded = reloadStudioWorkspace(dirtyAgain);
    expect(isStudioWorkspaceDirty(dirtyAgain)).toBe(true);
    expect(reloaded.liveLayout.drawingPalettes).toEqual(
      editedLayout.drawingPalettes
    );
    expect(isStudioWorkspaceDirty(reloaded)).toBe(false);

    const lockOnlyLayout = normalizeStudioWorkspaceLayout({
      ...switchedBack.liveLayout,
      drawingPalettes: setStudioDrawingPaletteLock(
        switchedBack.liveLayout.drawingPalettes,
        "sub-tools",
        "position",
        true
      ),
    });
    const lockOnlyDirty = updateStudioWorkspaceLiveLayout(
      switchedBack,
      lockOnlyLayout
    );
    expect(isStudioWorkspaceDirty(lockOnlyDirty)).toBe(true);
    expect(
      areStudioWorkspaceLayoutsEqual(
        lockOnlyDirty.liveLayout,
        switchedBack.liveLayout
      )
    ).toBe(false);

    const lockSaved = overwriteStudioWorkspace(lockOnlyDirty, customId);
    expect(isStudioWorkspaceDirty(lockSaved)).toBe(false);
    const lockSwitchedAway = switchStudioWorkspace(lockSaved, "coloring");
    const lockSwitchedBack = switchStudioWorkspace(
      lockSwitchedAway,
      customId
    );
    expect(
      lockSwitchedBack.liveLayout.drawingPalettes.locks?.["sub-tools"].position
    ).toBe(true);
    expect(isStudioWorkspaceDirty(lockSwitchedBack)).toBe(false);
  });
});

describe("legacy Studio preference migration", () => {
  it("migrates existing inspector, panel, and quick-action values without document data", () => {
    const quickActions = {
      version: 1,
      slots: {
        north: "delete",
        northEast: "redo",
        southEast: "select",
        south: "pen",
        southWest: "eraser",
        northWest: "eyedropper",
      },
    };
    const migrated = migrateLegacyStudioWorkspaceState({
      inspector: JSON.stringify({ primary: "layers", image: "mask", document: "grade" }),
      quickActions: JSON.stringify(quickActions),
      leftPanelOpen: false,
      rightPanelOpen: true,
      leftPanelWidth: 220.4,
      rightPanelWidth: 560.6,
      mobileControlSide: "left",
      applyQuickActionsOnSwitch: false,
      documentData: { marker: "not accepted by the type" },
    } as Parameters<typeof migrateLegacyStudioWorkspaceState>[0]);
    const serialized = JSON.stringify(migrated);

    expect(migrated.activeWorkspaceId).toBe("lineart");
    expect(migrated.liveLayout.inspector).toEqual({
      primary: "layers",
      image: "mask",
      document: "grade",
    });
    expect(migrated.liveLayout.desktop).toEqual({
      leftPanelOpen: false,
      rightPanelOpen: true,
      leftPanelWidth: 220,
      rightPanelWidth: 561,
    });
    expect(migrated.liveLayout.quickActions.slots.north).toBe("delete");
    expect(migrated.mobileControlSide).toBe("left");
    expect(migrated.applyQuickActionsOnSwitch).toBe(false);
    expect(serialized).not.toContain("documentData");
    expect(serialized).not.toContain("not accepted by the type");
  });

  it("normalizes malformed legacy values to safe UI defaults", () => {
    const migrated = migrateLegacyStudioWorkspaceState({
      inspector: { primary: "unknown" },
      quickActions: "{bad json",
      leftPanelOpen: "yes",
      rightPanelOpen: null,
      leftPanelWidth: Number.NaN,
      rightPanelWidth: "wide",
      mobileControlSide: "center",
      applyQuickActionsOnSwitch: "yes",
    });

    expect(migrated.liveLayout.inspector).toEqual({
      primary: "properties",
      image: "quick",
      document: "canvas",
    });
    expect(migrated.liveLayout.desktop).toEqual({
      leftPanelOpen: true,
      rightPanelOpen: true,
      leftPanelWidth: STUDIO_WORKSPACE_LEFT_PANEL_WIDTH.default,
      rightPanelWidth: STUDIO_WORKSPACE_RIGHT_PANEL_WIDTH.default,
    });
    expect(migrated.mobileControlSide).toBe("right");
    expect(migrated.applyQuickActionsOnSwitch).toBe(true);
  });
});

describe("Studio workspace device overrides", () => {
  function workspace(id: string) {
    const found = STUDIO_DEFAULT_WORKSPACES.find((candidate) => candidate.id === id);
    if (!found) throw new Error(`missing workspace ${id}`);
    return found;
  }

  it("declares a closed device axis every built-in override is validated against", () => {
    expect(STUDIO_WORKSPACE_DEVICE_KINDS).toEqual([
      "pen-display",
      "mobile",
      "keyboard",
      "mouse",
      "touch",
    ]);
    const allowed = new Set<string>(STUDIO_WORKSPACE_DEVICE_KINDS);
    for (const entry of STUDIO_DEFAULT_WORKSPACES) {
      for (const [device, override] of Object.entries(entry.layout.deviceOverrides)) {
        expect(allowed.has(device)).toBe(true);
        expect(Object.isFrozen(override)).toBe(true);
        expect(typeof override.desktop.leftPanelOpen).toBe("boolean");
        expect(override.desktop.leftPanelWidth)
          .toBeGreaterThanOrEqual(STUDIO_WORKSPACE_LEFT_PANEL_WIDTH.minimum);
        expect(override.desktop.rightPanelWidth)
          .toBeGreaterThanOrEqual(STUDIO_WORKSPACE_RIGHT_PANEL_WIDTH.minimum);
      }
    }
  });

  it("reclaims the screen on handheld surfaces and narrows the dock on a pen display", () => {
    const lineart = workspace("lineart").layout;
    expect(resolveStudioWorkspaceDeviceLayout(lineart, "mobile").desktop).toMatchObject({
      leftPanelOpen: false,
      rightPanelOpen: false,
    });
    expect(resolveStudioWorkspaceDeviceLayout(lineart, "touch").desktop.rightPanelOpen)
      .toBe(false);
    const penDisplay = resolveStudioWorkspaceDeviceLayout(lineart, "pen-display").desktop;
    expect(penDisplay.rightPanelOpen).toBe(true);
    expect(penDisplay.rightPanelWidth).toBeLessThan(lineart.desktop.rightPanelWidth);
    // Keyboard navigation needs every landmark reachable by Tab.
    expect(resolveStudioWorkspaceDeviceLayout(lineart, "keyboard").desktop).toMatchObject({
      leftPanelOpen: true,
      rightPanelOpen: true,
    });
  });

  it("returns the desktop layout untouched when no override applies", () => {
    const publish = workspace("publish").layout;
    expect(resolveStudioWorkspaceDeviceLayout(publish, "pen-display").desktop)
      .toEqual(publish.desktop);
    expect(resolveStudioWorkspaceDeviceLayout(publish, null).desktop).toEqual(publish.desktop);
    expect(resolveStudioWorkspaceDeviceLayout(publish).desktop).toEqual(publish.desktop);
    // Overriding docks must never disturb the workspace's tools or inspector.
    const mobile = resolveStudioWorkspaceDeviceLayout(workspace("lineart").layout, "mobile");
    expect(mobile.inspector).toEqual(workspace("lineart").layout.inspector);
    expect(mobile.quickActions).toEqual(workspace("lineart").layout.quickActions);
    expect(mobile.drawingPalettes).toEqual(workspace("lineart").layout.drawingPalettes);
  });

  it("lets a workspace override handedness only where it deliberately set one", () => {
    const state = updateStudioWorkspacePreferences(DEFAULT_STUDIO_WORKSPACE_STATE, {
      mobileControlSide: "right",
    });
    const penDisplayProfile = workspace("pen-display").layout;
    expect(resolveStudioWorkspaceControlSide(state, penDisplayProfile, "pen-display"))
      .toBe("left");
    // Every other surface still inherits the owner-wide preference.
    expect(resolveStudioWorkspaceControlSide(state, penDisplayProfile, "mobile")).toBe("right");
    expect(resolveStudioWorkspaceControlSide(state, penDisplayProfile, null)).toBe("right");
    const leftHanded = updateStudioWorkspacePreferences(state, { mobileControlSide: "left" });
    expect(resolveStudioWorkspaceControlSide(leftHanded, workspace("lineart").layout, "mobile"))
      .toBe("left");
  });

  it("classifies the input surface from observable runtime signals", () => {
    expect(resolveStudioWorkspaceDeviceKind({ keyboardDriven: true, pointerType: "mouse" }))
      .toBe("keyboard");
    expect(resolveStudioWorkspaceDeviceKind({
      pointerType: "pen",
      coarsePointer: true,
      viewportWidth: 1_920,
    })).toBe("pen-display");
    expect(resolveStudioWorkspaceDeviceKind({
      pointerType: "pen",
      maxTouchPoints: 5,
      viewportWidth: 390,
    })).toBe("mobile");
    expect(resolveStudioWorkspaceDeviceKind({ maxTouchPoints: 5, viewportWidth: 375 }))
      .toBe("mobile");
    expect(resolveStudioWorkspaceDeviceKind({ pointerType: "touch", viewportWidth: 1_280 }))
      .toBe("touch");
    expect(resolveStudioWorkspaceDeviceKind({ pointerType: "mouse", viewportWidth: 1_440 }))
      .toBe("mouse");
    // No signal at all means no adaptation, not a guess.
    expect(resolveStudioWorkspaceDeviceKind({})).toBeNull();
    expect(resolveStudioWorkspaceDeviceKind({ pointerType: "unknown" })).toBeNull();
  });

  it("believes an observed press over the hardware's touch census", () => {
    // Most laptops now report touch points whether or not anyone touches the screen. Reading that
    // as "handheld" handed a desktop artist the both-docks-closed layout mid-session.
    expect(resolveStudioWorkspaceDeviceKind({
      pointerType: "mouse",
      maxTouchPoints: 10,
      viewportWidth: 1_680,
    })).toBe("mouse");
    // An iPad on a keyboard case still drives a pen or a finger, and stays a touch surface.
    expect(resolveStudioWorkspaceDeviceKind({
      pointerType: "touch",
      maxTouchPoints: 5,
      coarsePointer: true,
      viewportWidth: 1_180,
    })).toBe("touch");
    // Before the first press only a coarse *primary* pointer is evidence of a finger-first screen;
    // touch points alone are not, and first paint is exactly when nothing has been pressed yet.
    expect(resolveStudioWorkspaceDeviceKind({ maxTouchPoints: 10, viewportWidth: 1_680 }))
      .toBeNull();
    expect(resolveStudioWorkspaceDeviceKind({ coarsePointer: true, viewportWidth: 1_180 }))
      .toBe("touch");
  });

  it("carries overrides through save, switch, reload and dirty comparison", () => {
    const base = DEFAULT_STUDIO_WORKSPACE_STATE;
    const withOverride = updateStudioWorkspaceLiveLayout(base, normalizeStudioWorkspaceLayout({
      ...base.liveLayout,
      deviceOverrides: {
        mobile: {
          desktop: {
            leftPanelOpen: false,
            rightPanelOpen: false,
            leftPanelWidth: 128,
            rightPanelWidth: 240,
          },
          controlSide: "left",
        },
      },
    }));
    expect(withOverride.liveLayout.deviceOverrides.mobile?.controlSide).toBe("left");
    expect(areStudioWorkspaceLayoutsEqual(withOverride.liveLayout, base.liveLayout)).toBe(false);
    expect(isStudioWorkspaceDirty(withOverride)).toBe(true);

    const saved = saveStudioWorkspace(withOverride, "모바일 커스텀");
    const custom = saved.customWorkspaces.at(-1);
    expect(custom?.layout.deviceOverrides.mobile?.controlSide).toBe("left");
    expect(isStudioWorkspaceDirty(saved)).toBe(false);

    const switched = switchStudioWorkspace(saved, "publish");
    expect(switched.liveLayout.deviceOverrides)
      .toEqual(resolveStudioWorkspace(switched, "publish")?.layout.deviceOverrides);
    const back = switchStudioWorkspace(switched, custom?.id ?? "");
    expect(back.liveLayout.deviceOverrides.mobile?.controlSide).toBe("left");
    expect(reloadStudioWorkspace(back).liveLayout.deviceOverrides.mobile?.controlSide)
      .toBe("left");
  });

  it("drops unknown devices and malformed overrides from untrusted payloads", () => {
    const layout = normalizeStudioWorkspaceLayout({
      ...DEFAULT_STUDIO_WORKSPACE_STATE.liveLayout,
      deviceOverrides: {
        mobile: { desktop: { leftPanelOpen: false }, controlSide: "left" },
        hologram: { desktop: { leftPanelOpen: false } },
        touch: "not-an-object",
        keyboard: { desktop: { leftPanelWidth: 99_999 }, controlSide: "sideways" },
      },
    });
    expect(Object.keys(layout.deviceOverrides).sort()).toEqual(["keyboard", "mobile"]);
    expect(layout.deviceOverrides.mobile?.desktop.leftPanelOpen).toBe(false);
    // An out-of-range width clamps rather than rejecting the whole override.
    expect(layout.deviceOverrides.keyboard?.desktop.leftPanelWidth)
      .toBe(STUDIO_WORKSPACE_LEFT_PANEL_WIDTH.maximum);
    // An unrecognized control side inherits instead of persisting nonsense.
    expect(layout.deviceOverrides.keyboard?.controlSide).toBeNull();
  });
});

describe("Studio workspace v3 to v4 migration", () => {
  const OWNER = "guest";

  it("keeps a v3 owner payload and gives its layouts an empty device axis", () => {
    const v3State = {
      version: 3,
      activeWorkspaceId: "custom-1",
      liveLayout: {
        inspector: { primary: "properties", image: "fill", document: "grade" },
        desktop: {
          leftPanelOpen: false,
          rightPanelOpen: true,
          leftPanelWidth: 200,
          rightPanelWidth: 300,
        },
        drawingPalettes: DEFAULT_STUDIO_DRAWING_PALETTE_LAYOUT,
        quickActions: DEFAULT_STUDIO_WORKSPACE_STATE.liveLayout.quickActions,
      },
      customWorkspaces: [{
        id: "custom-1",
        name: "이전 작업공간",
        layout: {
          inspector: { primary: "layers", image: "mask", document: "navigator" },
          desktop: {
            leftPanelOpen: true,
            rightPanelOpen: true,
            leftPanelWidth: 176,
            rightPanelWidth: 320,
          },
          drawingPalettes: DEFAULT_STUDIO_DRAWING_PALETTE_LAYOUT,
          quickActions: DEFAULT_STUDIO_WORKSPACE_STATE.liveLayout.quickActions,
        },
      }],
      mobileControlSide: "left",
      applyQuickActionsOnSwitch: false,
    };
    const storage = memoryStorage({
      [studioWorkspaceStorageKey(null)]: JSON.stringify({
        kind: "toonspectrum.studio-workspaces",
        payloadVersion: 3,
        ownerScope: OWNER,
        state: v3State,
      }),
    });

    const loaded = loadStudioWorkspacePersistence(storage, null);
    expect(loaded.status).toBe("persisted");
    expect(loaded.failure).toBeNull();
    // Nothing the artist configured may be lost by the version bump.
    expect(loaded.state.activeWorkspaceId).toBe("custom-1");
    expect(loaded.state.mobileControlSide).toBe("left");
    expect(loaded.state.applyQuickActionsOnSwitch).toBe(false);
    expect(loaded.state.customWorkspaces).toHaveLength(1);
    expect(loaded.state.customWorkspaces[0]?.name).toBe("이전 작업공간");
    expect(loaded.state.customWorkspaces[0]?.layout.desktop).toMatchObject({
      leftPanelWidth: 176,
      rightPanelWidth: 320,
    });
    expect(loaded.state.liveLayout.inspector.document).toBe("grade");
    // A v3 layout simply had no device axis; it migrates to "no adaptation", not to a guess.
    expect(loaded.state.liveLayout.deviceOverrides).toEqual({});
    expect(loaded.state.customWorkspaces[0]?.layout.deviceOverrides).toEqual({});

    const rewritten = JSON.parse(storage.values.get(studioWorkspaceStorageKey(null)) ?? "{}");
    expect(rewritten.payloadVersion).toBe(STUDIO_WORKSPACE_PAYLOAD_VERSION);
    expect(rewritten.state.version).toBe(STUDIO_WORKSPACE_STATE_VERSION);
  });

  it("still resolves a saved workspace id from before the catalogue grew", () => {
    for (const id of ["storyboard", "lineart", "coloring", "lettering", "review", "publish", "pro-comic"]) {
      const migrated = normalizeStudioWorkspaceState({
        version: 3,
        activeWorkspaceId: id,
        liveLayout: DEFAULT_STUDIO_WORKSPACE_STATE.liveLayout,
        customWorkspaces: [],
        mobileControlSide: "right",
        applyQuickActionsOnSwitch: true,
      });
      expect(migrated.activeWorkspaceId).toBe(id);
      expect(resolveStudioWorkspace(migrated, id)?.id).toBe(id);
    }
  });
});

describe("Studio workspace payload budget with the device axis", () => {
  it("keeps a fully loaded owner payload inside the 64 KiB storage budget", () => {
    const heavyOverrides = Object.fromEntries(
      STUDIO_WORKSPACE_DEVICE_KINDS.map((device) => [device, {
        desktop: {
          leftPanelOpen: false,
          rightPanelOpen: true,
          leftPanelWidth: STUDIO_WORKSPACE_LEFT_PANEL_WIDTH.maximum,
          rightPanelWidth: STUDIO_WORKSPACE_RIGHT_PANEL_WIDTH.maximum,
        },
        controlSide: "left",
      }]),
    );
    let state = updateStudioWorkspaceLiveLayout(
      DEFAULT_STUDIO_WORKSPACE_STATE,
      normalizeStudioWorkspaceLayout({
        ...DEFAULT_STUDIO_WORKSPACE_STATE.liveLayout,
        deviceOverrides: heavyOverrides,
      }),
    );
    for (let index = 0; index < STUDIO_WORKSPACE_MAX_CUSTOM; index += 1) {
      state = saveStudioWorkspace(state, `가득 찬 작업공간 ${"자".repeat(20)}${index}`);
    }
    expect(state.customWorkspaces).toHaveLength(STUDIO_WORKSPACE_MAX_CUSTOM);

    const storage = memoryStorage();
    const saved = saveStudioWorkspaceState(storage, null, state);
    // Every device override on every workspace must still fit, or the artist silently loses
    // their whole catalogue the first time they configure one.
    expect(saved.failure).toBeNull();
    expect(saved.status).toBe("persisted");
    const raw = storage.values.get(studioWorkspaceStorageKey(null)) ?? "";
    expect(new TextEncoder().encode(raw).byteLength)
      .toBeLessThan(STUDIO_WORKSPACE_RAW_MAX_BYTES);
  });
});

describe("Studio command bar preferences (§15.3 Window ▸ Action Bar)", () => {
  it("ships the documented default: five filled slots, three empty, visible", () => {
    expect(DEFAULT_STUDIO_COMMAND_BAR.visible).toBe(true);
    expect(DEFAULT_STUDIO_COMMAND_BAR.slots).toEqual([
      "undo",
      "redo",
      "save",
      "export-open",
      "zoom-fit",
      null,
      null,
      null,
    ]);
    expect(DEFAULT_STUDIO_COMMAND_BAR.slots).toHaveLength(STUDIO_COMMAND_BAR_SLOT_COUNT);
    expect(Object.isFrozen(DEFAULT_STUDIO_COMMAND_BAR)).toBe(true);
    expect(Object.isFrozen(DEFAULT_STUDIO_COMMAND_BAR.slots)).toBe(true);
    // Every default slot names a command from the closed vocabulary.
    const known = new Set<string>(STUDIO_COMMAND_BAR_COMMAND_IDS);
    for (const slot of DEFAULT_STUDIO_COMMAND_BAR.slots) {
      if (slot !== null) expect(known.has(slot)).toBe(true);
    }
  });

  it("recovers slots field by field and always rebuilds the exact slot count", () => {
    const normalized = normalizeStudioCommandBarPreferences({
      version: 1,
      visible: false,
      slots: ["download", "no-such-command", null, 7, "project"],
    });
    expect(normalized.visible).toBe(false);
    expect(normalized.slots).toEqual([
      "download",
      // Corrupt entries fall back per slot; the rest of the customization survives.
      "redo",
      null,
      "export-open",
      "project",
      null,
      null,
      null,
    ]);

    // A wrong version or malformed root resets wholesale.
    expect(normalizeStudioCommandBarPreferences({ version: 2, slots: [] }))
      .toEqual(DEFAULT_STUDIO_COMMAND_BAR);
    expect(normalizeStudioCommandBarPreferences("{broken")).toEqual(DEFAULT_STUDIO_COMMAND_BAR);
  });

  it("updates one slot and the visibility immutably with range/vocabulary guards", () => {
    const updated = updateStudioCommandBarSlot(DEFAULT_STUDIO_COMMAND_BAR, 5, "download");
    expect(updated.slots[5]).toBe("download");
    expect(DEFAULT_STUDIO_COMMAND_BAR.slots[5]).toBeNull();

    const cleared = updateStudioCommandBarSlot(updated, 0, null);
    expect(cleared.slots[0]).toBeNull();

    expect(() => updateStudioCommandBarSlot(DEFAULT_STUDIO_COMMAND_BAR, 8, "undo"))
      .toThrow(RangeError);
    expect(() =>
      updateStudioCommandBarSlot(DEFAULT_STUDIO_COMMAND_BAR, 0, "nope" as never)
    ).toThrow(TypeError);

    const hidden = setStudioCommandBarVisible(DEFAULT_STUDIO_COMMAND_BAR, false);
    expect(hidden.visible).toBe(false);
    expect(hidden.slots).toEqual(DEFAULT_STUDIO_COMMAND_BAR.slots);
    expect(DEFAULT_STUDIO_COMMAND_BAR.visible).toBe(true);
  });

  it("round-trips a customized command bar through owner-scoped persistence", () => {
    const storage = memoryStorage();
    const owner = "command-bar-owner";
    const customized = updateStudioWorkspaceLiveLayout(
      DEFAULT_STUDIO_WORKSPACE_STATE,
      normalizeStudioWorkspaceLayout({
        ...DEFAULT_STUDIO_WORKSPACE_STATE.liveLayout,
        commandBar: setStudioCommandBarVisible(
          updateStudioCommandBarSlot(DEFAULT_STUDIO_COMMAND_BAR, 5, "project"),
          false,
        ),
      }),
    );

    const saved = saveStudioWorkspaceState(storage, owner, customized);
    expect(saved).toMatchObject({ status: "persisted", failure: null });

    const loaded = loadStudioWorkspacePersistence(storage, owner);
    expect(loaded.source).toBe("current");
    expect(loaded.state.liveLayout.commandBar?.visible).toBe(false);
    expect(loaded.state.liveLayout.commandBar?.slots[5]).toBe("project");
  });

  it("keeps the authored-form invariant: the bar never enters deviceOverrides and stays put on switch", () => {
    const customized = updateStudioWorkspaceLiveLayout(
      DEFAULT_STUDIO_WORKSPACE_STATE,
      normalizeStudioWorkspaceLayout({
        ...DEFAULT_STUDIO_WORKSPACE_STATE.liveLayout,
        commandBar: updateStudioCommandBarSlot(DEFAULT_STUDIO_COMMAND_BAR, 6, "bubbles"),
      }),
    );

    // Device resolution swaps dock geometry only; the command bar is device-independent.
    for (const device of STUDIO_WORKSPACE_DEVICE_KINDS) {
      const presented = resolveStudioWorkspaceDeviceLayout(customized.liveLayout, device);
      expect(presented.commandBar).toEqual(customized.liveLayout.commandBar);
      expect(
        Object.values(presented.deviceOverrides).some(
          (override) => override && "commandBar" in override,
        ),
      ).toBe(false);
    }

    // App chrome follows the artist across workspaces instead of resetting per profile…
    const switched = switchStudioWorkspace(customized, "lineart");
    expect(switched.liveLayout.commandBar?.slots[6]).toBe("bubbles");
    // …and a customized bar alone never reads as workspace drift.
    expect(isStudioWorkspaceDirty(switched)).toBe(false);
  });

  it("treats pre-command-bar payloads as default instead of rejecting them", () => {
    const legacyState = JSON.parse(
      JSON.stringify(DEFAULT_STUDIO_WORKSPACE_STATE),
    ) as Record<string, unknown>;
    delete (legacyState.liveLayout as Record<string, unknown>).commandBar;

    const normalized = normalizeStudioWorkspaceState(legacyState);
    expect(normalized.liveLayout.commandBar).toEqual(DEFAULT_STUDIO_COMMAND_BAR);
  });
});
