// Studio Emeres Library — 사용자가 캔버스 요소를 캡처하거나 이미지를 업로드해 "내가 만든 이메레스
// 틀"로 저장·관리하는 개인 보관함. studio-emeres-templates.ts(고정 SVG 카탈로그)의 사용자 확장판.
//
// studio-palette-library.ts/studio-brush-library.ts와 동일한 저장 패턴(localStorage 키 네이밍,
// MAX_* 개수 상한, 같은 id는 교체하며 맨 앞으로, rename/카테고리 변경은 순서 유지)을 그대로
// 재사용한다. 다만 이 보관함은 래스터 이미지 데이터(base64 dataURL)를 담으므로 상한을 palette/brush의
// 40개보다 낮게 잡는다(MAX_EMERES_LIBRARY_ITEMS = 30) — 항목당 저장 용량이 훨씬 크기 때문.
//
// 내보내기/가져오기 포맷은 의도적으로 없음(범위 밖 — docs/studio-emeres-library-integration.md §13 참고).
//
// 저장소(localStorage 호환 인터페이스)를 주입받아 순수하게 동작한다(studio-brush-library.ts와 동일).

import { EMERES_CATEGORIES, type EmeresCategory } from "./studio-emeres-templates";

export interface StudioEmeresLibraryItem {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** 캔버스 캡처(stage.toDataURL) 또는 업로드(downscaleImageFile) 결과 — 항상 래스터 dataURL. */
  src: string;
  width: number;
  height: number;
  /** 사용자가 나중에 붙이는 분류(선택). 생성 시점에는 항상 미설정 — setEmeresLibraryItemCategory로만
   *  설정/해제한다. 개인 보관함 패널에는 현재 이 값으로 필터링하는 UI가 없다(카탈로그와 달리
   *  검색/카테고리 칩 없음 — §13 스코프 축소); 태그로만 남아 있다가 이후 확장에 대비한다. */
  category?: EmeresCategory;
}

export interface EmeresLibraryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const EMERES_LIBRARY_KEY = "toonspectrum-studio-emeres-library";
export const MAX_EMERES_LIBRARY_ITEMS = 30; // studio-palette-library.ts의 MAX_PALETTES(40)보다 낮음 — 이미지라 항목당 용량이 더 큼.
export const DEFAULT_EMERES_LIBRARY_ITEM_NAME = "이름 없는 틀";
export const MAX_EMERES_LIBRARY_SERIALIZED_BYTES = 64 * 1024 * 1024;

export type StudioEmeresLibraryErrorCode =
  | "invalid-item"
  | "corrupt-data"
  | "library-too-large";

export class StudioEmeresLibraryError extends Error {
  readonly code: StudioEmeresLibraryErrorCode;

  constructor(code: StudioEmeresLibraryErrorCode, message: string) {
    super(message);
    this.name = "StudioEmeresLibraryError";
    this.code = code;
  }
}

function isEmeresCategory(v: unknown): v is EmeresCategory {
  return typeof v === "string" && (EMERES_CATEGORIES as readonly string[]).includes(v);
}

function isStudioEmeresLibraryItem(v: unknown): v is StudioEmeresLibraryItem {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (
    typeof o.id !== "string" ||
    typeof o.name !== "string" ||
    typeof o.createdAt !== "number" ||
    typeof o.updatedAt !== "number" ||
    typeof o.src !== "string" ||
    o.src.length === 0 ||
    typeof o.width !== "number" ||
    typeof o.height !== "number" ||
    // createEmeresLibraryItem이 강제하는 것과 동일한 "유한한 양수" 불변식을 읽기 경로에서도
    // 강제한다 — 그렇지 않으면 손상된(수동 편집 등) localStorage의 NaN/0/음수 width·height가
    // 그대로 통과해 버리고, 나중에 캔버스 삽입 시 크기 계산(선택한 프레임에 맞추는 나눗셈)이
    // Infinity/NaN으로 새는 걸 막지 못한다.
    !Number.isFinite(o.width) ||
    !Number.isFinite(o.height) ||
    o.width <= 0 ||
    o.height <= 0
  ) {
    return false;
  }
  if (o.category !== undefined && !isEmeresCategory(o.category)) return false;
  return true;
}

const DATA_IMAGE_URL_RE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/u;

function exactItemProperties(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const allowed = new Set([
    "id",
    "name",
    "createdAt",
    "updatedAt",
    "src",
    "width",
    "height",
    "category",
  ]);
  const keys = Object.keys(record);
  if (keys.some((key) => !allowed.has(key))) return null;
  return record;
}

