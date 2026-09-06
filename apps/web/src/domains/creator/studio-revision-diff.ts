import {
  canonicalStudioRevisionDocumentExtensions,
  STUDIO_REVISION_DOCUMENT_EXTENSIONS_FIELD,
} from "./studio-revision-document-extensions";

import type { StudioProjectFile } from "./studio-project-file";

/**
 * Stable, UI-facing semantic change categories. The order is also the canonical sort order used
 * by the diff result, so callers never need to rely on object insertion order or locale collation.
 */
export const STUDIO_REVISION_CHANGE_KINDS = [
  "document-metadata-changed",
  "document-content-changed",
  "document-review-changed",
  "publication-metadata-changed",
  "document-extension-changed",
  "page-added",
  "page-removed",
  "page-order-changed",
  "page-resized",
  "page-style-changed",
  "page-groups-changed",
  "page-animation-changed",
  "page-metadata-changed",
  "page-properties-changed",
  "element-added",
  "element-removed",
  "element-reparented",
  "element-order-changed",
  "element-type-changed",
  "element-moved",
  "element-resized",
  "element-rotated",
  "element-geometry-changed",
  "element-text-changed",
  "element-source-changed",
  "element-group-changed",
  "element-style-changed",
  "element-metadata-changed",
] as const;

export type StudioRevisionChangeKind = (typeof STUDIO_REVISION_CHANGE_KINDS)[number];
export type StudioRevisionChangeScope = "document" | "page" | "element";
export type StudioRevisionDiffSide = "before" | "after";

/** Maximum number of sorted detail descriptors retained for one comparison. */
export const STUDIO_REVISION_CHANGE_DETAIL_LIMIT = 240;
/** Maximum number of field names copied into one descriptor. Exact totals stay in `fieldCount`. */
export const STUDIO_REVISION_CHANGE_FIELD_LIMIT = 32;
/** Keeps corrupt/extension identifiers from becoming an unbounded UI or Worker payload. */
export const STUDIO_REVISION_DESCRIPTOR_STRING_LIMIT = 240;

export type StudioRevisionNumericSnapshot = Readonly<Record<string, number | null>>;

/**
 * A deliberately compact change descriptor. It never copies text, data URLs, 3D documents, or
 * other potentially large values into the result; the revision viewer can resolve those values
 * from the two snapshots by stable page/element ID when it needs a detailed inspection.
 */
export interface StudioRevisionChange {
  kind: StudioRevisionChangeKind;
  scope: StudioRevisionChangeScope;
  pageId?: string;
  previousPageId?: string;
  elementId?: string;
  elementType?: string;
  previousElementType?: string;
  field?: string;
  fields?: readonly string[];
  fieldCount?: number;
  beforeIndex?: number;
  afterIndex?: number;
  before?: StudioRevisionNumericSnapshot;
  after?: StudioRevisionNumericSnapshot;
  beforePageIds?: readonly string[];
  afterPageIds?: readonly string[];
  elementCount?: number;
  commonElementCount?: number;
  firstChangedElementId?: string;
}

export interface StudioRevisionDiff {
  hasChanges: boolean;
  totalChanges: number;
  truncated: boolean;
  summary: Readonly<Record<StudioRevisionChangeKind, number>>;
  changes: readonly StudioRevisionChange[];
}

interface StudioRevisionChangeSink {
  push(...changes: StudioRevisionChange[]): number;
}

export type StudioRevisionDiffErrorCode =
  | "DUPLICATE_PAGE_ID"
  | "INVALID_ELEMENT_ID"
  | "DUPLICATE_ELEMENT_ID"
  | "STABLE_ID_TOO_LONG";

export class StudioRevisionDiffError extends Error {
  readonly code: StudioRevisionDiffErrorCode;
  readonly side: StudioRevisionDiffSide;
  readonly stableId?: string;
  readonly pageId?: string;

