import { z } from "zod";

import { PAGE_GRADE_PRESETS, type PageGrade } from "./studio-page-grade";

export const STUDIO_AUTO_ACTION_SET_KIND = "toonspectrum-studio-auto-actions" as const;
export const STUDIO_AUTO_ACTION_SET_VERSION = 1 as const;

export const STUDIO_AUTO_ACTION_LIMITS = {
  maxJsonCodeUnits: 128_000,
  maxTreeNodes: 8_000,
  maxTreeDepth: 12,
  maxCommands: 64,
  maxPages: 200,
  maxElementsPerPage: 10_000,
  maxTotalElements: 100_000,
  maxWorkUnits: 2_000_000,
  maxSelectedPages: 200,
  maxIdCodeUnits: 120,
  maxNameCodeUnits: 120,
  maxDescriptionCodeUnits: 1_000,
  maxFilterTextCodeUnits: 120,
} as const;

const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const COLOR_PATTERN = /^#(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/iu;

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

const ELEMENT_TYPES = [
  "image",
  "text",
  "bubble",
  "sticker",
  "draw",
  "frame",
  "focusLines",
  "speedLines",
] as const;

const LETTERING_ELEMENT_TYPES = ["text", "bubble"] as const;

export const STUDIO_AUTO_ACTION_BLEND_MODES = [
  "source-over",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
] as const;

const PAGE_GRADE_PRESET_IDS = [
  "neutral",
  "recall",
  "night",
  "dawn",
  "dusk",
  "horror",
  "dreamy",
  "mono-manuscript",
  "rainy",
  "warm-afternoon",
] as const;

const IdSchema = z
  .string()
  .trim()
  .min(1)
  .max(STUDIO_AUTO_ACTION_LIMITS.maxIdCodeUnits)
  .refine((value) => !hasControlCharacters(value), "ID에 제어 문자를 사용할 수 없습니다.");

const DisplayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(STUDIO_AUTO_ACTION_LIMITS.maxNameCodeUnits)
  .refine((value) => !hasControlCharacters(value), "이름에 제어 문자를 사용할 수 없습니다.");

const ColorSchema = z
  .string()
  .trim()
  .regex(COLOR_PATTERN, "색상은 #RGB, #RRGGBB 또는 #RRGGBBAA 형식이어야 합니다.")
  .transform((value) => value.toLowerCase());

const ElementTypeSchema = z.enum(ELEMENT_TYPES);
const LetteringElementTypeSchema = z.enum(LETTERING_ELEMENT_TYPES);

const ElementNameFilterSchema = z
  .object({
    mode: z.enum(["exact", "contains", "starts-with", "ends-with"]),
    value: z.string().trim().min(1).max(STUDIO_AUTO_ACTION_LIMITS.maxFilterTextCodeUnits),
    caseSensitive: z.boolean().default(false),
  })
  .strict();

const ElementFilterSchema = z
  .object({
    elementTypes: z.array(ElementTypeSchema).min(1).max(ELEMENT_TYPES.length).optional(),
    name: ElementNameFilterSchema.optional(),
  })
  .strict();

const LetteringFilterSchema = z
  .object({
    elementTypes: z.array(LetteringElementTypeSchema).min(1).max(LETTERING_ELEMENT_TYPES.length).optional(),
    name: ElementNameFilterSchema.optional(),
  })
  .strict();

const commandBase = {
  id: IdSchema,
  enabled: z.boolean().default(true),
};

const StudioAutoActionCommandSchema = z.discriminatedUnion("type", [
  z.object({
    ...commandBase,
    type: z.literal("lettering.set-font"),
    font: z.string().trim().min(1).max(120),
    filter: LetteringFilterSchema.optional(),
  }).strict(),
  z.object({
    ...commandBase,
    type: z.literal("lettering.set-size"),
    fontSize: z.number().finite().min(4).max(512),
    filter: LetteringFilterSchema.optional(),
  }).strict(),
  z.object({
    ...commandBase,
    type: z.literal("lettering.set-color"),
    color: ColorSchema,
    filter: LetteringFilterSchema.optional(),
  }).strict(),
  z.object({
    ...commandBase,
    type: z.literal("element.set-opacity"),
    opacity: z.number().finite().min(0).max(1),
    filter: ElementFilterSchema.optional(),
  }).strict(),
  z.object({
    ...commandBase,
    type: z.literal("element.set-blend-mode"),
    blendMode: z.enum(STUDIO_AUTO_ACTION_BLEND_MODES),
    filter: ElementFilterSchema.optional(),
  }).strict(),
  z.object({
    ...commandBase,
    type: z.literal("element.set-hidden"),
    hidden: z.boolean(),
    filter: ElementFilterSchema.optional(),
  }).strict(),
  z.object({
    ...commandBase,
    type: z.literal("element.set-locked"),
    locked: z.boolean(),
    filter: ElementFilterSchema.optional(),
  }).strict(),
  z.object({
    ...commandBase,
    type: z.literal("page.set-background"),
    background: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("solid"), color: ColorSchema }).strict(),
      z.object({
        kind: z.literal("gradient"),
        colors: z.tuple([ColorSchema, ColorSchema]),
      }).strict(),
    ]),
  }).strict(),
  z.object({
    ...commandBase,
    type: z.literal("page.apply-grade-preset"),
    preset: z.enum(PAGE_GRADE_PRESET_IDS),
  }).strict(),
]);