function canonicalEmeresLibraryItem(value: unknown): StudioEmeresLibraryItem | null {
  const record = exactItemProperties(value);
  if (!record || !isStudioEmeresLibraryItem(record)) return null;
  if (
    record.id.trim() !== record.id
    || record.id.length === 0
    || record.id.length > 160
    || record.name.trim() !== record.name
    || record.name.length === 0
    || record.name.length > 160
    || !Number.isSafeInteger(record.createdAt)
    || record.createdAt < 0
    || !Number.isSafeInteger(record.updatedAt)
    || record.updatedAt < record.createdAt
    || !Number.isSafeInteger(record.width)
    || !Number.isSafeInteger(record.height)
    || !DATA_IMAGE_URL_RE.test(record.src)
  ) {
    return null;
  }
  return {
    id: record.id,
    name: record.name,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    src: record.src,
    width: record.width,
    height: record.height,
    ...(record.category === undefined ? {} : { category: record.category }),
  };
}

function canonicalEmeresLibraryItems(
  values: readonly unknown[],
): StudioEmeresLibraryItem[] {
  if (values.length > MAX_EMERES_LIBRARY_ITEMS) {
    throw new StudioEmeresLibraryError(
      "library-too-large",
      `이메레스 개인 보관함은 ${MAX_EMERES_LIBRARY_ITEMS}개를 넘을 수 없습니다.`,
    );
  }
  const ids = new Set<string>();
  const items = values.map((value) => {
    const item = canonicalEmeresLibraryItem(value);
    if (!item || ids.has(item.id)) {
      throw new StudioEmeresLibraryError(
        "invalid-item",
        "이메레스 개인 보관함에 손상되거나 중복된 항목이 있습니다.",
      );
    }
    ids.add(item.id);
    return item;
  });
  return items;
}

export function serializeEmeresLibraryItems(
  values: readonly StudioEmeresLibraryItem[],
): string {
  const serialized = JSON.stringify(canonicalEmeresLibraryItems(values));
  if (new TextEncoder().encode(serialized).byteLength > MAX_EMERES_LIBRARY_SERIALIZED_BYTES) {
    throw new StudioEmeresLibraryError(
      "library-too-large",
      "이메레스 개인 보관함이 SQLite 저장 상한을 넘었습니다.",
    );
  }
  return serialized;
}

export function parseCanonicalEmeresLibraryItems(raw: string): StudioEmeresLibraryItem[] {
  if (
    typeof raw !== "string"
    || new TextEncoder().encode(raw).byteLength > MAX_EMERES_LIBRARY_SERIALIZED_BYTES
  ) {
    throw new StudioEmeresLibraryError(
      "library-too-large",
      "이메레스 개인 보관함 저장값이 허용 크기를 넘었습니다.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new StudioEmeresLibraryError(
      "corrupt-data",
      "이메레스 개인 보관함 JSON이 손상되었습니다.",
    );
  }
  if (!Array.isArray(parsed)) {
    throw new StudioEmeresLibraryError(
      "corrupt-data",
      "이메레스 개인 보관함 저장값은 배열이어야 합니다.",
    );
  }
  const items = canonicalEmeresLibraryItems(parsed);
  if (JSON.stringify(items) !== raw) {
    throw new StudioEmeresLibraryError(
      "corrupt-data",
      "이메레스 개인 보관함 저장값이 canonical 형식이 아닙니다.",
    );
  }
  return items;
}

export function upsertEmeresLibraryItem(
  items: readonly StudioEmeresLibraryItem[],
  item: StudioEmeresLibraryItem,
): StudioEmeresLibraryItem[] {
  if (!isStudioEmeresLibraryItem(item)) {
    throw new StudioEmeresLibraryError("invalid-item", "유효하지 않은 이메레스 항목입니다.");
  }
  return [item, ...items.filter((entry) => entry.id !== item.id)]
    .slice(0, MAX_EMERES_LIBRARY_ITEMS);
}

export function renameEmeresLibraryItemInMemory(
  items: readonly StudioEmeresLibraryItem[],
  id: string,
  name: string,
  now: number = Date.now(),
): StudioEmeresLibraryItem[] {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 160 || !Number.isSafeInteger(now) || now < 0) {
    return [...items];
  }
  return items.map((item) => (
    item.id === id ? { ...item, name: trimmed, updatedAt: Math.max(item.createdAt, now) } : item
  ));
}

export function setEmeresLibraryItemCategoryInMemory(
  items: readonly StudioEmeresLibraryItem[],
  id: string,
  category: EmeresCategory | undefined,
  now: number = Date.now(),
): StudioEmeresLibraryItem[] {
  if (
    (category !== undefined && !isEmeresCategory(category))
    || !Number.isSafeInteger(now)
    || now < 0
  ) {
    return [...items];
  }
  return items.map((item) => {
    if (item.id !== id) return item;
    const updatedAt = Math.max(item.createdAt, now);
    if (category === undefined) {
      return {
        id: item.id,
        name: item.name,
        createdAt: item.createdAt,
        updatedAt,
        src: item.src,
        width: item.width,
        height: item.height,
      };
    }
    return { ...item, category, updatedAt };
  });
}

export function deleteEmeresLibraryItemInMemory(
  items: readonly StudioEmeresLibraryItem[],
  id: string,
): StudioEmeresLibraryItem[] {
  return items.filter((item) => item.id !== id);
}

