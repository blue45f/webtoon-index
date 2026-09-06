import {
  STUDIO_COMMAND_BAR_SLOT_COUNT,
  STUDIO_WORKSPACE_LEFT_PANEL_WIDTH,
  STUDIO_WORKSPACE_RIGHT_PANEL_WIDTH,
  normalizeStudioCommandBarPreferences,
  type StudioCommandBarPreferences,
  type StudioDrawingPaletteLayout,
  type StudioWorkspaceDesktopLayout,
  type StudioWorkspaceLayout,
} from "./studio-workspaces";

import type { StudioQuickAccessState } from "./studio-quick-access";

/**
 * Portable Studio workspace boundary.
 *
 * This format deliberately contains presentation state only. Project documents, artwork,
 * assets, comments, identities, accounts, AI providers, and credentials must never cross it.
 * File picking/downloading stays in an intent-loaded UI adapter; this module is pure.
 */

export const STUDIO_WORKSPACE_INTERCHANGE_KIND =
  "toonspectrum.studio-workspaces.interchange" as const;
export const STUDIO_WORKSPACE_INTERCHANGE_VERSION = 1 as const;
export const STUDIO_WORKSPACE_INTERCHANGE_MAX_BYTES = 64 * 1024;
export const STUDIO_WORKSPACE_INTERCHANGE_MAX_WORKSPACES = 24;

export const STUDIO_WORKSPACE_INTERCHANGE_ACTIONS = [
  "add",
  "add-and-apply",
  "replace-same-name",
] as const;
export const STUDIO_WORKSPACE_INTERCHANGE_SCOPES = [
  "panels",
  "drawingPalettes",
  "quickAccess",
] as const;

export type StudioWorkspaceInterchangeAction =
  (typeof STUDIO_WORKSPACE_INTERCHANGE_ACTIONS)[number];
export type StudioWorkspaceInterchangeScope =
  (typeof STUDIO_WORKSPACE_INTERCHANGE_SCOPES)[number];

export interface StudioWorkspaceInterchangePanels {
  readonly inspector: StudioWorkspaceLayout["inspector"];
  readonly desktop: StudioWorkspaceDesktopLayout;
}

export interface StudioWorkspaceInterchangePresentation {
  readonly panels: StudioWorkspaceInterchangePanels;
  readonly drawingPalettes?: StudioDrawingPaletteLayout;
  /** Exact durable radial-menu preferences; handlers and command metadata never cross this file. */
  readonly quickActions?: StudioWorkspaceLayout["quickActions"];
  /** Exact durable Quick Access v1 presentation state; catalog metadata stays process-local. */
  readonly quickAccess?: StudioQuickAccessState;
  /**
   * Canonical command-bar customization (slots + visibility). Always normalized to the closed
   * command vocabulary on both export and import; malformed values collapse to the default bar
   * instead of failing the file, and files without the key behave exactly like legacy files.
   */
  readonly commandBar?: StudioCommandBarPreferences;
}

export interface StudioWorkspaceInterchangeWorkspace {
  readonly id: string;
  readonly name: string;
  readonly presentation: StudioWorkspaceInterchangePresentation;
}

export interface StudioWorkspaceInterchangeDocument {
  readonly kind: typeof STUDIO_WORKSPACE_INTERCHANGE_KIND;
  readonly version: typeof STUDIO_WORKSPACE_INTERCHANGE_VERSION;
  readonly workspaces: readonly StudioWorkspaceInterchangeWorkspace[];
}

export interface StudioWorkspaceInterchangeTargetState {
  readonly activeWorkspaceId: string;
  readonly livePresentation: StudioWorkspaceInterchangePresentation;
  readonly workspaces: readonly StudioWorkspaceInterchangeWorkspace[];
}

export interface StudioWorkspaceInterchangeExportOptions {
  readonly includeDrawingPalettes?: boolean;
  readonly includeQuickActions?: boolean;
  readonly includeQuickAccess?: boolean;
  readonly includeCommandBar?: boolean;
}

export interface StudioWorkspaceInterchangePlanOptions {
  /** Defaults to the non-destructive `add` action. */
  readonly action?: StudioWorkspaceInterchangeAction;
  /** Defaults to all presentation scopes. */
  readonly scopes?: readonly StudioWorkspaceInterchangeScope[];
  /** Required for deterministic ID remapping when an imported ID collides. */
  readonly createConflictId: () => string;
  /** Selects which imported workspace is applied when `action` is `add-and-apply`. */
  readonly applyWorkspaceId?: string;
}

export interface StudioWorkspaceInterchangeOperation {
  readonly kind: "add" | "replace";
  readonly sourceWorkspaceId: string;
  readonly targetWorkspaceId: string;
  readonly renamed: boolean;
  readonly idRemapped: boolean;
  readonly workspace: StudioWorkspaceInterchangeWorkspace;
}

export interface StudioWorkspaceInterchangeImportPlan {
  readonly action: StudioWorkspaceInterchangeAction;
  readonly scopes: readonly StudioWorkspaceInterchangeScope[];
  readonly operations: readonly StudioWorkspaceInterchangeOperation[];
  readonly nextState: StudioWorkspaceInterchangeTargetState;
}