export const StudioAutoActionSetSchema = z
  .object({
    kind: z.literal(STUDIO_AUTO_ACTION_SET_KIND),
    version: z.literal(STUDIO_AUTO_ACTION_SET_VERSION),
    id: IdSchema,
    name: DisplayNameSchema,
    description: z.string().trim().max(STUDIO_AUTO_ACTION_LIMITS.maxDescriptionCodeUnits).optional(),
    commands: z.array(StudioAutoActionCommandSchema).min(1).max(STUDIO_AUTO_ACTION_LIMITS.maxCommands),
  })
  .strict()
  .superRefine((value, context) => {
    const seen = new Set<string>();
    for (let index = 0; index < value.commands.length; index += 1) {
      const commandId = value.commands[index]?.id;
      if (commandId && seen.has(commandId)) {
        context.addIssue({
          code: "custom",
          path: ["commands", index, "id"],
          message: `명령 ID가 중복되었습니다: ${commandId}`,
        });
      }
      if (commandId) seen.add(commandId);
    }
  });

const StudioAutoActionScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("current") }).strict(),
  z.object({
    kind: z.literal("selected-pages"),
    pageIds: z.array(IdSchema).min(1).max(STUDIO_AUTO_ACTION_LIMITS.maxSelectedPages),
  }).strict(),
  z.object({ kind: z.literal("all") }).strict(),
]);

export type StudioAutoActionCommand = z.infer<typeof StudioAutoActionCommandSchema>;
export type StudioAutoActionSet = z.infer<typeof StudioAutoActionSetSchema>;
export type StudioAutoActionScope = z.infer<typeof StudioAutoActionScopeSchema>;
export type StudioAutoActionElementType = z.infer<typeof ElementTypeSchema>;

export type StudioAutoActionElement = Readonly<Record<string, unknown>> & {
  readonly id: string;
  readonly type: string;
};

type StudioAutoActionPageBase = Readonly<{
  readonly id: string;
  readonly elements: readonly unknown[];
  readonly bg?: unknown;
  readonly bgGrad?: unknown;
  readonly grade?: unknown;
}>;

export type StudioAutoActionPage = Readonly<Record<string, unknown>> & StudioAutoActionPageBase;

export type StudioAutoActionFailure = {
  pageId: string;
  commandId: string | null;
  code: "invalid_page" | "invalid_element" | "command_failed";
  message: string;
};

export type StudioAutoActionStepImpact = {
  commandId: string;
  commandType: StudioAutoActionCommand["type"];
  matchedPages: number;
  affectedPages: number;
  matchedElements: number;
  affectedElements: number;
  warnings: string[];
};

export type StudioAutoActionPlan = {
  actionSetId: string;
  scope: StudioAutoActionScope;
  targetPageIds: string[];
  steps: StudioAutoActionStepImpact[];
  affectedPageIds: string[];
  affectedElementCount: number;
  mutationCount: number;
  warnings: string[];
  failures: StudioAutoActionFailure[];
};

export type StudioAutoActionExecutionResult<P extends StudioAutoActionPageBase> = {
  status: "succeeded" | "cancelled" | "failed";
  committed: boolean;
  pages: readonly P[];
  plan: StudioAutoActionPlan;
  failures: StudioAutoActionFailure[];
};

export type StudioAutoActionExecutionProgress = {
  phase: "planning" | "executing";
  completedOperations: number;
  totalOperations: number;
  currentCommandId: string | null;
  currentPageId: string | null;
};

const DEFAULT_STUDIO_AUTO_ACTION_SET_INPUT = {
  kind: STUDIO_AUTO_ACTION_SET_KIND,
  version: STUDIO_AUTO_ACTION_SET_VERSION,
  id: "built-in-dialogue-readability",
  name: "대사 가독성 정리",
  description: "텍스트와 말풍선 대사를 Pretendard 32px의 짙은 잉크색으로 통일합니다.",
  commands: [
    {
      id: "dialogue-font",
      type: "lettering.set-font",
      font: "Pretendard",
      filter: { elementTypes: ["text", "bubble"] },
    },
    {
      id: "dialogue-size",
      type: "lettering.set-size",
      fontSize: 32,
      filter: { elementTypes: ["text", "bubble"] },
    },
    {
      id: "dialogue-color",
      type: "lettering.set-color",
      color: "#202020",
      filter: { elementTypes: ["text", "bubble"] },
    },
  ],
} as const;

