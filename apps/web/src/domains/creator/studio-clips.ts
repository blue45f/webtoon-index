/**
 * Studio Clips — 재사용 클립 보관함(코미포/툰스푼식 에셋 재사용).
 *
 * 선택한 요소(또는 그룹)를 "클립"으로 저장해 두고, 다른 컷·다른 회차에서 한 번에 다시
 * 꺼내 쓴다. 포즈 잡은 캐릭터, 스타일 맞춘 말풍선 세트, 자주 쓰는 효과 조합 등을 매번
 * 새로 만들지 않아 연재 제작 시간을 크게 줄인다.
 *
 * 이 모듈은 저장소(localStorage 호환 인터페이스)를 주입받아 순수하게 동작한다 — 요소
 * 직렬화(els)는 메인 루프가 El로 캐스팅한다. JSON 파싱 실패·저장소 부재는 안전하게 무시.
 */

export interface StudioClip {
  id: string;
  name: string;
  createdAt: number;
  /** 직렬화된 요소 배열(원점 기준으로 정규화되어 저장됨). 메인 루프가 El[]로 캐스팅. */
  els: unknown[];
}

export interface ClipStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const CLIPS_KEY = "toonspectrum-studio-clips";
export const MAX_CLIPS = 40;
export const MAX_CLIP_NAME_LENGTH = 160;
export const MAX_CLIP_ID_LENGTH = 160;
export const MAX_CLIP_ELEMENTS = 4_096;
export const MAX_CLIP_JSON_DEPTH = 64;
export const MAX_CLIP_JSON_NODES = 250_000;
export const MAX_CLIP_SERIALIZED_BYTES = 16 * 1024 * 1024;
export const MAX_CLIP_LIBRARY_SERIALIZED_BYTES = 64 * 1024 * 1024;
export const STUDIO_SAVED_CLIP_LIBRARY_SCHEMA = "toonspectrum.studio.saved-clips";

export type StudioSavedClipLibraryErrorCode =
  | "corrupt-data"
  | "invalid-clip"
  | "library-too-large";

export class StudioSavedClipLibraryError extends Error {
  readonly code: StudioSavedClipLibraryErrorCode;

  constructor(code: StudioSavedClipLibraryErrorCode, message: string) {
    super(message);
    this.name = "StudioSavedClipLibraryError";
    this.code = code;
  }
}

function isClip(v: unknown): v is StudioClip {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.name === "string" &&
    typeof o.createdAt === "number" &&
    Array.isArray(o.els)
  );
}

type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue };

interface CanonicalJsonBudget {
  nodes: number;
}

function canonicalizeJsonValue(
  value: unknown,
  budget: CanonicalJsonBudget,
  depth = 0,
): CanonicalJsonValue {
  budget.nodes += 1;
  if (depth > MAX_CLIP_JSON_DEPTH || budget.nodes > MAX_CLIP_JSON_NODES) {
    throw new StudioSavedClipLibraryError(
      "library-too-large",
      "클립 요소 JSON이 깊이 또는 노드 안전 한도를 넘었습니다.",
    );
  }
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new StudioSavedClipLibraryError("invalid-clip", "클립 요소에 비정규 숫자가 있습니다.");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeJsonValue(item, budget, depth + 1));
  }
  if (!value || typeof value !== "object") {
    throw new StudioSavedClipLibraryError("invalid-clip", "클립 요소는 canonical JSON 값이어야 합니다.");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new StudioSavedClipLibraryError("invalid-clip", "클립 요소에 직렬화할 수 없는 객체가 있습니다.");
  }
  const source = value as Record<string, unknown>;
  const keys = Object.keys(source).sort();
  if (keys.length > 512 || keys.some((key) => key.length === 0 || key.length > 256)) {
    throw new StudioSavedClipLibraryError("library-too-large", "클립 요소 속성 수 또는 이름이 안전 한도를 넘었습니다.");
  }
  const result: Record<string, CanonicalJsonValue> = {};
  for (const key of keys) {
    result[key] = canonicalizeJsonValue(source[key], budget, depth + 1);
  }
  return result;
}

function exactClipRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const allowed = new Set(["id", "name", "createdAt", "els"]);
  return Object.keys(record).length === allowed.size
    && Object.keys(record).every((key) => allowed.has(key))
    ? record
    : null;
}

function canonicalClip(value: unknown): StudioClip | null {
  const record = exactClipRecord(value);
  if (!record || !isClip(record)) return null;
  if (
    record.id.trim() !== record.id
    || record.id.length === 0
    || record.id.length > MAX_CLIP_ID_LENGTH
    || record.name.trim() !== record.name
    || record.name.length === 0
    || record.name.length > MAX_CLIP_NAME_LENGTH
    || !Number.isSafeInteger(record.createdAt)
    || record.createdAt < 0
    || record.els.length === 0
    || record.els.length > MAX_CLIP_ELEMENTS
  ) {
    return null;
  }
  const budget = { nodes: 0 };
  const els = record.els.map((element) => canonicalizeJsonValue(element, budget));
  if (els.some((element) => !element || typeof element !== "object" || Array.isArray(element))) {
    return null;
  }
  const clip = { id: record.id, name: record.name, createdAt: record.createdAt, els };
  if (new TextEncoder().encode(JSON.stringify(clip)).byteLength > MAX_CLIP_SERIALIZED_BYTES) {
    throw new StudioSavedClipLibraryError(
      "library-too-large",
      "클립 하나가 16MB 저장 상한을 넘었습니다.",
    );
  }
  return clip;
}