export type StudioWorkspaceInterchangeFailureReason =
  | "catalog-full"
  | "duplicate-workspace-id"
  | "duplicate-workspace-name"
  | "id-factory-exhausted"
  | "invalid-action"
  | "invalid-current-state"
  | "invalid-id"
  | "invalid-name"
  | "invalid-scope"
  | "invalid-shape"
  | "non-json-value"
  | "payload-too-large"
  | "sensitive-field"
  | "too-many-workspaces"
  | "unknown-apply-workspace"
  | "unsupported-kind"
  | "unsupported-version";

export type StudioWorkspaceInterchangeDecodeResult =
  | Readonly<{
      ok: true;
      document: StudioWorkspaceInterchangeDocument;
    }>
  | Readonly<{
      ok: false;
      reason: StudioWorkspaceInterchangeFailureReason;
    }>;

export type StudioWorkspaceInterchangeEncodeResult =
  | Readonly<{
      ok: true;
      document: StudioWorkspaceInterchangeDocument;
      text: string;
    }>
  | Readonly<{
      ok: false;
      reason: StudioWorkspaceInterchangeFailureReason;
    }>;

export type StudioWorkspaceInterchangePlanResult =
  | Readonly<{
      ok: true;
      plan: StudioWorkspaceInterchangeImportPlan;
    }>
  | Readonly<{
      ok: false;
      reason: StudioWorkspaceInterchangeFailureReason;
    }>;

const WORKSPACE_ID_MAX_LENGTH = 80;
const WORKSPACE_NAME_MAX_CODE_POINTS = 48;
const MAX_ID_FACTORY_ATTEMPTS = 64;
const QUICK_ACCESS_MAX_SETS = 12;
const QUICK_ACCESS_MAX_COMMANDS = 64;
const QUICK_ACCESS_MAX_ID_LENGTH = 128;
const QUICK_ACCESS_MAX_NAME_CODE_POINTS = 64;
const CUSTOM_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]*$/u;
const QUICK_ACCESS_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/~-]*$/u;
const BUILTIN_WORKSPACE_IDS = new Set<string>([
  "storyboard",
  "lineart",
  "coloring",
  "lettering",
  "review",
  "publish",
  "pro-comic",
]);
const PRIMARY_SECTIONS = new Set<string>([
  "properties",
  "layers",
  "document",
  "publish",
]);
const IMAGE_SECTIONS = new Set<string>([
  "quick",
  "fill",
  "retouch",
  "mask",
  "transform",
]);
const DOCUMENT_SECTIONS = new Set<string>(["canvas", "grade", "navigator"]);
const DRAWING_PALETTE_IDS = new Set<string>(["sub-tools", "tool-properties"]);
const QUICK_ACTION_SLOTS = [
  "north",
  "northEast",
  "southEast",
  "south",
  "southWest",
  "northWest",
] as const;
const QUICK_ACTION_IDS = new Set<string>([
  "undo",
  "redo",
  "select",
  "pen",
  "eraser",
  "eyedropper",
  "properties",
  "duplicate",
  "delete",
  "bring-front",
  "fit-width",
  "add-bubble",
  "advanced-fill",
  "quick-mask",
  "wet-mix",
  "dodge-burn",
]);
const QUICK_ACCESS_DISPLAY_MODES = new Set<string>(["tiles", "list"]);
const QUICK_ACCESS_DENSITIES = new Set<string>([
  "compact",
  "comfortable",
  "large",
]);
const ACTION_SET = new Set<string>(STUDIO_WORKSPACE_INTERCHANGE_ACTIONS);
const SCOPE_SET = new Set<string>(STUDIO_WORKSPACE_INTERCHANGE_SCOPES);
const SENSITIVE_KEYS = new Set<string>([
  "account",
  "accounts",
  "artwork",
  "artworkid",
  "artworks",
  "asset",
  "assetid",
  "assetpayload",
  "assets",
  "auth",
  "authorization",
  "bearer",
  "comment",
  "comments",
  "credential",
  "credentials",
  "password",
  "project",
  "projectid",
  "projects",
  "provider",
  "providerid",
  "providers",
  "secret",
  "token",
  "user",
  "userid",
  "users",
]);

type DataFields = Readonly<Record<string, unknown>>;

class InterchangeBoundaryError extends Error {
  constructor(readonly reason: StudioWorkspaceInterchangeFailureReason) {
    super(reason);
    this.name = "InterchangeBoundaryError";
  }
}

function boundaryFailure(reason: StudioWorkspaceInterchangeFailureReason): never {
  throw new InterchangeBoundaryError(reason);
}

function failureReason(error: unknown): StudioWorkspaceInterchangeFailureReason {
  return error instanceof InterchangeBoundaryError ? error.reason : "invalid-shape";
}

function failure(
  reason: StudioWorkspaceInterchangeFailureReason,
): Readonly<{ ok: false; reason: StudioWorkspaceInterchangeFailureReason }> {
  return Object.freeze({ ok: false, reason });
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
    if (bytes > STUDIO_WORKSPACE_INTERCHANGE_MAX_BYTES) return bytes;
  }
  return bytes;
}