export class StudioAutoActionValidationError extends Error {
  readonly code:
    | "invalid_json"
    | "invalid_structure"
    | "future_version"
    | "unsafe_key"
    | "size_limit"
    | "work_limit";

  constructor(
    code: StudioAutoActionValidationError["code"],
    message: string
  ) {
    super(message);
    this.name = "StudioAutoActionValidationError";
    this.code = code;
  }
}

class StudioAutoActionPageTransformError extends Error {
  readonly failure: StudioAutoActionFailure;

  constructor(failure: StudioAutoActionFailure) {
    super(failure.message);
    this.name = "StudioAutoActionPageTransformError";
    this.failure = failure;
  }
}

class StudioAutoActionCancelledError extends Error {
  constructor() {
    super("Auto Action 실행이 취소되었습니다.");
    this.name = "StudioAutoActionCancelledError";
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasDangerousOwnKey(value: Record<string, unknown>): boolean {
  return Object.keys(value).some((key) => DANGEROUS_KEYS.has(key));
}

function assertSafeStructuredValue(root: unknown): void {
  const seen = new WeakSet<object>();
  const stack: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  let nodes = 0;
  let stringCodeUnits = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    nodes += 1;
    if (nodes > STUDIO_AUTO_ACTION_LIMITS.maxTreeNodes) {
      throw new StudioAutoActionValidationError("size_limit", "Action Set 구조가 너무 큽니다.");
    }
    if (current.depth > STUDIO_AUTO_ACTION_LIMITS.maxTreeDepth) {
      throw new StudioAutoActionValidationError("size_limit", "Action Set 중첩 깊이가 너무 큽니다.");
    }
    if (typeof current.value === "string") {
      stringCodeUnits += current.value.length;
      if (stringCodeUnits > STUDIO_AUTO_ACTION_LIMITS.maxJsonCodeUnits) {
        throw new StudioAutoActionValidationError("size_limit", "Action Set 문자열 데이터가 너무 큽니다.");
      }
      continue;
    }
    if (current.value === null || ["number", "boolean"].includes(typeof current.value)) continue;
    if (typeof current.value !== "object") {
      throw new StudioAutoActionValidationError(
        "invalid_structure",
        "Action Set에는 JSON으로 표현할 수 있는 값만 사용할 수 있습니다."
      );
    }
    if (seen.has(current.value)) {
      throw new StudioAutoActionValidationError("invalid_structure", "순환 참조 Action Set은 지원하지 않습니다.");
    }
    seen.add(current.value);
    if (Array.isArray(current.value)) {
      for (const item of current.value) stack.push({ value: item, depth: current.depth + 1 });
      continue;
    }
    if (!isPlainRecord(current.value)) {
      throw new StudioAutoActionValidationError("invalid_structure", "Action Set 객체 형식이 안전하지 않습니다.");
    }
    const descriptors = Object.getOwnPropertyDescriptors(current.value);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== "string") {
        throw new StudioAutoActionValidationError("invalid_structure", "Symbol 키는 사용할 수 없습니다.");
      }
      if (DANGEROUS_KEYS.has(key)) {
        throw new StudioAutoActionValidationError("unsafe_key", `안전하지 않은 키를 거부했습니다: ${key}`);
      }
      const descriptor = descriptors[key];
      if (!descriptor || descriptor.get || descriptor.set) {
        throw new StudioAutoActionValidationError("invalid_structure", "접근자 속성은 사용할 수 없습니다.");
      }
      stack.push({ value: descriptor.value, depth: current.depth + 1 });
    }
  }
}

function zodIssueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Action Set 형식이 올바르지 않습니다.";
  const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
  return `${path}${issue.message}`;
}

export function normalizeStudioAutoActionSet(value: unknown): StudioAutoActionSet {
  assertSafeStructuredValue(value);
  if (isPlainRecord(value) && typeof value.version === "number" && value.version > STUDIO_AUTO_ACTION_SET_VERSION) {
    throw new StudioAutoActionValidationError(
      "future_version",
      `이 앱보다 새로운 Action Set 버전(${value.version})은 가져올 수 없습니다.`
    );
  }
  const result = StudioAutoActionSetSchema.safeParse(value);
  if (!result.success) {
    throw new StudioAutoActionValidationError("invalid_structure", zodIssueMessage(result.error));
  }
  return result.data;
}

/** 새 문서를 시작하거나 Action Set 파일이 아직 없을 때 바로 써볼 수 있는 안전한 내장 preset. */
export function createDefaultStudioAutoActionSet(): StudioAutoActionSet {
  return normalizeStudioAutoActionSet(DEFAULT_STUDIO_AUTO_ACTION_SET_INPUT);
}

