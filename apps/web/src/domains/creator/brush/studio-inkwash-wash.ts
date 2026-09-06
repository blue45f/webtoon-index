/**
 * Shared InkWash wash — the document of record for `inkwash-pen` / `inkwash-water-brush`.
 *
 * Live overlay and committed `planStudioWetInkBrushReplay` deposit into the same field so a
 * water stroke can wash unfixed pen ink. Konva/DrawNode reconstruction uses the stroke journal.
 */

import {
  createStudioInkwashFluidSession,
  fixStudioInkwashFluid,
  readStudioInkwashFluidCell,
  resolveStudioInkwashFluidDisplay,
  stepStudioInkwashFluid,
  studioInkwashFluidDigest,
  studioInkwashFluidStepParams,
  type StudioInkwashFluidSession,
} from "./studio-inkwash-fluid";

import type { DrawEl } from "../studio-element-model";


export const STUDIO_INKWASH_WASH_KEY = "studio-inkwash-wash" as const;

export interface StudioInkwashWash {
  readonly key: string;
  readonly pageEpoch: string | number | null;
  readonly session: StudioInkwashFluidSession;
  /** Document-space origin of field cell (0, 0). */
  readonly originX: number;
  readonly originY: number;
  readonly fieldScale: number;
  readonly journal: readonly DrawEl[];
}

interface StudioInkwashWashRecord {
  key: string;
  pageEpoch: string | number | null;
  session: StudioInkwashFluidSession;
  originX: number;
  originY: number;
  fieldScale: number;
  journal: DrawEl[];
  applied: Map<string, string>;
  displayCache: { revision: number; upload: ReturnType<typeof resolveStudioInkwashFluidDisplay> } | null;
}

const washes = new Map<string, StudioInkwashWashRecord>();

function snapshot(record: StudioInkwashWashRecord): StudioInkwashWash {
  return {
    key: record.key,
    pageEpoch: record.pageEpoch,
    session: record.session,
    originX: record.originX,
    originY: record.originY,
    fieldScale: record.fieldScale,
    journal: record.journal,
  };
}

export function resetStudioInkwashWash(key: string = STUDIO_INKWASH_WASH_KEY): void {
  washes.delete(key);
}

export function getStudioInkwashWash(
  key: string = STUDIO_INKWASH_WASH_KEY,
): StudioInkwashWash | null {
  const record = washes.get(key);
  return record ? snapshot(record) : null;
}

export function studioInkwashStrokeSignature(element: DrawEl): string {
  const points = element.points.join(",");
  const pressures = (element.pressures ?? []).join(",");
  return `${element.id}\u001f${element.brush}\u001f${points}\u001f${pressures}`;
}

function copySession(
  source: StudioInkwashFluidSession,
  target: StudioInkwashFluidSession,
  offsetX: number,
  offsetY: number,
): void {
  const { fluid: src, fixed: srcFixed } = source;
  const { fluid: dst, fixed: dstFixed } = target;
  const dx = Math.round(offsetX);
  const dy = Math.round(offsetY);
  for (let y = 0; y < src.height; y += 1) {
    const ny = y + dy;
    if (ny < 0 || ny >= dst.height) continue;
    for (let x = 0; x < src.width; x += 1) {
      const nx = x + dx;
      if (nx < 0 || nx >= dst.width) continue;
      const from = y * src.width + x;
      const to = ny * dst.width + nx;
      dst.wet[to] = src.wet[from] ?? 0;
      const from4 = from * 4;
      const to4 = to * 4;
      dst.pigment[to4] = src.pigment[from4] ?? 0;
      dst.pigment[to4 + 1] = src.pigment[from4 + 1] ?? 0;
      dst.pigment[to4 + 2] = src.pigment[from4 + 2] ?? 0;
      dst.pigment[to4 + 3] = src.pigment[from4 + 3] ?? 0;
      dstFixed[to4] = srcFixed[from4] ?? 0;
      dstFixed[to4 + 1] = srcFixed[from4 + 1] ?? 0;
      dstFixed[to4 + 2] = srcFixed[from4 + 2] ?? 0;
      dstFixed[to4 + 3] = srcFixed[from4 + 3] ?? 0;
    }
  }
  target.simulationStep = source.simulationStep;
  target.revision = source.revision + 1;
}