function normalizedSensitiveKey(key: string): string {
  return key.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/gu, "");
}

function assertSafeKey(key: string): void {
  const normalized = normalizedSensitiveKey(key);
  if (
    SENSITIVE_KEYS.has(normalized) ||
    normalized.startsWith("account") ||
    normalized.startsWith("artwork") ||
    normalized.startsWith("asset") ||
    normalized.startsWith("comment") ||
    normalized.startsWith("project") ||
    normalized.startsWith("provider") ||
    normalized.startsWith("user") ||
    normalized.includes("apikey") ||
    normalized.endsWith("token") ||
    normalized.endsWith("secret") ||
    normalized.includes("password") ||
    normalized.includes("credential") ||
    normalized.includes("privatekey")
  ) {
    boundaryFailure("sensitive-field");
  }
}

function ownDataFields(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): DataFields {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    boundaryFailure("invalid-shape");
  }

  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      boundaryFailure("invalid-shape");
    }
    const allowed = new Set([...requiredKeys, ...optionalKeys]);
    const keys = Reflect.ownKeys(value);
    for (const key of keys) {
      if (typeof key !== "string") boundaryFailure("invalid-shape");
      assertSafeKey(key);
    }
    if (keys.length > allowed.size) boundaryFailure("invalid-shape");
    const fields: Record<string, unknown> = {};
    for (const key of keys) {
      if (typeof key !== "string") boundaryFailure("invalid-shape");
      if (!allowed.has(key)) boundaryFailure("invalid-shape");
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        !descriptor ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        boundaryFailure("invalid-shape");
      }
      fields[key] = descriptor.value;
    }
    for (const key of requiredKeys) {
      if (!Object.hasOwn(fields, key)) boundaryFailure("invalid-shape");
    }
    return fields;
  } catch (error) {
    if (error instanceof InterchangeBoundaryError) throw error;
    boundaryFailure("invalid-shape");
  }
}

function ownArrayValues(value: unknown, maximumLength: number): readonly unknown[] {
  if (!Array.isArray(value)) boundaryFailure("invalid-shape");
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      boundaryFailure("invalid-shape");
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    const length = lengthDescriptor && "value" in lengthDescriptor
      ? lengthDescriptor.value
      : null;
    if (
      typeof length !== "number" ||
      !Number.isSafeInteger(length) ||
      length < 0
    ) {
      boundaryFailure("invalid-shape");
    }
    if (length > maximumLength) {
      boundaryFailure(
        maximumLength === STUDIO_WORKSPACE_INTERCHANGE_MAX_WORKSPACES
          ? "too-many-workspaces"
          : "payload-too-large",
      );
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length !== length + 1 || !keys.includes("length")) {
      boundaryFailure("invalid-shape");
    }
    const values: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const key = String(index);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        boundaryFailure("invalid-shape");
      }
      values.push(descriptor.value);
    }
    return values;
  } catch (error) {
    if (error instanceof InterchangeBoundaryError) throw error;
    boundaryFailure("invalid-shape");
  }
}

function parseWorkspaceId(value: unknown, allowBuiltIn = false): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > WORKSPACE_ID_MAX_LENGTH ||
    value.trim() !== value ||
    !CUSTOM_ID_PATTERN.test(value) ||
    (!allowBuiltIn && BUILTIN_WORKSPACE_IDS.has(value))
  ) {
    boundaryFailure("invalid-id");
  }
  return value;
}

function parseWorkspaceName(value: unknown): string {
  if (typeof value !== "string") boundaryFailure("invalid-name");
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || codePoint === 0x7f) {
      boundaryFailure("invalid-name");
    }
  }
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (
    normalized.length === 0 ||
    Array.from(normalized).length > WORKSPACE_NAME_MAX_CODE_POINTS
  ) {
    boundaryFailure("invalid-name");
  }
  return normalized;
}

function parseStringMember(value: unknown, members: ReadonlySet<string>): string {
  if (typeof value !== "string" || !members.has(value)) {
    boundaryFailure("invalid-shape");
  }
  return value;
}

function parseFiniteInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    boundaryFailure("invalid-shape");
  }
  return value;
}

function parsePanels(value: unknown): StudioWorkspaceInterchangePanels {
  const panels = ownDataFields(value, ["inspector", "desktop"]);
  const inspector = ownDataFields(
    panels.inspector,
    ["primary", "image", "document"],
  );
  const desktop = ownDataFields(
    panels.desktop,
    ["leftPanelOpen", "rightPanelOpen", "leftPanelWidth", "rightPanelWidth"],
  );
  if (
    typeof desktop.leftPanelOpen !== "boolean" ||
    typeof desktop.rightPanelOpen !== "boolean"
  ) {
    boundaryFailure("invalid-shape");
  }
  return Object.freeze({
    inspector: Object.freeze({
      primary: parseStringMember(
        inspector.primary,
        PRIMARY_SECTIONS,
      ) as StudioWorkspaceLayout["inspector"]["primary"],
      image: parseStringMember(
        inspector.image,
        IMAGE_SECTIONS,
      ) as StudioWorkspaceLayout["inspector"]["image"],
      document: parseStringMember(
        inspector.document,
        DOCUMENT_SECTIONS,
      ) as StudioWorkspaceLayout["inspector"]["document"],
    }),
    desktop: Object.freeze({
      leftPanelOpen: desktop.leftPanelOpen,
      rightPanelOpen: desktop.rightPanelOpen,
      leftPanelWidth: parseFiniteInteger(
        desktop.leftPanelWidth,
        STUDIO_WORKSPACE_LEFT_PANEL_WIDTH.minimum,
        STUDIO_WORKSPACE_LEFT_PANEL_WIDTH.maximum,
      ),
      rightPanelWidth: parseFiniteInteger(
        desktop.rightPanelWidth,
        STUDIO_WORKSPACE_RIGHT_PANEL_WIDTH.minimum,
        STUDIO_WORKSPACE_RIGHT_PANEL_WIDTH.maximum,
      ),
    }),
  });
}