export function importStudioAutoActionSetJson(json: string): StudioAutoActionSet {
  if (typeof json !== "string" || json.length === 0) {
    throw new StudioAutoActionValidationError("invalid_json", "Action Set JSON이 비어 있습니다.");
  }
  if (json.length > STUDIO_AUTO_ACTION_LIMITS.maxJsonCodeUnits) {
    throw new StudioAutoActionValidationError("size_limit", "Action Set JSON 파일이 너무 큽니다.");
  }
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new StudioAutoActionValidationError("invalid_json", "Action Set JSON을 해석할 수 없습니다.");
  }
  return normalizeStudioAutoActionSet(value);
}

export function exportStudioAutoActionSetJson(value: unknown, pretty = true): string {
  const normalized = normalizeStudioAutoActionSet(value);
  const json = JSON.stringify(normalized, null, pretty ? 2 : 0);
  if (json.length > STUDIO_AUTO_ACTION_LIMITS.maxJsonCodeUnits) {
    throw new StudioAutoActionValidationError("size_limit", "내보낼 Action Set JSON이 너무 큽니다.");
  }
  return json;
}

function normalizeScope(value: unknown): StudioAutoActionScope {
  const result = StudioAutoActionScopeSchema.safeParse(value);
  if (!result.success) {
    throw new StudioAutoActionValidationError("invalid_structure", `scope: ${zodIssueMessage(result.error)}`);
  }
  if (result.data.kind !== "selected-pages") return result.data;
  return { ...result.data, pageIds: [...new Set(result.data.pageIds)] };
}

function validatePages<P extends StudioAutoActionPageBase>(pages: readonly P[]): Map<string, P> {
  if (!Array.isArray(pages) || pages.length === 0 || pages.length > STUDIO_AUTO_ACTION_LIMITS.maxPages) {
    throw new StudioAutoActionValidationError(
      "size_limit",
      `페이지는 1~${STUDIO_AUTO_ACTION_LIMITS.maxPages}개여야 합니다.`
    );
  }
  const byId = new Map<string, P>();
  let totalElements = 0;
  for (const page of pages) {
    if (!isPlainRecord(page) || hasDangerousOwnKey(page)) {
      throw new StudioAutoActionValidationError("invalid_structure", "페이지 객체 형식이 안전하지 않습니다.");
    }
    if (typeof page.id !== "string" || !page.id || page.id.length > STUDIO_AUTO_ACTION_LIMITS.maxIdCodeUnits) {
      throw new StudioAutoActionValidationError("invalid_structure", "페이지 ID가 올바르지 않습니다.");
    }
    if (byId.has(page.id)) {
      throw new StudioAutoActionValidationError("invalid_structure", `페이지 ID가 중복되었습니다: ${page.id}`);
    }
    if (!Array.isArray(page.elements) || page.elements.length > STUDIO_AUTO_ACTION_LIMITS.maxElementsPerPage) {
      throw new StudioAutoActionValidationError(
        "size_limit",
        `페이지당 요소는 ${STUDIO_AUTO_ACTION_LIMITS.maxElementsPerPage}개 이하여야 합니다.`
      );
    }
    totalElements += page.elements.length;
    if (totalElements > STUDIO_AUTO_ACTION_LIMITS.maxTotalElements) {
      throw new StudioAutoActionValidationError("size_limit", "문서의 전체 요소 수가 Auto Actions 상한을 넘었습니다.");
    }
    byId.set(page.id, page as P);
  }
  return byId;
}

function resolveTargetPages<P extends StudioAutoActionPageBase>(
  pages: readonly P[],
  byId: ReadonlyMap<string, P>,
  scope: StudioAutoActionScope,
  currentPageId: string | null | undefined
): { targetPageIds: string[]; warnings: string[] } {
  if (scope.kind === "all") return { targetPageIds: pages.map((page) => page.id), warnings: [] };
  if (scope.kind === "current") {
    if (currentPageId && byId.has(currentPageId)) return { targetPageIds: [currentPageId], warnings: [] };
    return { targetPageIds: [], warnings: ["현재 페이지를 찾을 수 없어 실행 대상이 없습니다."] };
  }
  const requested = new Set(scope.pageIds);
  const targetPageIds = pages.filter((page) => requested.has(page.id)).map((page) => page.id);
  const missing = scope.pageIds.filter((pageId) => !byId.has(pageId));
  const warnings = missing.length > 0
    ? [`선택한 페이지 ${missing.length}개를 문서에서 찾지 못했습니다: ${missing.join(", ")}`]
    : [];
  return { targetPageIds, warnings };
}

function isElementCommand(command: StudioAutoActionCommand): boolean {
  return command.type.startsWith("lettering.") || command.type.startsWith("element.");
}