export function ensureStudioInkwashWash(input: Readonly<{
  key?: string;
  pageEpoch?: string | number | null;
  originX: number;
  originY: number;
  width: number;
  height: number;
  fieldScale: number;
}>): StudioInkwashWash {
  const key = input.key ?? STUDIO_INKWASH_WASH_KEY;
  const existing = washes.get(key);
  if (
    existing
    && (input.pageEpoch === undefined || Object.is(existing.pageEpoch, input.pageEpoch))
    && existing.fieldScale === input.fieldScale
    && existing.originX <= input.originX + 1e-9
    && existing.originY <= input.originY + 1e-9
    && existing.originX + existing.session.fluid.width / existing.fieldScale
      >= input.originX + input.width / input.fieldScale - 1e-9
    && existing.originY + existing.session.fluid.height / existing.fieldScale
      >= input.originY + input.height / input.fieldScale - 1e-9
  ) {
    return snapshot(existing);
  }

  const fieldScale = input.fieldScale;
  let originX = input.originX;
  let originY = input.originY;
  let width = Math.max(8, Math.ceil(input.width));
  let height = Math.max(8, Math.ceil(input.height));
  if (existing && Object.is(existing.pageEpoch, input.pageEpoch ?? existing.pageEpoch)
    && existing.fieldScale === fieldScale) {
    const endX = Math.max(
      existing.originX + existing.session.fluid.width / fieldScale,
      input.originX + input.width / fieldScale,
    );
    const endY = Math.max(
      existing.originY + existing.session.fluid.height / fieldScale,
      input.originY + input.height / fieldScale,
    );
    originX = Math.min(existing.originX, input.originX);
    originY = Math.min(existing.originY, input.originY);
    width = Math.max(8, Math.ceil((endX - originX) * fieldScale));
    height = Math.max(8, Math.ceil((endY - originY) * fieldScale));
  }

  const session = createStudioInkwashFluidSession({ width, height });
  if (existing && existing.fieldScale === fieldScale) {
    const offsetX = (existing.originX - originX) * fieldScale;
    const offsetY = (existing.originY - originY) * fieldScale;
    copySession(existing.session, session, offsetX, offsetY);
  }

  const record: StudioInkwashWashRecord = {
    key,
    pageEpoch: input.pageEpoch ?? existing?.pageEpoch ?? null,
    session,
    originX,
    originY,
    fieldScale,
    journal: existing?.journal ?? [],
    applied: existing?.applied ?? new Map(),
    displayCache: null,
  };
  washes.set(key, record);
  return snapshot(record);
}

export function studioInkwashDocumentToField(
  wash: StudioInkwashWash,
  x: number,
  y: number,
): { readonly x: number; readonly y: number } {
  return {
    x: (x - wash.originX) * wash.fieldScale,
    y: (y - wash.originY) * wash.fieldScale,
  };
}

export function readStudioInkwashWashDocumentCell(
  wash: StudioInkwashWash,
  documentX: number,
  documentY: number,
): ReturnType<typeof readStudioInkwashFluidCell> {
  const field = studioInkwashDocumentToField(wash, documentX, documentY);
  return readStudioInkwashFluidCell(
    wash.session,
    Math.round(field.x),
    Math.round(field.y),
  );
}

export function upsertStudioInkwashWashStroke(
  element: DrawEl,
  key: string = STUDIO_INKWASH_WASH_KEY,
): void {
  const record = washes.get(key);
  if (!record) return;
  const index = record.journal.findIndex((entry) => entry.id === element.id);
  const copy = { ...element, points: [...element.points], pressures: element.pressures ? [...element.pressures] : undefined };
  if (index >= 0) record.journal[index] = copy as DrawEl;
  else record.journal.push(copy as DrawEl);
}

export function studioInkwashWashNeedsDeposit(
  element: DrawEl,
  key: string = STUDIO_INKWASH_WASH_KEY,
): boolean {
  const record = washes.get(key);
  if (!record) return true;
  return record.applied.get(element.id) !== studioInkwashStrokeSignature(element);
}

export function markStudioInkwashWashDeposited(
  element: DrawEl,
  key: string = STUDIO_INKWASH_WASH_KEY,
): void {
  const record = washes.get(key);
  if (!record) return;
  record.applied.set(element.id, studioInkwashStrokeSignature(element));
}

/**
 * 워시가 지금까지 침착한 획의 (id, 서명) 목록. 문서 대조(reconcile)가 "문서에서 사라졌거나 형태가
 * 바뀐 획이 아직 안료로 남아 있는가"를 판정하는 유일한 입력이다.
 */
export function studioInkwashWashAppliedEntries(
  key: string = STUDIO_INKWASH_WASH_KEY,
): ReadonlyArray<readonly [id: string, signature: string]> {
  const record = washes.get(key);
  if (!record) return [];
  return Array.from(record.applied.entries(), ([id, signature]) => [id, signature] as const);
}

export function stepStudioInkwashWash(
  key: string = STUDIO_INKWASH_WASH_KEY,
  steps: number,
): void {
  const record = washes.get(key);
  if (!record) return;
  stepStudioInkwashFluid(record.session, steps, studioInkwashFluidStepParams());
}

export function commitStudioInkwashWash(
  key: string = STUDIO_INKWASH_WASH_KEY,
): boolean {
  const record = washes.get(key);
  if (!record) return false;
  fixStudioInkwashFluid(record.session);
  return true;
}

export function studioInkwashWashDigest(
  key: string = STUDIO_INKWASH_WASH_KEY,
): string | null {
  const record = washes.get(key);
  return record ? studioInkwashFluidDigest(record.session) : null;
}

export function studioInkwashWashDisplay(
  key: string = STUDIO_INKWASH_WASH_KEY,
  clip?: Readonly<{ x: number; y: number; width: number; height: number }>,
) {
  const record = washes.get(key);
  if (!record) return null;
  if (
    !clip
    && record.displayCache
    && record.displayCache.revision === record.session.revision
  ) {
    return record.displayCache.upload;
  }
  const upload = resolveStudioInkwashFluidDisplay(record.session, clip ? { clip } : undefined);
  if (!clip) {
    record.displayCache = { revision: record.session.revision, upload };
  }
  return upload;
}

export function studioInkwashWashVisualOwnerId(
  key: string = STUDIO_INKWASH_WASH_KEY,
): string | null {
  const record = washes.get(key);
  if (!record || record.journal.length === 0) return null;
  return record.journal[record.journal.length - 1]?.id ?? null;
}