function parseDrawingPalettes(value: unknown): StudioDrawingPaletteLayout {
  const layout = ownDataFields(
    value,
    ["order", "collapsed", "sizes"],
    ["locks"],
  );
  const order = ownArrayValues(layout.order, 2);
  if (
    order.length !== 2 ||
    typeof order[0] !== "string" ||
    typeof order[1] !== "string" ||
    !DRAWING_PALETTE_IDS.has(order[0]) ||
    !DRAWING_PALETTE_IDS.has(order[1]) ||
    order[0] === order[1]
  ) {
    boundaryFailure("invalid-shape");
  }
  const collapsed = ownDataFields(
    layout.collapsed,
    ["sub-tools", "tool-properties"],
  );
  const sizes = ownDataFields(layout.sizes, ["sub-tools", "tool-properties"]);
  if (
    typeof collapsed["sub-tools"] !== "boolean" ||
    typeof collapsed["tool-properties"] !== "boolean"
  ) {
    boundaryFailure("invalid-shape");
  }
  const subToolsSize = parseFiniteInteger(sizes["sub-tools"], 20, 80);
  const toolPropertiesSize = parseFiniteInteger(
    sizes["tool-properties"],
    20,
    80,
  );
  if (subToolsSize + toolPropertiesSize !== 100) {
    boundaryFailure("invalid-shape");
  }
  const rawLocks = Object.hasOwn(layout, "locks")
    ? ownDataFields(layout.locks, ["sub-tools", "tool-properties"])
    : null;
  const parseLockState = (id: "sub-tools" | "tool-properties") => {
    if (!rawLocks) {
      return Object.freeze({ position: false, height: false });
    }
    const lock = ownDataFields(rawLocks[id], ["position", "height"]);
    if (
      typeof lock.position !== "boolean" ||
      typeof lock.height !== "boolean"
    ) {
      boundaryFailure("invalid-shape");
    }
    return Object.freeze({
      position: lock.position,
      height: lock.height,
    });
  };
  return Object.freeze({
    order: Object.freeze([
      order[0] as "sub-tools" | "tool-properties",
      order[1] as "sub-tools" | "tool-properties",
    ]),
    collapsed: Object.freeze({
      "sub-tools": collapsed["sub-tools"],
      "tool-properties": collapsed["tool-properties"],
    }),
    sizes: Object.freeze({
      "sub-tools": subToolsSize,
      "tool-properties": toolPropertiesSize,
    }),
    locks: Object.freeze({
      "sub-tools": parseLockState("sub-tools"),
      "tool-properties": parseLockState("tool-properties"),
    }),
  });
}

function parseQuickActions(
  value: unknown,
): StudioWorkspaceLayout["quickActions"] {
  const quickActions = ownDataFields(value, ["version", "slots"]);
  if (quickActions.version !== 1) boundaryFailure("invalid-shape");
  const slots = ownDataFields(quickActions.slots, QUICK_ACTION_SLOTS);
  const canonicalSlots = Object.fromEntries(
    QUICK_ACTION_SLOTS.map((slot) => {
      const action = slots[slot];
      if (typeof action !== "string" || !QUICK_ACTION_IDS.has(action)) {
        boundaryFailure("invalid-shape");
      }
      return [slot, action];
    }),
  ) as StudioWorkspaceLayout["quickActions"]["slots"];
  return Object.freeze({
    version: 1,
    slots: Object.freeze(canonicalSlots),
  });
}

function parseQuickAccessId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > QUICK_ACCESS_MAX_ID_LENGTH ||
    value.trim() !== value ||
    !QUICK_ACCESS_ID_PATTERN.test(value)
  ) {
    boundaryFailure("invalid-shape");
  }
  return value;
}

function parseQuickAccessName(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length === 0 ||
    Array.from(value).length > QUICK_ACCESS_MAX_NAME_CODE_POINTS
  ) {
    boundaryFailure("invalid-shape");
  }
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || codePoint === 0x7f) {
      boundaryFailure("invalid-shape");
    }
  }
  return value;
}