function validateWorkUnits<P extends StudioAutoActionPageBase>(
  actionSet: StudioAutoActionSet,
  targetPageIds: readonly string[],
  byId: ReadonlyMap<string, P>
): void {
  const elementCount = targetPageIds.reduce((sum, pageId) => sum + (byId.get(pageId)?.elements.length ?? 0), 0);
  const enabledElementCommands = actionSet.commands.filter((command) => command.enabled && isElementCommand(command)).length;
  const enabledPageCommands = actionSet.commands.filter((command) => command.enabled && !isElementCommand(command)).length;
  const workUnits = elementCount * enabledElementCommands + targetPageIds.length * enabledPageCommands;
  if (workUnits > STUDIO_AUTO_ACTION_LIMITS.maxWorkUnits) {
    throw new StudioAutoActionValidationError(
      "work_limit",
      `예상 작업량 ${workUnits.toLocaleString()}이 안전 상한 ${STUDIO_AUTO_ACTION_LIMITS.maxWorkUnits.toLocaleString()}을 넘었습니다.`
    );
  }
}

function nameMatches(element: Record<string, unknown>, filter: z.infer<typeof ElementNameFilterSchema>): boolean {
  if (typeof element.name !== "string") return false;
  const candidate = filter.caseSensitive ? element.name : element.name.toLocaleLowerCase("ko-KR");
  const expected = filter.caseSensitive ? filter.value : filter.value.toLocaleLowerCase("ko-KR");
  if (filter.mode === "exact") return candidate === expected;
  if (filter.mode === "starts-with") return candidate.startsWith(expected);
  if (filter.mode === "ends-with") return candidate.endsWith(expected);
  return candidate.includes(expected);
}

function elementMatchesFilter(
  element: Record<string, unknown>,
  filter: z.infer<typeof ElementFilterSchema> | z.infer<typeof LetteringFilterSchema> | undefined,
  requiredTypes?: readonly string[]
): boolean {
  const elementType = typeof element.type === "string" ? element.type : "";
  if (requiredTypes && !requiredTypes.includes(elementType)) return false;
  if (filter?.elementTypes && !filter.elementTypes.includes(elementType as never)) return false;
  if (filter?.name && !nameMatches(element, filter.name)) return false;
  return true;
}

function readElement(
  value: unknown,
  pageId: string,
  commandId: string,
  elementIndex: number
): Record<string, unknown> {
  if (!isPlainRecord(value) || hasDangerousOwnKey(value)) {
    throw new StudioAutoActionPageTransformError({
      pageId,
      commandId,
      code: "invalid_element",
      message: `${pageId}의 ${elementIndex + 1}번째 요소 형식이 안전하지 않습니다.`,
    });
  }
  if (typeof value.id !== "string" || !value.id || typeof value.type !== "string" || !value.type) {
    throw new StudioAutoActionPageTransformError({
      pageId,
      commandId,
      code: "invalid_element",
      message: `${pageId}의 ${elementIndex + 1}번째 요소 ID/타입이 올바르지 않습니다.`,
    });
  }
  return value;
}

function patchElementForCommand(
  element: Record<string, unknown>,
  command: StudioAutoActionCommand
): { matched: boolean; changed: boolean; element: Record<string, unknown> } {
  if (command.type === "lettering.set-font") {
    if (!elementMatchesFilter(element, command.filter, LETTERING_ELEMENT_TYPES)) {
      return { matched: false, changed: false, element };
    }
    if (element.font === command.font) return { matched: true, changed: false, element };
    return { matched: true, changed: true, element: { ...element, font: command.font } };
  }
  if (command.type === "lettering.set-size") {
    if (!elementMatchesFilter(element, command.filter, LETTERING_ELEMENT_TYPES)) {
      return { matched: false, changed: false, element };
    }
    if (element.fontSize === command.fontSize) return { matched: true, changed: false, element };
    return { matched: true, changed: true, element: { ...element, fontSize: command.fontSize } };
  }
  if (command.type === "lettering.set-color") {
    if (!elementMatchesFilter(element, command.filter, LETTERING_ELEMENT_TYPES)) {
      return { matched: false, changed: false, element };
    }
    const colorField = element.type === "bubble" ? "textFill" : "fill";
    if (element[colorField] === command.color) return { matched: true, changed: false, element };
    return { matched: true, changed: true, element: { ...element, [colorField]: command.color } };
  }
  if (command.type === "element.set-opacity") {
    if (!elementMatchesFilter(element, command.filter)) return { matched: false, changed: false, element };
    if (element.opacity === command.opacity) return { matched: true, changed: false, element };
    return { matched: true, changed: true, element: { ...element, opacity: command.opacity } };
  }
  if (command.type === "element.set-blend-mode") {
    if (!elementMatchesFilter(element, command.filter)) return { matched: false, changed: false, element };
    if (element.blendMode === command.blendMode) return { matched: true, changed: false, element };
    return { matched: true, changed: true, element: { ...element, blendMode: command.blendMode } };
  }
  if (command.type === "element.set-hidden") {
    if (!elementMatchesFilter(element, command.filter)) return { matched: false, changed: false, element };
    if (element.hidden === command.hidden) return { matched: true, changed: false, element };
    return { matched: true, changed: true, element: { ...element, hidden: command.hidden } };
  }
  if (command.type === "element.set-locked") {
    if (!elementMatchesFilter(element, command.filter)) return { matched: false, changed: false, element };
    if (element.locked === command.locked) return { matched: true, changed: false, element };
    return { matched: true, changed: true, element: { ...element, locked: command.locked } };
  }
  return { matched: false, changed: false, element };
}