function canonicalClipLibrary(values: readonly unknown[]): StudioClip[] {
  if (values.length > MAX_CLIPS) {
    throw new StudioSavedClipLibraryError(
      "library-too-large",
      `클립 보관함은 ${MAX_CLIPS}개를 넘을 수 없습니다.`,
    );
  }
  const ids = new Set<string>();
  return values.map((value) => {
    const clip = canonicalClip(value);
    if (!clip || ids.has(clip.id)) {
      throw new StudioSavedClipLibraryError(
        "invalid-clip",
        "클립 보관함에 손상되거나 중복된 항목이 있습니다.",
      );
    }
    ids.add(clip.id);
    return clip;
  });
}

function clipLibraryEnvelope(items: readonly StudioClip[]) {
  return {
    schema: STUDIO_SAVED_CLIP_LIBRARY_SCHEMA,
    version: 1 as const,
    items,
  };
}

export function serializeStudioSavedClipLibrary(values: readonly StudioClip[]): string {
  const serialized = JSON.stringify(clipLibraryEnvelope(canonicalClipLibrary(values)));
  if (new TextEncoder().encode(serialized).byteLength > MAX_CLIP_LIBRARY_SERIALIZED_BYTES) {
    throw new StudioSavedClipLibraryError(
      "library-too-large",
      "클립 보관함이 SQLite 저장 상한을 넘었습니다.",
    );
  }
  return serialized;
}

export function parseCanonicalStudioSavedClipLibrary(raw: string): StudioClip[] {
  if (
    typeof raw !== "string"
    || new TextEncoder().encode(raw).byteLength > MAX_CLIP_LIBRARY_SERIALIZED_BYTES
  ) {
    throw new StudioSavedClipLibraryError(
      "library-too-large",
      "클립 보관함 저장값이 허용 크기를 넘었습니다.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new StudioSavedClipLibraryError("corrupt-data", "클립 보관함 JSON이 손상되었습니다.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new StudioSavedClipLibraryError("corrupt-data", "클립 보관함 envelope가 올바르지 않습니다.");
  }
  const envelope = parsed as Record<string, unknown>;
  if (
    Object.keys(envelope).sort().join(",") !== "items,schema,version"
    || envelope.schema !== STUDIO_SAVED_CLIP_LIBRARY_SCHEMA
    || envelope.version !== 1
    || !Array.isArray(envelope.items)
  ) {
    throw new StudioSavedClipLibraryError("corrupt-data", "클립 보관함 저장 계약이 올바르지 않습니다.");
  }
  const items = canonicalClipLibrary(envelope.items);
  if (serializeStudioSavedClipLibrary(items) !== raw) {
    throw new StudioSavedClipLibraryError("corrupt-data", "클립 보관함이 canonical 형식이 아닙니다.");
  }
  return items;
}

export function upsertSavedClipInMemory(
  values: readonly StudioClip[],
  clip: StudioClip,
): StudioClip[] {
  const current = canonicalClipLibrary(values);
  const canonical = canonicalClip(clip);
  if (!canonical) {
    throw new StudioSavedClipLibraryError("invalid-clip", "유효하지 않은 클립입니다.");
  }
  const exists = current.some((item) => item.id === canonical.id);
  if (!exists && current.length >= MAX_CLIPS) {
    throw new StudioSavedClipLibraryError(
      "library-too-large",
      `클립 보관함은 ${MAX_CLIPS}개를 넘을 수 없습니다. 기존 클립을 먼저 삭제해 주세요.`,
    );
  }
  return [canonical, ...current.filter((item) => item.id !== canonical.id)];
}

export function deleteSavedClipInMemory(
  values: readonly StudioClip[],
  id: string,
): StudioClip[] {
  return canonicalClipLibrary(values).filter((clip) => clip.id !== id);
}

/** Legacy/test/import seam. V12 product boot never probes this key automatically. */
export function listClips(storage: ClipStorage | null | undefined): StudioClip[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(CLIPS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isClip);
  } catch {
    return [];
  }
}

function persist(storage: ClipStorage | null | undefined, clips: StudioClip[]): void {
  if (!storage) return;
  try {
    storage.setItem(CLIPS_KEY, JSON.stringify(clips));
  } catch {
    // 저장 불가(쿼터 초과·시크릿 모드) — 무시
  }
}

/** Legacy sync seam only. The V12 product uses the queued SQLite repository. */
export function saveClip(storage: ClipStorage | null | undefined, clip: StudioClip): StudioClip[] {
  const next = [clip, ...listClips(storage).filter((c) => c.id !== clip.id)].slice(0, MAX_CLIPS);
  persist(storage, next);
  return next;
}

/** 클립 삭제. 새 목록 반환. */
export function removeClip(storage: ClipStorage | null | undefined, id: string): StudioClip[] {
  const next = listClips(storage).filter((c) => c.id !== id);
  persist(storage, next);
  return next;
}