function parseQuickAccess(value: unknown): StudioQuickAccessState {
  const quickAccess = ownDataFields(
    value,
    ["version", "sets", "activeSetId", "displayMode", "density"],
  );
  if (quickAccess.version !== 1) boundaryFailure("invalid-shape");
  const rawSets = ownArrayValues(quickAccess.sets, QUICK_ACCESS_MAX_SETS);
  if (rawSets.length === 0) boundaryFailure("invalid-shape");
  const seenSetIds = new Set<string>();
  const sets = rawSets.map((rawSet) => {
    const set = ownDataFields(rawSet, ["id", "name", "commandIds"]);
    const id = parseQuickAccessId(set.id);
    if (seenSetIds.has(id)) boundaryFailure("invalid-shape");
    seenSetIds.add(id);
    const rawCommandIds = ownArrayValues(
      set.commandIds,
      QUICK_ACCESS_MAX_COMMANDS,
    );
    const seenCommandIds = new Set<string>();
    const commandIds = rawCommandIds.map((commandId) => {
      const parsed = parseQuickAccessId(commandId);
      if (seenCommandIds.has(parsed)) boundaryFailure("invalid-shape");
      seenCommandIds.add(parsed);
      return parsed;
    });
    return Object.freeze({
      id,
      name: parseQuickAccessName(set.name),
      commandIds: Object.freeze(commandIds),
    });
  });
  const activeSetId = parseQuickAccessId(quickAccess.activeSetId);
  if (!seenSetIds.has(activeSetId)) boundaryFailure("invalid-shape");
  const displayMode = parseStringMember(
    quickAccess.displayMode,
    QUICK_ACCESS_DISPLAY_MODES,
  ) as StudioQuickAccessState["displayMode"];
  const density = parseStringMember(
    quickAccess.density,
    QUICK_ACCESS_DENSITIES,
  ) as StudioQuickAccessState["density"];
  return Object.freeze({
    version: 1,
    sets: Object.freeze(sets),
    activeSetId,
    displayMode,
    density,
  });
}

/**
 * Command-bar preferences are tolerated, not trusted: structural hazards and unknown fields
 * collapse to the canonical default bar instead of failing the whole file, while sensitive keys
 * still hard-fail the boundary. Extraction never invokes hostile accessors, and the returned
 * value is rebuilt from the closed command vocabulary by the canonical normalizer, so nothing
 * beyond `version`/`visible`/`slots` can ever cross this file.
 */
function parseCommandBar(value: unknown): StudioCommandBarPreferences {
  try {
    const fields = ownDataFields(value, [], ["version", "visible", "slots"]);
    const slots = Object.hasOwn(fields, "slots")
      ? [...ownArrayValues(fields.slots, STUDIO_COMMAND_BAR_SLOT_COUNT)]
      : undefined;
    return normalizeStudioCommandBarPreferences({
      version: fields.version,
      visible: fields.visible,
      slots,
    });
  } catch (error) {
    if (
      error instanceof InterchangeBoundaryError &&
      error.reason === "sensitive-field"
    ) {
      throw error;
    }
    return normalizeStudioCommandBarPreferences(undefined);
  }
}

function parsePresentation(
  value: unknown,
): StudioWorkspaceInterchangePresentation {
  const presentation = ownDataFields(
    value,
    ["panels"],
    ["drawingPalettes", "quickActions", "quickAccess", "commandBar"],
  );
  return Object.freeze({
    panels: parsePanels(presentation.panels),
    ...(Object.hasOwn(presentation, "drawingPalettes")
      ? { drawingPalettes: parseDrawingPalettes(presentation.drawingPalettes) }
      : {}),
    ...(Object.hasOwn(presentation, "quickActions")
      ? {
          quickActions: parseQuickActions(presentation.quickActions),
        }
      : {}),
    ...(Object.hasOwn(presentation, "quickAccess")
      ? {
          quickAccess: parseQuickAccess(presentation.quickAccess),
        }
      : {}),
    ...(Object.hasOwn(presentation, "commandBar")
      ? {
          commandBar: parseCommandBar(presentation.commandBar),
        }
      : {}),
  });
}

function workspaceNameKey(name: string): string {
  return name.normalize("NFKC").toLocaleLowerCase("en-US");
}

function parseWorkspace(value: unknown): StudioWorkspaceInterchangeWorkspace {
  const workspace = ownDataFields(value, ["id", "name", "presentation"]);
  return Object.freeze({
    id: parseWorkspaceId(workspace.id),
    name: parseWorkspaceName(workspace.name),
    presentation: parsePresentation(workspace.presentation),
  });
}

function parseWorkspaces(
  value: unknown,
  allowEmpty = false,
): readonly StudioWorkspaceInterchangeWorkspace[] {
  const candidates = ownArrayValues(
    value,
    STUDIO_WORKSPACE_INTERCHANGE_MAX_WORKSPACES,
  );
  if (!allowEmpty && candidates.length === 0) boundaryFailure("invalid-shape");
  const ids = new Set<string>();
  const names = new Set<string>();
  const workspaces = candidates.map((candidate) => {
    const workspace = parseWorkspace(candidate);
    if (ids.has(workspace.id)) boundaryFailure("duplicate-workspace-id");
    const nameKey = workspaceNameKey(workspace.name);
    if (names.has(nameKey)) boundaryFailure("duplicate-workspace-name");
    ids.add(workspace.id);
    names.add(nameKey);
    return workspace;
  });
  return Object.freeze(workspaces);
}