const gradeByPresetId = new Map<string, PageGrade>(
  PAGE_GRADE_PRESETS.map((preset) => [preset.id, preset.grade])
);

type PageCommandResult<P extends StudioAutoActionPageBase> = {
  page: P;
  matchedPages: number;
  affectedPages: number;
  matchedElements: number;
  affectedElements: number;
};

function applyCommandToPage<P extends StudioAutoActionPageBase>(
  page: P,
  command: StudioAutoActionCommand,
  signal?: AbortSignal
): PageCommandResult<P> {
  if (signal?.aborted) throw new StudioAutoActionCancelledError();
  if (isElementCommand(command)) {
    let matchedElements = 0;
    let affectedElements = 0;
    let pageChanged = false;
    const nextElements = page.elements.map((rawElement, elementIndex) => {
      if (elementIndex % 256 === 0 && signal?.aborted) throw new StudioAutoActionCancelledError();
      const element = readElement(rawElement, page.id, command.id, elementIndex);
      const patched = patchElementForCommand(element, command);
      if (patched.matched) matchedElements += 1;
      if (patched.changed) {
        affectedElements += 1;
        pageChanged = true;
      }
      return patched.element;
    });
    return {
      page: pageChanged ? ({ ...page, elements: nextElements } as P) : page,
      matchedPages: matchedElements > 0 ? 1 : 0,
      affectedPages: pageChanged ? 1 : 0,
      matchedElements,
      affectedElements,
    };
  }

  if (command.type === "page.set-background") {
    const bg = command.background.kind === "solid"
      ? command.background.color
      : command.background.colors[0];
    const bgGrad = command.background.kind === "solid" ? null : [...command.background.colors];
    const currentGradient = Array.isArray(page.bgGrad) ? page.bgGrad : page.bgGrad ?? null;
    const sameGradient = Array.isArray(bgGrad)
      ? Array.isArray(currentGradient)
        && currentGradient.length === bgGrad.length
        && currentGradient.every((color, index) => color === bgGrad[index])
      : currentGradient === null;
    const changed = page.bg !== bg || !sameGradient;
    return {
      page: changed ? ({ ...page, bg, bgGrad } as P) : page,
      matchedPages: 1,
      affectedPages: changed ? 1 : 0,
      matchedElements: 0,
      affectedElements: 0,
    };
  }

  if (command.type !== "page.apply-grade-preset") {
    throw new StudioAutoActionPageTransformError({
      pageId: page.id,
      commandId: command.id,
      code: "command_failed",
      message: `지원하지 않는 페이지 명령입니다: ${command.type}`,
    });
  }
  const preset = gradeByPresetId.get(command.preset);
  if (!preset) {
    throw new StudioAutoActionPageTransformError({
      pageId: page.id,
      commandId: command.id,
      code: "command_failed",
      message: `색보정 프리셋을 찾을 수 없습니다: ${command.preset}`,
    });
  }
  const currentGrade = page.grade;
  if (currentGrade !== undefined && (!isPlainRecord(currentGrade) || hasDangerousOwnKey(currentGrade))) {
    throw new StudioAutoActionPageTransformError({
      pageId: page.id,
      commandId: command.id,
      code: "invalid_page",
      message: `${page.id}의 페이지 색보정 데이터가 안전하지 않습니다.`,
    });
  }
  const gradeRecord = isPlainRecord(currentGrade) ? currentGrade : {};
  const changed = Object.entries(preset).some(([key, value]) => gradeRecord[key] !== value);
  return {
    page: changed ? ({ ...page, grade: { ...gradeRecord, ...preset } } as P) : page,
    matchedPages: 1,
    affectedPages: changed ? 1 : 0,
    matchedElements: 0,
    affectedElements: 0,
  };
}

type PreparedExecution<P extends StudioAutoActionPageBase> = {
  actionSet: StudioAutoActionSet;
  scope: StudioAutoActionScope;
  byId: Map<string, P>;
  targetPageIds: string[];
  warnings: string[];
};