  constructor(options: {
    code: StudioRevisionDiffErrorCode;
    message: string;
    side: StudioRevisionDiffSide;
    stableId?: string;
    pageId?: string;
  }) {
    super(options.message);
    this.name = "StudioRevisionDiffError";
    this.code = options.code;
    this.side = options.side;
    this.stableId = options.stableId;
    this.pageId = options.pageId;
  }
}

type UnknownRecord = Record<string, unknown>;

interface IndexedElement {
  id: string;
  pageId: string;
  index: number;
  record: UnknownRecord;
}

interface IndexedPage {
  id: string;
  index: number;
  record: UnknownRecord;
  elements: IndexedElement[];
}

interface ProjectIndex {
  project: Readonly<StudioProjectFile>;
  record: UnknownRecord;
  pages: IndexedPage[];
  pagesById: Map<string, IndexedPage>;
  elementsById: Map<string, IndexedElement>;
  canvasWidth: number;
}

const DEFAULT_CANVAS_WIDTH = 720;

const IGNORED_DOCUMENT_FIELDS = new Set([
  STUDIO_REVISION_DOCUMENT_EXTENSIONS_FIELD,
  "currentPageId",
  "pagesList",
  "savedAt",
  "version",
  // Width is projected into each surviving page's semantic size below.
  "width",
]);

const DOCUMENT_METADATA_FIELDS = new Set([
  "description",
  "panelGutter",
  "tagsText",
  "title",
  "webtoonTheme",
]);

const DOCUMENT_CONTENT_FIELDS = new Set([
  "aiProvenance",
  "characterBible",
  "master",
  "writerRoom",
]);

const DOCUMENT_REVIEW_FIELDS = new Set(["comments"]);

const PUBLICATION_METADATA_FIELDS = new Set([
  "challengeId",
  "episodeNo",
  "format",
  "linkedChallengeId",
  "linkedSeriesId",
  "linkedTitleId",
  "publicationAnalytics",
  "publishPack",
  "releaseSchedule",
  "remixFromId",
  "seriesId",
  "status",
  "titleId",
]);

const PAGE_SIZE_FIELDS = new Set(["canvasH", "canvasW", "height", "width"]);
const PAGE_STYLE_FIELDS = new Set(["bg", "bgGrad", "grade"]);
const PAGE_GROUP_FIELDS = new Set(["groups"]);
const PAGE_ANIMATION_FIELDS = new Set(["animTimeline"]);
const PAGE_METADATA_FIELDS = new Set([
  "cameraAngle",
  "dialogueI18n",
  "hideMaster",
  "name",
  "note",
  "review",
  "shotType",
]);

const ELEMENT_MOVE_FIELDS = new Set(["x", "y"]);
const ELEMENT_RESIZE_FIELDS = new Set(["height", "width"]);
const ELEMENT_ROTATION_FIELDS = new Set(["rotation"]);
const ELEMENT_GEOMETRY_FIELDS = new Set(["points", "pressures", "tiltXs", "tiltYs", "twists"]);
const ELEMENT_TEXT_FIELDS = new Set(["text"]);
const ELEMENT_SOURCE_FIELDS = new Set([
  "activeFrameId",
  "bg",
  "bg3dLtBundleId",
  "bg3dLtRenderMode",
  "bg3dLtRole",
  "bg3dScene",
  "builtinRasterAssetId",
  "frames",
  "isAnimatedGif",
  "maskSrc",
  "src",
]);
const ELEMENT_GROUP_FIELDS = new Set(["groupId"]);
const ELEMENT_METADATA_FIELDS = new Set([
  "aiProvenance",
  "alphaLocked",
  "clipBelow",
  "communityAssetCredit",
  "emeresSourceId",
  "fillReference",
  "hidden",
  "layerColor",
  "layerRole",
  "lockAspect",
  "locked",
  "name",
  "noClip",
  "stockImageCredit",
  "storyBeat",
]);