function parseDocument(value: unknown): StudioWorkspaceInterchangeDocument {
  const document = ownDataFields(value, ["kind", "version", "workspaces"]);
  if (document.kind !== STUDIO_WORKSPACE_INTERCHANGE_KIND) {
    boundaryFailure("unsupported-kind");
  }
  if (document.version !== STUDIO_WORKSPACE_INTERCHANGE_VERSION) {
    boundaryFailure("unsupported-version");
  }
  return Object.freeze({
    kind: STUDIO_WORKSPACE_INTERCHANGE_KIND,
    version: STUDIO_WORKSPACE_INTERCHANGE_VERSION,
    workspaces: parseWorkspaces(document.workspaces),
  });
}

function boundedDocument(value: unknown): StudioWorkspaceInterchangeDocument {
  let decoded = value;
  if (typeof value === "string") {
    if (utf8ByteLength(value) > STUDIO_WORKSPACE_INTERCHANGE_MAX_BYTES) {
      boundaryFailure("payload-too-large");
    }
    try {
      decoded = JSON.parse(value) as unknown;
    } catch {
      boundaryFailure("invalid-shape");
    }
  }
  const document = parseDocument(decoded);
  const text = JSON.stringify(document);
  if (utf8ByteLength(text) > STUDIO_WORKSPACE_INTERCHANGE_MAX_BYTES) {
    boundaryFailure("payload-too-large");
  }
  return document;
}

function parseExportOptions(
  value: StudioWorkspaceInterchangeExportOptions | undefined,
): Required<StudioWorkspaceInterchangeExportOptions> {
  if (value === undefined) {
    return Object.freeze({
      includeDrawingPalettes: true,
      includeQuickActions: true,
      includeQuickAccess: true,
      includeCommandBar: true,
    });
  }
  const options = ownDataFields(
    value,
    [],
    [
      "includeDrawingPalettes",
      "includeQuickActions",
      "includeQuickAccess",
      "includeCommandBar",
    ],
  );
  for (const option of Object.values(options)) {
    if (typeof option !== "boolean") boundaryFailure("invalid-shape");
  }
  return Object.freeze({
    includeDrawingPalettes:
      typeof options.includeDrawingPalettes === "boolean"
        ? options.includeDrawingPalettes
        : true,
    includeQuickActions:
      typeof options.includeQuickActions === "boolean"
        ? options.includeQuickActions
        : true,
    includeQuickAccess:
      typeof options.includeQuickAccess === "boolean"
        ? options.includeQuickAccess
        : true,
    includeCommandBar:
      typeof options.includeCommandBar === "boolean"
        ? options.includeCommandBar
        : true,
  });
}

function filterPresentationForExport(
  presentation: StudioWorkspaceInterchangePresentation,
  options: Required<StudioWorkspaceInterchangeExportOptions>,
): StudioWorkspaceInterchangePresentation {
  return Object.freeze({
    panels: presentation.panels,
    ...(options.includeDrawingPalettes && presentation.drawingPalettes
      ? { drawingPalettes: presentation.drawingPalettes }
      : {}),
    ...(options.includeQuickActions && presentation.quickActions !== undefined
      ? { quickActions: presentation.quickActions }
      : {}),
    ...(options.includeQuickAccess && presentation.quickAccess !== undefined
      ? { quickAccess: presentation.quickAccess }
      : {}),
    ...(options.includeCommandBar && presentation.commandBar !== undefined
      ? { commandBar: presentation.commandBar }
      : {}),
  });
}

/** Strictly exports one or more user workspaces into a deterministic, presentation-only JSON file. */
export function encodeStudioWorkspaceInterchange(
  workspaces: unknown,
  options?: StudioWorkspaceInterchangeExportOptions,
): StudioWorkspaceInterchangeEncodeResult {
  try {
    const parsedOptions = parseExportOptions(options);
    const document = Object.freeze({
      kind: STUDIO_WORKSPACE_INTERCHANGE_KIND,
      version: STUDIO_WORKSPACE_INTERCHANGE_VERSION,
      workspaces: Object.freeze(
        parseWorkspaces(workspaces).map((workspace) =>
          Object.freeze({
            ...workspace,
            presentation: filterPresentationForExport(
              workspace.presentation,
              parsedOptions,
            ),
          }),
        ),
      ),
    });
    const text = JSON.stringify(document);
    if (utf8ByteLength(text) > STUDIO_WORKSPACE_INTERCHANGE_MAX_BYTES) {
      boundaryFailure("payload-too-large");
    }
    return Object.freeze({ ok: true, document, text });
  } catch (error) {
    return failure(failureReason(error));
  }
}

/** Decodes only the exact current kind/version and fails closed on every malformed boundary. */
export function decodeStudioWorkspaceInterchange(
  raw: unknown,
): StudioWorkspaceInterchangeDecodeResult {
  try {
    return Object.freeze({ ok: true, document: boundedDocument(raw) });
  } catch (error) {
    return failure(failureReason(error));
  }
}