function prepareExecution<P extends StudioAutoActionPageBase>(input: {
  actionSet: unknown;
  pages: readonly P[];
  scope: unknown;
  currentPageId?: string | null;
}): PreparedExecution<P> {
  const actionSet = normalizeStudioAutoActionSet(input.actionSet);
  const scope = normalizeScope(input.scope);
  const byId = validatePages(input.pages);
  const targets = resolveTargetPages(input.pages, byId, scope, input.currentPageId);
  validateWorkUnits(actionSet, targets.targetPageIds, byId);
  return { actionSet, scope, byId, ...targets };
}

function emptyStepImpact(command: StudioAutoActionCommand): StudioAutoActionStepImpact {
  return {
    commandId: command.id,
    commandType: command.type,
    matchedPages: 0,
    affectedPages: 0,
    matchedElements: 0,
    affectedElements: 0,
    warnings: [],
  };
}

function buildPlan<P extends StudioAutoActionPageBase>(
  prepared: PreparedExecution<P>,
  sourcePages: readonly P[],
  signal?: AbortSignal
): { plan: StudioAutoActionPlan; pages: P[] } {
  const pageIndexById = new Map(sourcePages.map((page, index) => [page.id, index]));
  const workingPages = [...sourcePages];
  const failures: StudioAutoActionFailure[] = [];
  const failedPageIds = new Set<string>();
  const affectedPageIds = new Set<string>();
  let affectedElementCount = 0;
  let mutationCount = 0;
  const steps: StudioAutoActionStepImpact[] = [];

  for (const command of prepared.actionSet.commands) {
    const impact = emptyStepImpact(command);
    if (!command.enabled) {
      impact.warnings.push("비활성화된 명령이라 건너뛰었습니다.");
      steps.push(impact);
      continue;
    }
    for (const pageId of prepared.targetPageIds) {
      if (failedPageIds.has(pageId)) continue;
      const pageIndex = pageIndexById.get(pageId);
      if (pageIndex === undefined) continue;
      try {
        const applied = applyCommandToPage(workingPages[pageIndex]!, command, signal);
        workingPages[pageIndex] = applied.page;
        impact.matchedPages += applied.matchedPages;
        impact.affectedPages += applied.affectedPages;
        impact.matchedElements += applied.matchedElements;
        impact.affectedElements += applied.affectedElements;
        if (applied.affectedPages > 0) affectedPageIds.add(pageId);
        affectedElementCount += applied.affectedElements;
        mutationCount += applied.affectedElements + (isElementCommand(command) ? 0 : applied.affectedPages);
      } catch (error) {
        if (error instanceof StudioAutoActionCancelledError) throw error;
        const failure = error instanceof StudioAutoActionPageTransformError
          ? error.failure
          : {
              pageId,
              commandId: command.id,
              code: "command_failed" as const,
              message: `${pageId}에서 명령을 실행하지 못했습니다.`,
            };
        failures.push(failure);
        failedPageIds.add(pageId);
      }
    }
    if (impact.matchedPages === 0) impact.warnings.push("필터에 맞는 페이지 또는 요소가 없습니다.");
    else if (impact.affectedPages === 0) impact.warnings.push("대상 값이 이미 같아 변경할 내용이 없습니다.");
    steps.push(impact);
  }

  const warnings = [...prepared.warnings];
  if (prepared.targetPageIds.length === 0) warnings.push("실행 대상 페이지가 없습니다.");
  if (failures.length > 0) warnings.push(`페이지 ${failedPageIds.size}개에서 검증 또는 명령 실행에 실패했습니다.`);
  return {
    pages: workingPages,
    plan: {
      actionSetId: prepared.actionSet.id,
      scope: prepared.scope,
      targetPageIds: prepared.targetPageIds,
      steps,
      affectedPageIds: [...affectedPageIds],
      affectedElementCount,
      mutationCount,
      warnings,
      failures,
    },
  };
}

/** 입력 문서를 변경하지 않고 실제 순서대로 명령을 시뮬레이션해 영향과 경고를 반환한다. */
export function planStudioAutoActionExecution<P extends StudioAutoActionPageBase>(input: {
  actionSet: unknown;
  pages: readonly P[];
  scope: unknown;
  currentPageId?: string | null;
}): StudioAutoActionPlan {
  const prepared = prepareExecution(input);
  return buildPlan(prepared, input.pages).plan;
}

/**
 * 전체 문서를 메모리에서 불변 변환한 뒤 성공 시에만 새 pages 배열 하나를 반환한다. 취소/페이지 실패 시
 * 원본 pages를 그대로 반환하므로 호출부는 `committed`가 true일 때만 한 번의 history commit을 하면 된다.
 */