// ── 저장소 CRUD (studio-brush-library.ts와 동일한 패턴) ────────────────

/** 저장된 항목 목록(최근 저장·캡처 순). 저장소 부재·파싱 실패 시 []. */
export function listEmeresLibraryItems(storage: EmeresLibraryStorage | null | undefined): StudioEmeresLibraryItem[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(EMERES_LIBRARY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStudioEmeresLibraryItem);
  } catch {
    return [];
  }
}

function persist(storage: EmeresLibraryStorage | null | undefined, items: StudioEmeresLibraryItem[]): void {
  if (!storage) return;
  try {
    storage.setItem(EMERES_LIBRARY_KEY, JSON.stringify(items));
  } catch {
    // 저장 실패(쿼터 초과·시크릿 모드 등) — 무시. 팔레트/브러시 라이브러리와 동일한 정책.
  }
}

/** 저장(같은 id면 교체하며 맨 앞으로, 새 항목도 맨 앞). 새 목록 반환. */
export function saveEmeresLibraryItem(
  storage: EmeresLibraryStorage | null | undefined,
  item: StudioEmeresLibraryItem
): StudioEmeresLibraryItem[] {
  const next = upsertEmeresLibraryItem(listEmeresLibraryItems(storage), item);
  persist(storage, next);
  return next;
}

/** 이름 변경(목록 순서는 유지 — 저장과 달리 맨 앞으로 옮기지 않는다). 빈 이름은 무시(원본 목록 그대로 반환). */
export function renameEmeresLibraryItem(
  storage: EmeresLibraryStorage | null | undefined,
  id: string,
  name: string
): StudioEmeresLibraryItem[] {
  const trimmed = name.trim();
  const current = listEmeresLibraryItems(storage);
  if (!trimmed) return current;
  const next = renameEmeresLibraryItemInMemory(current, id, trimmed);
  persist(storage, next);
  return next;
}

/**
 * 카테고리를 설정(유효한 EmeresCategory)하거나 해제(undefined → 미분류)한다. 목록 순서는 유지.
 * 유효하지 않은 카테고리 값이 들어오면 무시한다(원본 목록 그대로 반환) — renameEmeresLibraryItem의
 * "빈 이름 무시"와 대칭되는 방어. id가 없으면 각 항목의 내용은 그대로인 새 배열을 반환한다.
 */
export function setEmeresLibraryItemCategory(
  storage: EmeresLibraryStorage | null | undefined,
  id: string,
  category: EmeresCategory | undefined
): StudioEmeresLibraryItem[] {
  const current = listEmeresLibraryItems(storage);
  if (category !== undefined && !isEmeresCategory(category)) return current;
  const next = setEmeresLibraryItemCategoryInMemory(current, id, category);
  persist(storage, next);
  return next;
}

/** 삭제. 새 목록 반환. */
export function deleteEmeresLibraryItem(storage: EmeresLibraryStorage | null | undefined, id: string): StudioEmeresLibraryItem[] {
  const next = deleteEmeresLibraryItemInMemory(listEmeresLibraryItems(storage), id);
  persist(storage, next);
  return next;
}

/**
 * 캡처 또는 업로드로 얻은 이미지({src,width,height})에 이름을 붙여 저장 대상 레코드로 만든다.
 * 카테고리는 생성 시점에는 항상 미설정(undefined) — 저장 뒤 setEmeresLibraryItemCategory로만 붙인다.
 * 브러시 스냅샷(sanitizeBrushSnapshot)과 달리 이미지 데이터는 기본값으로 대체할 수 없으므로,
 * src가 빈 문자열이거나 width/height가 유한한 양수가 아니면 Error를 던진다(createPalette의
 * "유효한 데이터가 없으면 throw" 정책과 동일).
 *
 * 반올림은 유효성 검사 *뒤*가 아니라 *전에* 최종 정수값으로 먼저 확정한 뒤 그 값을 검사한다 —
 * 반올림 전 값(예: width 0.4)으로만 "양수" 판정을 하면 Math.round 후 0으로 내려가는 항목이
 * 검사를 통과해 버려, 이 함수가 절대 만들지 않겠다고 약속하는 "width/height가 유한한 양수"라는
 * 불변식이 조용히 깨진다(호출부는 이 함수가 던지지 않으면 항상 유효한 크기라고 가정한다 —
 * StudioEmeresLibraryPanel.handleConfirmSave 등).
 */
export function createEmeresLibraryItem(
  name: string,
  image: { src: string; width: number; height: number }
): StudioEmeresLibraryItem {
  if (typeof image.src !== "string" || image.src.length === 0) {
    throw new Error("이미지 데이터가 없어요. 다시 업로드하거나 캡처해주세요.");
  }
  const width = Math.round(image.width);
  const height = Math.round(image.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("이미지 크기를 확인할 수 없어요.");
  }
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name: name.trim() || DEFAULT_EMERES_LIBRARY_ITEM_NAME,
    createdAt: now,
    updatedAt: now,
    src: image.src,
    width,
    height,
  };
}
