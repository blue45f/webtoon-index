import { elBounds } from "./studio-element-geometry";

import type { El } from "./studio-element-model";

export type StudioBatchRenameMode = "template" | "replace";
export type StudioBatchRenameOrder =
  | "layer-top"
  | "layer-bottom"
  | "canvas-top"
  | "canvas-left";

export interface StudioBatchRenameRequest {
  readonly mode: StudioBatchRenameMode;
  /** `{n}`, `{name}`, `{type}` are replaced for every selected element. */
  readonly template?: string;
  readonly search?: string;
  readonly replacement?: string;
  readonly caseSensitive?: boolean;
  readonly start?: number;
  readonly step?: number;
  readonly digits?: number;
  readonly order?: StudioBatchRenameOrder;
}

export interface StudioBatchRenamePreview {
  readonly id: string;
  readonly currentName: string;
  readonly nextName: string;
  readonly sequence: number;
}

export type StudioBatchRenamePlan =
  | {
      readonly kind: "invalid";
      readonly reason: string;
      readonly previews: readonly StudioBatchRenamePreview[];
    }
  | {
      readonly kind: "unchanged";
      readonly reason: string;
      readonly previews: readonly StudioBatchRenamePreview[];
    }
  | {
      readonly kind: "changed";
      readonly next: El[];
      readonly previews: readonly StudioBatchRenamePreview[];
      readonly duplicateNames: readonly string[];
      readonly announcement: string;
    };

export interface StudioBatchRenameOptions {
  readonly isLocked?: (element: El) => boolean;
}

const MAX_LAYER_NAME_LENGTH = 160;
const NEVER_LOCKED = () => false;

const TYPE_LABELS: Readonly<Record<El["type"], string>> = Object.freeze({
  image: "이미지",
  text: "텍스트",
  bubble: "말풍선",
  sticker: "스티커",
  draw: "선화",
  frame: "프레임",
  focusLines: "집중선",
  speedLines: "스피드라인",
});

function currentLayerName(element: El): string {
  const explicit = element.name?.trim();
  return explicit ? explicit : TYPE_LABELS[element.type];
}

function clampDigits(value: number | undefined): number {
  if (!Number.isFinite(value)) return 2;
  return Math.min(6, Math.max(1, Math.trunc(value!)));
}

function finiteInteger(value: number | undefined, fallback: number): number | null {
  if (value === undefined) return fallback;
  return Number.isSafeInteger(value) ? value : null;
}