const ELEMENT_FALSE_DEFAULT_FIELDS = new Set([
  "alphaLocked",
  "clipBelow",
  "fillReference",
  "flipped",
  "flippedY",
  "grayscale",
  "hidden",
  "invert",
  "isAnimatedGif",
  "lineart",
  "lockAspect",
  "locked",
  "maskEnabled",
  "noClip",
  "screentone",
  "sepia",
  "vertical",
]);

const ELEMENT_ZERO_DEFAULT_FIELDS = new Set(["rotation", "skewX", "skewY"]);

const KIND_ORDER = new Map<StudioRevisionChangeKind, number>(
  STUDIO_REVISION_CHANGE_KINDS.map((kind, index) => [kind, index])
);

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function boundedDescriptorString(value: string): string {
  return value.slice(0, STUDIO_REVISION_DESCRIPTOR_STRING_LIMIT);
}

function boundedFieldNames(fields: readonly string[]): readonly string[] {
  return fields
    .slice(0, STUDIO_REVISION_CHANGE_FIELD_LIMIT)
    .map(boundedDescriptorString);
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function meaningfulObjectKeys(value: UnknownRecord): string[] {
  return Object.keys(value).filter((key) => value[key] !== undefined);
}

/** Deep JSON-like equality without serialization, with pair memoization for shared subtrees. */
class SemanticComparator {
  private readonly memo = new WeakMap<object, WeakMap<object, boolean>>();
  private readonly active = new WeakMap<object, WeakSet<object>>();

  equal(left: unknown, right: unknown): boolean {
    if (left === right) return true;
    if (typeof left === "number" && typeof right === "number") {
      return Number.isNaN(left) && Number.isNaN(right);
    }
    if (
      left === null
      || right === null
      || typeof left !== "object"
      || typeof right !== "object"
    ) return false;

    const memoForLeft = this.memo.get(left);
    if (memoForLeft?.has(right)) return memoForLeft.get(right) ?? false;

    let activeForLeft = this.active.get(left);
    if (!activeForLeft) {
      activeForLeft = new WeakSet<object>();
      this.active.set(left, activeForLeft);
    }
    // StudioProjectFile is JSON-shaped and acyclic. This guard also keeps an accidental cyclic
    // extension from overflowing the stack while preserving pair-wise graph comparison.
    if (activeForLeft.has(right)) return true;
    activeForLeft.add(right);

    let result: boolean;
    if (Array.isArray(left) || Array.isArray(right)) {
      result = Array.isArray(left)
        && Array.isArray(right)
        && left.length === right.length
        && left.every((item, index) => this.equal(item, right[index]));
    } else if (left instanceof Date || right instanceof Date) {
      result = left instanceof Date
        && right instanceof Date
        && left.getTime() === right.getTime();
    } else {
      const leftRecord = left as UnknownRecord;
      const rightRecord = right as UnknownRecord;
      const leftKeys = meaningfulObjectKeys(leftRecord);
      const rightKeys = meaningfulObjectKeys(rightRecord);
      result = leftKeys.length === rightKeys.length
        && leftKeys.every(
          (key) => Object.hasOwn(rightRecord, key) && this.equal(leftRecord[key], rightRecord[key])
        );
    }

    activeForLeft.delete(right);
    let resultMap = this.memo.get(left);
    if (!resultMap) {
      resultMap = new WeakMap<object, boolean>();
      this.memo.set(left, resultMap);
    }
    resultMap.set(right, result);
    return result;
  }
}

function positiveFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function indexProject(
  project: Readonly<StudioProjectFile>,
  side: StudioRevisionDiffSide
): ProjectIndex {
  const record = project as unknown as UnknownRecord;
  const pages: IndexedPage[] = [];
  const pagesById = new Map<string, IndexedPage>();
  const elementsById = new Map<string, IndexedElement>();

  project.pagesList.forEach((page, pageIndex) => {
    const pageRecord = page as unknown as UnknownRecord;
    const pageId = page.id;
    if (pageId.length > STUDIO_REVISION_DESCRIPTOR_STRING_LIMIT) {
      throw new StudioRevisionDiffError({
        code: "STABLE_ID_TOO_LONG",
        message: `${side} revision contains an overlong stable ID`,
        side,
        stableId: boundedDescriptorString(pageId),
      });
    }
    if (pagesById.has(pageId)) {
      throw new StudioRevisionDiffError({
        code: "DUPLICATE_PAGE_ID",
        message: `${side} revision contains a duplicate page ID`,
        side,
        stableId: pageId,
        pageId,
      });
    }

    const indexedPage: IndexedPage = {
      id: pageId,
      index: pageIndex,
      record: pageRecord,
      elements: [],
    };
    pages.push(indexedPage);
    pagesById.set(pageId, indexedPage);

    page.elements.forEach((element, elementIndex) => {
      if (!isRecord(element) || typeof element.id !== "string" || element.id.length === 0) {
        throw new StudioRevisionDiffError({
          code: "INVALID_ELEMENT_ID",
          message: `${side} revision contains an element without a stable ID`,
          side,
          pageId,
        });
      }
      if (element.id.length > STUDIO_REVISION_DESCRIPTOR_STRING_LIMIT) {
        throw new StudioRevisionDiffError({
          code: "STABLE_ID_TOO_LONG",
          message: `${side} revision contains an overlong stable ID`,
          side,
          stableId: boundedDescriptorString(element.id),
          pageId,
        });
      }
      if (elementsById.has(element.id)) {
        throw new StudioRevisionDiffError({
          code: "DUPLICATE_ELEMENT_ID",
          message: `${side} revision contains a duplicate element ID`,
          side,
          stableId: element.id,
          pageId,
        });
      }
      const indexedElement: IndexedElement = {
        id: element.id,
        pageId,
        index: elementIndex,
        record: element,
      };
      indexedPage.elements.push(indexedElement);
      elementsById.set(element.id, indexedElement);
    });
  });

  return {
    project,
    record,
    pages,
    pagesById,
    elementsById,
    canvasWidth: positiveFiniteNumber(record.width, DEFAULT_CANVAS_WIDTH),
  };
}

function allFieldNames(left: UnknownRecord, right: UnknownRecord): string[] {
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort(compareStrings);
}

function normalizedElementField(record: UnknownRecord, field: string): unknown {
  const value = record[field];
  if (value !== undefined) {
    if (field === "groupId" && (value === "" || value === null)) return undefined;
    return value;
  }
  if (ELEMENT_FALSE_DEFAULT_FIELDS.has(field)) return false;
  if (ELEMENT_ZERO_DEFAULT_FIELDS.has(field)) return 0;
  if (field === "opacity") return 1;
  return undefined;
}

function normalizedPageField(record: UnknownRecord, field: string): unknown {
  const value = record[field];
  if (value !== undefined) return value;
  if (field === "groups") return [];
  if (field === "hideMaster") return false;
  if (field === "name" || field === "note") return "";
  return undefined;
}

function changedFields(
  left: UnknownRecord,
  right: UnknownRecord,
  comparator: SemanticComparator,
  normalize: (record: UnknownRecord, field: string) => unknown,
  ignored: ReadonlySet<string>
): string[] {
  return allFieldNames(left, right).filter(
    (field) => !ignored.has(field) && !comparator.equal(normalize(left, field), normalize(right, field))
  );
}

function fieldsIn(changed: readonly string[], category: ReadonlySet<string>): string[] {
  return changed.filter((field) => category.has(field));
}

function fieldsOutside(changed: readonly string[], categories: readonly ReadonlySet<string>[]): string[] {
  return changed.filter((field) => !categories.some((category) => category.has(field)));
}

function elementType(record: UnknownRecord): string {
  return typeof record.type === "string" && record.type.length > 0
    ? boundedDescriptorString(record.type)
    : "unknown";
}

function numericSnapshot(record: UnknownRecord, fields: readonly string[]): StudioRevisionNumericSnapshot {
  return Object.fromEntries(fields.map((field) => [
    field,
    typeof record[field] === "number" && Number.isFinite(record[field]) ? record[field] : null,
  ]));
}

function pageSize(index: ProjectIndex, page: IndexedPage): StudioRevisionNumericSnapshot {
  return {
    canvasWidth: positiveFiniteNumber(
      page.record.canvasW,
      positiveFiniteNumber(page.record.width, index.canvasWidth)
    ),
    canvasHeight: positiveFiniteNumber(
      page.record.canvasH,
      positiveFiniteNumber(page.record.height, 1)
    ),
  };
}

function addCategorizedChange(
  changes: StudioRevisionChangeSink,
  kind: StudioRevisionChangeKind,
  scope: StudioRevisionChangeScope,
  fields: readonly string[],
  identity: Pick<StudioRevisionChange, "pageId" | "previousPageId" | "elementId" | "elementType">
): void {
  if (fields.length === 0) return;
  changes.push({
    kind,
    scope,
    ...identity,
    fields: boundedFieldNames(fields),
    fieldCount: fields.length,
  });
}

function compareDocumentFields(
  before: ProjectIndex,
  after: ProjectIndex,
  comparator: SemanticComparator,
  changes: StudioRevisionChangeSink
): void {
  for (const field of allFieldNames(before.record, after.record)) {
    if (IGNORED_DOCUMENT_FIELDS.has(field)) continue;
    if (comparator.equal(before.record[field], after.record[field])) continue;

    let kind: StudioRevisionChangeKind = "document-extension-changed";
    if (DOCUMENT_METADATA_FIELDS.has(field)) kind = "document-metadata-changed";
    else if (DOCUMENT_CONTENT_FIELDS.has(field)) kind = "document-content-changed";
    else if (DOCUMENT_REVIEW_FIELDS.has(field)) kind = "document-review-changed";
    else if (PUBLICATION_METADATA_FIELDS.has(field)) kind = "publication-metadata-changed";
    changes.push({ kind, scope: "document", field: boundedDescriptorString(field) });
  }
}

function compareDocumentExtensions(
  before: ProjectIndex,
  after: ProjectIndex,
  comparator: SemanticComparator,
  changes: StudioRevisionChangeSink
): void {
  const beforeExtensions = new Map(
    canonicalStudioRevisionDocumentExtensions(
      before.record[STUDIO_REVISION_DOCUMENT_EXTENSIONS_FIELD]
    )
  );
  const afterExtensions = new Map(
    canonicalStudioRevisionDocumentExtensions(
      after.record[STUDIO_REVISION_DOCUMENT_EXTENSIONS_FIELD]
    )
  );
  const extensionKeys = [...new Set([
    ...beforeExtensions.keys(),
    ...afterExtensions.keys(),
  ])].sort(compareStrings);

  for (const field of extensionKeys) {
    if (comparator.equal(beforeExtensions.get(field), afterExtensions.get(field))) continue;
    changes.push({
      kind: "document-extension-changed",
      scope: "document",
      field: boundedDescriptorString(field),
    });
  }
}

function comparePages(
  before: ProjectIndex,
  after: ProjectIndex,
  comparator: SemanticComparator,
  changes: StudioRevisionChangeSink
): Set<string> {
  const commonPageIds = new Set<string>();

  for (const page of before.pages) {
    if (after.pagesById.has(page.id)) commonPageIds.add(page.id);
    else {
      changes.push({
        kind: "page-removed",
        scope: "page",
        pageId: page.id,
        beforeIndex: page.index,
        elementCount: page.elements.length,
      });
    }
  }
  for (const page of after.pages) {
    if (!before.pagesById.has(page.id)) {
      changes.push({
        kind: "page-added",
        scope: "page",
        pageId: page.id,
        afterIndex: page.index,
        elementCount: page.elements.length,
      });
    }
  }

  const beforeCommonOrder = before.pages.filter((page) => commonPageIds.has(page.id)).map((page) => page.id);
  const afterCommonOrder = after.pages.filter((page) => commonPageIds.has(page.id)).map((page) => page.id);
  if (!comparator.equal(beforeCommonOrder, afterCommonOrder)) {
    changes.push({
      kind: "page-order-changed",
      scope: "page",
      beforePageIds: beforeCommonOrder,
      afterPageIds: afterCommonOrder,
    });
  }

  const pageCategories = [
    PAGE_SIZE_FIELDS,
    PAGE_STYLE_FIELDS,
    PAGE_GROUP_FIELDS,
    PAGE_ANIMATION_FIELDS,
    PAGE_METADATA_FIELDS,
  ];

  for (const pageId of [...commonPageIds].sort(compareStrings)) {
    const beforePage = before.pagesById.get(pageId)!;
    const afterPage = after.pagesById.get(pageId)!;
    const beforeSize = pageSize(before, beforePage);
    const afterSize = pageSize(after, afterPage);
    if (!comparator.equal(beforeSize, afterSize)) {
      const sizeFields = Object.keys(beforeSize).filter(
        (field) => !comparator.equal(beforeSize[field], afterSize[field])
      );
      changes.push({
        kind: "page-resized",
        scope: "page",
        pageId,
        fields: sizeFields,
        before: beforeSize,
        after: afterSize,
      });
    }

    const changed = changedFields(
      beforePage.record,
      afterPage.record,
      comparator,
      normalizedPageField,
      new Set(["canvasH", "canvasW", "elements", "height", "id", "width"])
    );
    addCategorizedChange(changes, "page-style-changed", "page", fieldsIn(changed, PAGE_STYLE_FIELDS), { pageId });
    addCategorizedChange(changes, "page-groups-changed", "page", fieldsIn(changed, PAGE_GROUP_FIELDS), { pageId });
    addCategorizedChange(changes, "page-animation-changed", "page", fieldsIn(changed, PAGE_ANIMATION_FIELDS), { pageId });
    addCategorizedChange(changes, "page-metadata-changed", "page", fieldsIn(changed, PAGE_METADATA_FIELDS), { pageId });
    addCategorizedChange(
      changes,
      "page-properties-changed",
      "page",
      fieldsOutside(changed, pageCategories),
      { pageId }
    );
  }
  return commonPageIds;
}

function compareElementProperties(
  before: IndexedElement,
  after: IndexedElement,
  comparator: SemanticComparator,
  changes: StudioRevisionChangeSink
): void {
  const pageId = after.pageId;
  const identity = {
    pageId,
    previousPageId: before.pageId === after.pageId ? undefined : before.pageId,
    elementId: after.id,
    elementType: elementType(after.record),
  };
  const changed = changedFields(
    before.record,
    after.record,
    comparator,
    normalizedElementField,
    new Set(["id"])
  );

  const typeFields = fieldsIn(changed, new Set(["type"]));
  if (typeFields.length > 0) {
    changes.push({
      kind: "element-type-changed",
      scope: "element",
      ...identity,
      previousElementType: elementType(before.record),
      fields: typeFields,
    });
  }

  const moveFields = fieldsIn(changed, ELEMENT_MOVE_FIELDS);
  if (moveFields.length > 0) {
    changes.push({
      kind: "element-moved",
      scope: "element",
      ...identity,
      fields: moveFields,
      before: numericSnapshot(before.record, moveFields),
      after: numericSnapshot(after.record, moveFields),
    });
  }
  const resizeFields = fieldsIn(changed, ELEMENT_RESIZE_FIELDS);
  if (resizeFields.length > 0) {
    changes.push({
      kind: "element-resized",
      scope: "element",
      ...identity,
      fields: resizeFields,
      before: numericSnapshot(before.record, resizeFields),
      after: numericSnapshot(after.record, resizeFields),
    });
  }
  const rotationFields = fieldsIn(changed, ELEMENT_ROTATION_FIELDS);
  if (rotationFields.length > 0) {
    changes.push({
      kind: "element-rotated",
      scope: "element",
      ...identity,
      fields: rotationFields,
      before: numericSnapshot(before.record, rotationFields),
      after: numericSnapshot(after.record, rotationFields),
    });
  }

  addCategorizedChange(changes, "element-geometry-changed", "element", fieldsIn(changed, ELEMENT_GEOMETRY_FIELDS), identity);
  addCategorizedChange(changes, "element-text-changed", "element", fieldsIn(changed, ELEMENT_TEXT_FIELDS), identity);
  addCategorizedChange(changes, "element-source-changed", "element", fieldsIn(changed, ELEMENT_SOURCE_FIELDS), identity);
  addCategorizedChange(changes, "element-group-changed", "element", fieldsIn(changed, ELEMENT_GROUP_FIELDS), identity);
  addCategorizedChange(changes, "element-metadata-changed", "element", fieldsIn(changed, ELEMENT_METADATA_FIELDS), identity);

  const categorized = [
    new Set(["type"]),
    ELEMENT_MOVE_FIELDS,
    ELEMENT_RESIZE_FIELDS,
    ELEMENT_ROTATION_FIELDS,
    ELEMENT_GEOMETRY_FIELDS,
    ELEMENT_TEXT_FIELDS,
    ELEMENT_SOURCE_FIELDS,
    ELEMENT_GROUP_FIELDS,
    ELEMENT_METADATA_FIELDS,
  ];
  addCategorizedChange(
    changes,
    "element-style-changed",
    "element",
    fieldsOutside(changed, categorized),
    identity
  );
}

function compareElementOrder(
  before: ProjectIndex,
  after: ProjectIndex,
  commonPageIds: ReadonlySet<string>,
  changes: StudioRevisionChangeSink
): void {
  for (const pageId of [...commonPageIds].sort(compareStrings)) {
    const beforePage = before.pagesById.get(pageId)!;
    const afterPage = after.pagesById.get(pageId)!;
    const beforeOrder = beforePage.elements
      .filter((element) => after.elementsById.get(element.id)?.pageId === pageId)
      .map((element) => element.id);
    const afterOrder = afterPage.elements
      .filter((element) => before.elementsById.get(element.id)?.pageId === pageId)
      .map((element) => element.id);
    if (beforeOrder.length !== afterOrder.length) continue;
    const firstMismatch = beforeOrder.findIndex((id, index) => id !== afterOrder[index]);
    if (firstMismatch < 0) continue;
    changes.push({
      kind: "element-order-changed",
      scope: "element",
      pageId,
      commonElementCount: beforeOrder.length,
      firstChangedElementId: afterOrder[firstMismatch],
    });
  }
}

function compareElements(
  before: ProjectIndex,
  after: ProjectIndex,
  commonPageIds: ReadonlySet<string>,
  comparator: SemanticComparator,
  changes: StudioRevisionChangeSink
): void {
  const compareElementId = (elementId: string) => {
    const rawBefore = before.elementsById.get(elementId);
    const rawAfter = after.elementsById.get(elementId);
    // A page add/remove summarizes its complete subtree. If an ID crosses that boundary, expose
    // the surviving side as an add/remove instead of silently hiding the transfer.
    const beforeElement = rawBefore && commonPageIds.has(rawBefore.pageId) ? rawBefore : undefined;
    const afterElement = rawAfter && commonPageIds.has(rawAfter.pageId) ? rawAfter : undefined;

    if (!beforeElement && !afterElement) return;
    if (!beforeElement && afterElement) {
      changes.push({
        kind: "element-added",
        scope: "element",
        pageId: afterElement.pageId,
        elementId,
        elementType: elementType(afterElement.record),
        afterIndex: afterElement.index,
      });
      return;
    }
    if (beforeElement && !afterElement) {
      changes.push({
        kind: "element-removed",
        scope: "element",
        pageId: beforeElement.pageId,
        elementId,
        elementType: elementType(beforeElement.record),
        beforeIndex: beforeElement.index,
      });
      return;
    }

    const stableBefore = beforeElement!;
    const stableAfter = afterElement!;
    if (stableBefore.pageId !== stableAfter.pageId) {
      changes.push({
        kind: "element-reparented",
        scope: "element",
        pageId: stableAfter.pageId,
        previousPageId: stableBefore.pageId,
        elementId,
        elementType: elementType(stableAfter.record),
        beforeIndex: stableBefore.index,
        afterIndex: stableAfter.index,
      });
    }
    compareElementProperties(stableBefore, stableAfter, comparator, changes);
  };

  // Avoid allocating and sorting a union containing up to two million IDs. The bounded collector
  // maintains canonical result order independently of traversal order.
  for (const elementId of before.elementsById.keys()) compareElementId(elementId);
  for (const elementId of after.elementsById.keys()) {
    if (!before.elementsById.has(elementId)) compareElementId(elementId);
  }

  compareElementOrder(before, after, commonPageIds, changes);
}

function compareChanges(left: StudioRevisionChange, right: StudioRevisionChange): number {
  const scopeOrder: Record<StudioRevisionChangeScope, number> = { document: 0, page: 1, element: 2 };
  return scopeOrder[left.scope] - scopeOrder[right.scope]
    || compareStrings(left.pageId ?? left.previousPageId ?? "", right.pageId ?? right.previousPageId ?? "")
    || compareStrings(left.elementId ?? "", right.elementId ?? "")
    || (KIND_ORDER.get(left.kind) ?? 0) - (KIND_ORDER.get(right.kind) ?? 0)
    || compareStrings(left.field ?? left.fields?.join("\u0000") ?? "", right.field ?? right.fields?.join("\u0000") ?? "")
    || (left.beforeIndex ?? -1) - (right.beforeIndex ?? -1)
    || (left.afterIndex ?? -1) - (right.afterIndex ?? -1)
    || compareStrings(left.firstChangedElementId ?? "", right.firstChangedElementId ?? "");
}

class BoundedStudioRevisionChangeCollector implements StudioRevisionChangeSink {
  private readonly details: StudioRevisionChange[] = [];
  private readonly counts = Object.fromEntries(
    STUDIO_REVISION_CHANGE_KINDS.map((kind) => [kind, 0])
  ) as Record<StudioRevisionChangeKind, number>;

  private count = 0;

  push(...changes: StudioRevisionChange[]): number {
    for (const change of changes) {
      this.count += 1;
      this.counts[change.kind] += 1;

      let low = 0;
      let high = this.details.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (compareChanges(this.details[middle], change) <= 0) low = middle + 1;
        else high = middle;
      }
      if (low < STUDIO_REVISION_CHANGE_DETAIL_LIMIT) {
        this.details.splice(low, 0, change);
        if (this.details.length > STUDIO_REVISION_CHANGE_DETAIL_LIMIT) this.details.pop();
      }
    }
    return this.count;
  }

  result(): StudioRevisionDiff {
    return {
      hasChanges: this.count > 0,
      totalChanges: this.count,
      truncated: this.count > this.details.length,
      summary: this.counts,
      changes: this.details,
    };
  }
}

/**
 * Computes an ID-stable, semantic Studio revision diff from already-normalized project models.
 * Runtime parsing belongs at the persistence boundary (`parseStudioProjectFile`), not here.
 * Complexity is linear in pages/elements plus the fields that actually need deep comparison;
 * this function intentionally never serializes either project.
 */
export function diffStudioProjectRevisions(
  beforeProject: Readonly<StudioProjectFile>,
  afterProject: Readonly<StudioProjectFile>
): StudioRevisionDiff {
  const before = indexProject(beforeProject, "before");
  const after = indexProject(afterProject, "after");
  const comparator = new SemanticComparator();
  const changes = new BoundedStudioRevisionChangeCollector();

  compareDocumentFields(before, after, comparator, changes);
  compareDocumentExtensions(before, after, comparator, changes);
  const commonPageIds = comparePages(before, after, comparator, changes);
  compareElements(before, after, commonPageIds, comparator, changes);
  return changes.result();
}