function parseTargetState(value: unknown): StudioWorkspaceInterchangeTargetState {
  const state = ownDataFields(
    value,
    ["activeWorkspaceId", "livePresentation", "workspaces"],
  );
  return Object.freeze({
    activeWorkspaceId: parseWorkspaceId(state.activeWorkspaceId, true),
    livePresentation: parsePresentation(state.livePresentation),
    workspaces: parseWorkspaces(state.workspaces, true),
  });
}

function parseScopes(value: unknown): readonly StudioWorkspaceInterchangeScope[] {
  if (value === undefined) {
    return Object.freeze([...STUDIO_WORKSPACE_INTERCHANGE_SCOPES]);
  }
  const candidates = ownArrayValues(value, STUDIO_WORKSPACE_INTERCHANGE_SCOPES.length);
  const seen = new Set<string>();
  const scopes: StudioWorkspaceInterchangeScope[] = [];
  for (const candidate of candidates) {
    if (
      typeof candidate !== "string" ||
      !SCOPE_SET.has(candidate) ||
      seen.has(candidate)
    ) {
      boundaryFailure("invalid-scope");
    }
    seen.add(candidate);
    scopes.push(candidate as StudioWorkspaceInterchangeScope);
  }
  return Object.freeze(scopes);
}

interface ParsedPlanOptions {
  readonly action: StudioWorkspaceInterchangeAction;
  readonly scopes: readonly StudioWorkspaceInterchangeScope[];
  readonly createConflictId: () => string;
  readonly applyWorkspaceId?: string;
}

function parsePlanOptions(value: unknown): ParsedPlanOptions {
  const options = ownDataFields(
    value,
    ["createConflictId"],
    ["action", "scopes", "applyWorkspaceId"],
  );
  const action = options.action === undefined ? "add" : options.action;
  if (typeof action !== "string" || !ACTION_SET.has(action)) {
    boundaryFailure("invalid-action");
  }
  if (typeof options.createConflictId !== "function") {
    boundaryFailure("invalid-shape");
  }
  const applyWorkspaceId = options.applyWorkspaceId === undefined
    ? undefined
    : parseWorkspaceId(options.applyWorkspaceId);
  return Object.freeze({
    action: action as StudioWorkspaceInterchangeAction,
    scopes: parseScopes(options.scopes),
    createConflictId: options.createConflictId as () => string,
    ...(applyWorkspaceId ? { applyWorkspaceId } : {}),
  });
}

function mergePresentationScopes(
  current: StudioWorkspaceInterchangePresentation,
  imported: StudioWorkspaceInterchangePresentation,
  scopes: readonly StudioWorkspaceInterchangeScope[],
): StudioWorkspaceInterchangePresentation {
  const selected = new Set(scopes);
  const drawingPalettes =
    selected.has("drawingPalettes") && imported.drawingPalettes
      ? imported.drawingPalettes
      : current.drawingPalettes;
  const quickActions =
    selected.has("quickAccess") &&
    Object.hasOwn(imported, "quickActions")
      ? imported.quickActions
      : current.quickActions;
  const quickAccess =
    selected.has("quickAccess") &&
    Object.hasOwn(imported, "quickAccess")
      ? imported.quickAccess
      : current.quickAccess;
  // Command-surface customizations travel together: the command bar restores under the same
  // `quickAccess` scope as the radial quick actions, keeping the scope vocabulary stable.
  const commandBar =
    selected.has("quickAccess") &&
    Object.hasOwn(imported, "commandBar")
      ? imported.commandBar
      : current.commandBar;
  return Object.freeze({
    panels: selected.has("panels") ? imported.panels : current.panels,
    ...(drawingPalettes ? { drawingPalettes } : {}),
    ...(quickActions !== undefined ? { quickActions } : {}),
    ...(quickAccess !== undefined ? { quickAccess } : {}),
    ...(commandBar !== undefined ? { commandBar } : {}),
  });
}

function truncateName(name: string, maximumCodePoints: number): string {
  return Array.from(name).slice(0, Math.max(0, maximumCodePoints)).join("");
}

function uniqueImportedName(name: string, occupiedNames: Set<string>): string {
  if (!occupiedNames.has(workspaceNameKey(name))) return name;
  for (let sequence = 1; sequence <= STUDIO_WORKSPACE_INTERCHANGE_MAX_WORKSPACES + 1; sequence += 1) {
    const suffix = sequence === 1 ? " 가져옴" : ` 가져옴 ${sequence}`;
    const candidate = `${truncateName(
      name,
      WORKSPACE_NAME_MAX_CODE_POINTS - Array.from(suffix).length,
    )}${suffix}`;
    if (!occupiedNames.has(workspaceNameKey(candidate))) return candidate;
  }
  boundaryFailure("duplicate-workspace-name");
}