function sanitizeLayerName(value: string): string {
  return value.trim().slice(0, MAX_LAYER_NAME_LENGTH);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function replaceAllText(
  source: string,
  search: string,
  replacement: string,
  caseSensitive: boolean,
): string {
  if (caseSensitive) return source.split(search).join(replacement);
  return source.replace(new RegExp(escapeRegExp(search), "giu"), () => replacement);
}

function orderTargets(
  targets: readonly El[],
  elements: readonly El[],
  order: StudioBatchRenameOrder,
): El[] {
  const zIndex = new Map(elements.map((element, index) => [element.id, index] as const));
  const stableIndex = (element: El) => zIndex.get(element.id) ?? Number.MAX_SAFE_INTEGER;
  return [...targets].sort((a, b) => {
    if (order === "layer-top") return stableIndex(b) - stableIndex(a);
    if (order === "layer-bottom") return stableIndex(a) - stableIndex(b);
    const aBounds = elBounds(a);
    const bBounds = elBounds(b);
    if (order === "canvas-top") {
      return aBounds.y - bBounds.y || aBounds.x - bBounds.x || stableIndex(a) - stableIndex(b);
    }
    return aBounds.x - bBounds.x || aBounds.y - bBounds.y || stableIndex(a) - stableIndex(b);
  });
}

function formatSequence(sequence: number, digits: number): string {
  const sign = sequence < 0 ? "-" : "";
  return `${sign}${String(Math.abs(sequence)).padStart(digits, "0")}`;
}

function renderTemplate(
  template: string,
  element: El,
  currentName: string,
  sequence: number,
  digits: number,
): string {
  const number = formatSequence(sequence, digits);
  // Substitute template tokens once. Existing names are literal data, even
  // when they contain another token (or replacement metacharacters).
  return template.replace(/\{(n|name|type)\}/gu, (_match, token: string) => {
    if (token === "n") return number;
    if (token === "name") return currentName;
    return TYPE_LABELS[element.type];
  });
}

function duplicateResultNames(elements: readonly El[], changedIds: ReadonlySet<string>): string[] {
  const counts = new Map<string, { display: string; count: number }>();
  const changedNameKeys = new Set<string>();
  for (const element of elements) {
    const display = currentLayerName(element);
    const key = display.toLocaleLowerCase("ko-KR");
    const current = counts.get(key);
    counts.set(key, current ? { display: current.display, count: current.count + 1 } : { display, count: 1 });
    if (changedIds.has(element.id)) changedNameKeys.add(key);
  }
  return [...counts.entries()]
    .filter(([key, entry]) => changedNameKeys.has(key) && entry.count > 1)
    .map(([, entry]) => entry.display)
    .sort((a, b) => a.localeCompare(b, "ko-KR"));
}

/**
 * Plans one atomic multi-layer rename. No selected member may silently disappear, remain locked,
 * or receive an empty name; outside elements retain their object identity so CRDT diffs stay small.
 */
export function planStudioBatchRename(
  elements: readonly El[],
  selectedIds: readonly string[],
  request: StudioBatchRenameRequest,
  options: StudioBatchRenameOptions = {},
): StudioBatchRenamePlan {
  const uniqueIds = [...new Set(selectedIds)];
  if (uniqueIds.length < 2) {
    return { kind: "invalid", reason: "레이어를 2개 이상 선택해 주세요.", previews: [] };
  }
  const selectedSet = new Set(uniqueIds);
  const targets = elements.filter((element) => selectedSet.has(element.id));
  if (targets.length !== uniqueIds.length) {
    return {
      kind: "invalid",
      reason: "선택 정보가 바뀌었어요. 현재 레이어를 다시 선택한 뒤 적용해 주세요.",
      previews: [],
    };
  }
  const isLocked = options.isLocked ?? NEVER_LOCKED;
  if (targets.some(isLocked)) {
    return {
      kind: "invalid",
      reason: "잠긴 레이어가 포함되어 있어 이름을 일부만 바꾸지 않았어요.",
      previews: [],
    };
  }

  const order = request.order ?? "layer-top";
  const ordered = orderTargets(targets, elements, order);
  const start = finiteInteger(request.start, 1);
  const step = finiteInteger(request.step, 1);
  if (start === null || step === null || step === 0) {
    return {
      kind: "invalid",
      reason: "시작 번호와 증가값은 유효한 정수로 입력해 주세요. 증가값은 0일 수 없어요.",
      previews: [],
    };
  }
  // Increment within the safe integer range rather than multiplying a large
  // index first: an intermediate product can lose precision before subtraction.
  const sequences: number[] = [];
  for (let index = 0, value = start; index < ordered.length; index += 1, value += step) {
    if (!Number.isSafeInteger(value)) {
      return { kind: "invalid", reason: "번호가 안전한 정수 범위를 넘어 적용하지 않았어요.", previews: [] };
    }
    sequences.push(value);
  }
  const digits = clampDigits(request.digits);
  const renameById = new Map<string, string>();
  const previews: StudioBatchRenamePreview[] = [];

  if (request.mode === "template") {
    const template = request.template ?? "";
    if (!template.trim()) {
      return { kind: "invalid", reason: "이름 형식을 입력해 주세요.", previews: [] };
    }
    ordered.forEach((element, index) => {
      const currentName = currentLayerName(element);
      const sequence = sequences[index]!;
      const nextName = sanitizeLayerName(
        renderTemplate(template, element, currentName, sequence, digits),
      );
      renameById.set(element.id, nextName);
      previews.push({ id: element.id, currentName, nextName, sequence });
    });
  } else {
    const search = request.search ?? "";
    if (!search) {
      return { kind: "invalid", reason: "찾을 문자열을 입력해 주세요.", previews: [] };
    }
    ordered.forEach((element, index) => {
      const currentName = currentLayerName(element);
      const sequence = sequences[index]!;
      const nextName = sanitizeLayerName(
        replaceAllText(
          currentName,
          search,
          request.replacement ?? "",
          request.caseSensitive === true,
        ),
      );
      renameById.set(element.id, nextName);
      previews.push({ id: element.id, currentName, nextName, sequence });
    });
  }

  if (previews.some((preview) => preview.nextName.length === 0)) {
    return {
      kind: "invalid",
      reason: "빈 레이어 이름이 만들어져 적용하지 않았어요. 형식이나 치환값을 확인해 주세요.",
      previews,
    };
  }

  const changedIds = new Set(
    previews
      .filter((preview) => preview.currentName !== preview.nextName)
      .map((preview) => preview.id),
  );
  if (changedIds.size === 0) {
    return {
      kind: "unchanged",
      reason:
        request.mode === "replace"
          ? "선택한 레이어 이름에서 찾을 문자열이 발견되지 않았어요."
          : "미리보기와 현재 이름이 같아 변경할 내용이 없어요.",
      previews,
    };
  }

  const next = elements.map((element) => {
    if (!changedIds.has(element.id)) return element;
    return { ...element, name: renameById.get(element.id)! } as El;
  });
  const duplicateNames = duplicateResultNames(next, changedIds);
  return {
    kind: "changed",
    next,
    previews,
    duplicateNames,
    announcement: `${changedIds.size}개 레이어 이름 변경`,
  };
}