export async function executeStudioAutoAction<P extends StudioAutoActionPageBase>(input: {
  actionSet: unknown;
  pages: readonly P[];
  scope: unknown;
  currentPageId?: string | null;
  signal?: AbortSignal;
  onProgress?: (progress: StudioAutoActionExecutionProgress) => void;
  /** UI는 requestAnimationFrame 또는 scheduler yield를 주입할 수 있다. 기본은 event-loop yield. */
  yieldControl?: () => Promise<void>;
}): Promise<StudioAutoActionExecutionResult<P>> {
  const prepared = prepareExecution(input);
  const totalOperations = prepared.actionSet.commands.filter((command) => command.enabled).length
    * prepared.targetPageIds.length;
  const emitProgress = (progress: StudioAutoActionExecutionProgress) => {
    try {
      input.onProgress?.(progress);
    } catch {
      // 진행률 관찰자 오류가 문서 변환이나 원자적 롤백 계약을 깨면 안 된다.
    }
  };
  emitProgress({
    phase: "planning",
    completedOperations: 0,
    totalOperations,
    currentCommandId: null,
    currentPageId: null,
  });
  let dryRun: ReturnType<typeof buildPlan<P>>;
  try {
    dryRun = buildPlan(prepared, input.pages, input.signal);
  } catch (error) {
    if (!(error instanceof StudioAutoActionCancelledError)) throw error;
    return {
      status: "cancelled",
      committed: false,
      pages: input.pages,
      plan: {
        actionSetId: prepared.actionSet.id,
        scope: prepared.scope,
        targetPageIds: prepared.targetPageIds,
        steps: [],
        affectedPageIds: [],
        affectedElementCount: 0,
        mutationCount: 0,
        warnings: ["실행 전에 취소되었습니다."],
        failures: [],
      },
      failures: [],
    };
  }
  emitProgress({
    phase: "planning",
    completedOperations: totalOperations,
    totalOperations,
    currentCommandId: null,
    currentPageId: null,
  });
  if (dryRun.plan.failures.length > 0) {
    return {
      status: "failed",
      committed: false,
      pages: input.pages,
      plan: dryRun.plan,
      failures: dryRun.plan.failures,
    };
  }
  if (input.signal?.aborted) {
    return { status: "cancelled", committed: false, pages: input.pages, plan: dryRun.plan, failures: [] };
  }

  const pageIndexById = new Map(input.pages.map((page, index) => [page.id, index]));
  const workingPages = [...input.pages];
  const failures: StudioAutoActionFailure[] = [];
  const failedPageIds = new Set<string>();
  let operationsSinceYield = 0;
  let completedOperations = 0;
  const yieldControl = input.yieldControl ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

  emitProgress({
    phase: "executing",
    completedOperations,
    totalOperations,
    currentCommandId: null,
    currentPageId: null,
  });

  try {
    for (const command of prepared.actionSet.commands) {
      if (!command.enabled) continue;
      for (const pageId of prepared.targetPageIds) {
        if (input.signal?.aborted) throw new StudioAutoActionCancelledError();
        if (failedPageIds.has(pageId)) continue;
        const pageIndex = pageIndexById.get(pageId);
        if (pageIndex === undefined) continue;
        try {
          workingPages[pageIndex] = applyCommandToPage(
            workingPages[pageIndex]!,
            command,
            input.signal
          ).page;
        } catch (error) {
          if (error instanceof StudioAutoActionCancelledError) throw error;
          const failure = error instanceof StudioAutoActionPageTransformError
            ? error.failure
            : {
                pageId,
                commandId: command.id,
                code: "command_failed" as const,
                message: `${pageId}에서 명령을 실행하지 못했습니다.`,
              };
          failures.push(failure);
          failedPageIds.add(pageId);
        }
        operationsSinceYield += 1;
        completedOperations += 1;
        if (operationsSinceYield >= 32) {
          operationsSinceYield = 0;
          emitProgress({
            phase: "executing",
            completedOperations,
            totalOperations,
            currentCommandId: command.id,
            currentPageId: pageId,
          });
          await yieldControl();
          if (input.signal?.aborted) throw new StudioAutoActionCancelledError();
        }
      }
    }
  } catch (error) {
    if (error instanceof StudioAutoActionCancelledError) {
      return { status: "cancelled", committed: false, pages: input.pages, plan: dryRun.plan, failures: [] };
    }
    throw error;
  }

  if (failures.length > 0) {
    return { status: "failed", committed: false, pages: input.pages, plan: dryRun.plan, failures };
  }
  emitProgress({
    phase: "executing",
    completedOperations: totalOperations,
    totalOperations,
    currentCommandId: null,
    currentPageId: null,
  });
  return { status: "succeeded", committed: true, pages: workingPages, plan: dryRun.plan, failures: [] };
}