function conflictFreeId(
  requestedId: string,
  occupiedIds: Set<string>,
  createConflictId: () => string,
): string {
  if (!occupiedIds.has(requestedId) && !BUILTIN_WORKSPACE_IDS.has(requestedId)) {
    return requestedId;
  }
  for (let attempt = 0; attempt < MAX_ID_FACTORY_ATTEMPTS; attempt += 1) {
    let candidate: unknown;
    try {
      candidate = createConflictId();
    } catch {
      boundaryFailure("id-factory-exhausted");
    }
    try {
      const id = parseWorkspaceId(candidate);
      if (!occupiedIds.has(id)) return id;
    } catch (error) {
      if (
        !(error instanceof InterchangeBoundaryError) ||
        error.reason !== "invalid-id"
      ) {
        throw error;
      }
    }
  }
  boundaryFailure("id-factory-exhausted");
}

interface PlannedCatalog {
  readonly workspaces: readonly StudioWorkspaceInterchangeWorkspace[];
  readonly operations: readonly StudioWorkspaceInterchangeOperation[];
}

function buildCatalogPlan(
  current: StudioWorkspaceInterchangeTargetState,
  imported: StudioWorkspaceInterchangeDocument,
  options: ParsedPlanOptions,
): PlannedCatalog {
  const workspaces = [...current.workspaces];
  const occupiedIds = new Set(workspaces.map(({ id }) => id));
  const occupiedNames = new Set(workspaces.map(({ name }) => workspaceNameKey(name)));
  const operations: StudioWorkspaceInterchangeOperation[] = [];

  for (const source of imported.workspaces) {
    const sourceNameKey = workspaceNameKey(source.name);
    const replacementIndex = options.action === "replace-same-name"
      ? workspaces.findIndex(({ name }) => workspaceNameKey(name) === sourceNameKey)
      : -1;
    if (
      replacementIndex < 0 &&
      workspaces.length >= STUDIO_WORKSPACE_INTERCHANGE_MAX_WORKSPACES
    ) {
      boundaryFailure("catalog-full");
    }

    const replacement = replacementIndex >= 0
      ? workspaces[replacementIndex]
      : undefined;
    const targetId = replacement
      ? replacement.id
      : conflictFreeId(source.id, occupiedIds, options.createConflictId);
    const targetName = replacement
      ? source.name
      : uniqueImportedName(source.name, occupiedNames);
    const workspace = Object.freeze({
      id: targetId,
      name: targetName,
      presentation: mergePresentationScopes(
        replacement?.presentation ?? current.livePresentation,
        source.presentation,
        options.scopes,
      ),
    });

    if (replacementIndex >= 0) {
      workspaces[replacementIndex] = workspace;
    } else {
      workspaces.push(workspace);
      occupiedIds.add(targetId);
    }
    occupiedNames.add(workspaceNameKey(targetName));
    operations.push(Object.freeze({
      kind: replacement ? "replace" : "add",
      sourceWorkspaceId: source.id,
      targetWorkspaceId: targetId,
      renamed: targetName !== source.name,
      idRemapped: targetId !== source.id,
      workspace,
    }));
  }

  return Object.freeze({
    workspaces: Object.freeze(workspaces),
    operations: Object.freeze(operations),
  });
}

function appliedOperation(
  operations: readonly StudioWorkspaceInterchangeOperation[],
  requestedSourceId: string | undefined,
): StudioWorkspaceInterchangeOperation {
  const operation = requestedSourceId
    ? operations.find(({ sourceWorkspaceId }) => sourceWorkspaceId === requestedSourceId)
    : operations[0];
  if (!operation) boundaryFailure("unknown-apply-workspace");
  return operation;
}

/**
 * Creates an immutable import plan without mutating the current catalog.
 *
 * Omitting `action` always adds snapshots without changing the active/live workspace. Applying or
 * replacing requires an explicit action string. Scope omissions are filled from the current live
 * presentation, so importing only panels cannot overwrite palette, command-bar, or Quick Access
 * preferences.
 */
export function planStudioWorkspaceInterchangeImport(
  currentState: unknown,
  rawImport: unknown,
  options: StudioWorkspaceInterchangePlanOptions,
): StudioWorkspaceInterchangePlanResult {
  let current: StudioWorkspaceInterchangeTargetState;
  try {
    current = parseTargetState(currentState);
  } catch {
    return failure("invalid-current-state");
  }
  try {
    const imported = boundedDocument(rawImport);
    const parsedOptions = parsePlanOptions(options);
    if (
      parsedOptions.applyWorkspaceId &&
      !imported.workspaces.some(({ id }) => id === parsedOptions.applyWorkspaceId)
    ) {
      boundaryFailure("unknown-apply-workspace");
    }
    const catalog = buildCatalogPlan(current, imported, parsedOptions);
    const applied = parsedOptions.action === "add-and-apply"
      ? appliedOperation(catalog.operations, parsedOptions.applyWorkspaceId)
      : null;
    const nextState = Object.freeze({
      activeWorkspaceId: applied
        ? applied.targetWorkspaceId
        : current.activeWorkspaceId,
      livePresentation: applied
        ? applied.workspace.presentation
        : current.livePresentation,
      workspaces: catalog.workspaces,
    });
    const plan = Object.freeze({
      action: parsedOptions.action,
      scopes: parsedOptions.scopes,
      operations: catalog.operations,
      nextState,
    });
    return Object.freeze({ ok: true, plan });
  } catch (error) {
    return failure(failureReason(error));
  }
}
