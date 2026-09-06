/**
 * Studio Brand Kit — 팔레트(참조)·제목/본문 글꼴·로고를 하나의 이름 붙은 "킷"으로 묶어
 * 재사용한다. studio-palette-library.ts(팔레트 자체)와 studio-master-page.ts(문서 전역
 * 로고/워터마크 레이어)의 "재료"를 한 번에 적용 가능한 세트로 번들링하는 상위 레이어다.
 *
 * 팔레트는 원본을 복사하지 않고 studio-palette-library.ts의 StudioNamedPalette.id를
 * 참조(paletteId)한다 — 팔레트 라이브러리에서 팔레트를 고치면 이 킷에도 즉시 반영되고,
 * 원본이 삭제되면 참조가 끊긴다(dangling). 로고와 글꼴은 킷 자체가 값을 직접 보관한다
 * (로고는 참조할 "로고 라이브러리"가 앱에 없고, 글꼴은 애초에 문자열 값이라 참조할
 * 이유가 없다).
 *
 * 이 모듈은 저장소(localStorage 호환 인터페이스)를 주입받아 순수하게 동작한다
 * (studio-palette-library.ts·studio-clips.ts와 동일 패턴).
 */

import type { StudioNamedPalette } from "./studio-palette-library";

/** 글꼴 선택지 — 속성 패널의 글꼴 그리드(텍스트/말풍선 "글꼴" 절)가 그대로 쓰는 단일 출처다.
 *  값은 el.font 로 직행하는 CSS font-family 문자열이다.
 *
 *  이전에는 StudioPage.tsx 인라인 배열과의 "의도적 중복"이었다 — 13k줄 파일을 이 기능 랜딩과
 *  함께 리팩터링하지 않으려던 절충(§4 디자인 편차). 그 뒤 속성 패널이
 *  StudioInspectorAside.tsx 로 빠져나오면서 인라인 사본도 딸려갔고, 절충의 근거였던
 *  "StudioPage.tsx를 건드려야 함"이 사라졌다. 사본은 값이 한 글자도 다르지 않은 채 남아
 *  조용히 어긋날 위험만 남겼으므로 2026-08-14 에 인스펙터가 이 상수를 직접 쓰도록 정리했다. */
export interface BrandKitFontOption {
  label: string;
  value: string; // CSS font-family 값. El.font 와 동일 shape.
}

export const BRAND_KIT_FONTS: BrandKitFontOption[] = [
  { label: "고딕", value: "Pretendard, sans-serif" },
  { label: "명조", value: "'Nanum Myeongjo', serif" },
  { label: "둥근만화", value: "'Jua', sans-serif" },
  { label: "타이틀/굵은", value: "'Black Han Sans', sans-serif" },
  { label: "손글씨", value: "'Gaegu', cursive" },
  { label: "펜글씨", value: "'Nanum Pen Script', cursive" },
  { label: "아기자기", value: "'Gamja Flower', cursive" },
  { label: "붓글씨/고풍", value: "'Yeon Sung', cursive" },
  { label: "분노/공포", value: "'East Sea Dokdo', cursive" },
];

/** El.font 의 기본값과 동일 문자열(StudioPage.tsx 전역 fallback: `el.font ?? "Pretendard, sans-serif"`). */
export const DEFAULT_BRAND_KIT_FONT = "Pretendard, sans-serif";

/** 로고 — 다운스케일된(webp) data URL + 그 자연 크기. 크기를 함께 저장하는 이유는
 *  §4 디자인 편차에서 설명: 마스터에 적용할 때 이미지 재로딩 없이 동기적으로 종횡비를
 *  계산하기 위해서다(logoDataUrl 단일 문자열 스케치를 따랐다면 applyBrandKitLogo가
 *  비동기여야 했고, 이 코드베이스의 다른 모든 master 변형 함수는 동기다). */
export interface BrandKitLogo {
  dataUrl: string; // data:image/webp;base64,... — 업로드 시 studio-image-utils.downscaleImageFile 로 미리 축소된 값이어야 한다(이 모듈은 크기를 강제하지 않는다).
  width: number; // (다운스케일된) 자연 픽셀 너비
  height: number;
}

export interface BrandKit {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** studio-palette-library.ts StudioNamedPalette.id 참조. null = 팔레트 미번들. */
  paletteId: string | null;
  headingFont: string; // CSS font-family. 기본 DEFAULT_BRAND_KIT_FONT.
  bodyFont: string;
  logo: BrandKitLogo | null; // null = 로고 미번들.
}

export interface BrandKitStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const BRAND_KIT_KEY = "toonspectrum-studio-brand-kits";
export const MAX_BRAND_KITS = 40; // studio-clips.ts MAX_CLIPS / studio-palette-library.ts MAX_PALETTES 와 동일 상한 정책.
export const DEFAULT_BRAND_KIT_NAME = "이름 없는 브랜드 킷";
export const MAX_BRAND_KIT_NAME_LENGTH = 160;
export const MAX_BRAND_KIT_ID_LENGTH = 160;
export const MAX_BRAND_KIT_FONT_LENGTH = 512;
export const MAX_BRAND_KIT_LOGO_DATA_URL_BYTES = 4 * 1024 * 1024;
export const MAX_BRAND_KIT_LIBRARY_SERIALIZED_BYTES = 64 * 1024 * 1024;
export const STUDIO_BRAND_KIT_LIBRARY_SCHEMA = "toonspectrum.studio.brand-kits";

export type StudioBrandKitLibraryErrorCode =
  | "corrupt-data"
  | "invalid-kit"
  | "library-too-large";

export class StudioBrandKitLibraryError extends Error {
  readonly code: StudioBrandKitLibraryErrorCode;

  constructor(code: StudioBrandKitLibraryErrorCode, message: string) {
    super(message);
    this.name = "StudioBrandKitLibraryError";
    this.code = code;
  }
}

/** 문서 마스터에서 "브랜드 킷 로고"를 식별하는 고정 id — 일반 요소는 uid()(crypto.randomUUID())를
 *  쓰지만, 이 값은 재적용 시 새 요소를 쌓지 않고 같은 자리(위치·크기)에 교체하기 위해
 *  의도적으로 고정 문자열이다(uuid와 충돌할 일이 없다). */
export const BRAND_KIT_LOGO_MASTER_ID = "brand-kit-logo";

function isBrandKitLogo(v: unknown): v is BrandKitLogo {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.dataUrl === "string" && typeof o.width === "number" && typeof o.height === "number";
}

function isBrandKit(v: unknown): v is BrandKit {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.name === "string" &&
    typeof o.createdAt === "number" &&
    typeof o.updatedAt === "number" &&
    (o.paletteId === null || typeof o.paletteId === "string") &&
    typeof o.headingFont === "string" &&
    typeof o.bodyFont === "string" &&
    (o.logo === null || isBrandKitLogo(o.logo))
  );
}

const BRAND_LOGO_DATA_URL_RE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/u;

function exactRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const allowed = new Set(keys);
  return Object.keys(record).length === allowed.size
    && Object.keys(record).every((key) => allowed.has(key))
    ? record
    : null;
}

function canonicalLogo(value: unknown): BrandKitLogo | null {
  if (value === null) return null;
  const record = exactRecord(value, ["dataUrl", "width", "height"]);
  if (
    !record
    || !isBrandKitLogo(record)
    || !BRAND_LOGO_DATA_URL_RE.test(record.dataUrl)
    || new TextEncoder().encode(record.dataUrl).byteLength > MAX_BRAND_KIT_LOGO_DATA_URL_BYTES
    || !Number.isSafeInteger(record.width)
    || !Number.isSafeInteger(record.height)
    || record.width <= 0
    || record.height <= 0
    || record.width > 8_192
    || record.height > 8_192
  ) {
    return null;
  }
  return { dataUrl: record.dataUrl, width: record.width, height: record.height };
}

function canonicalBrandKit(value: unknown): BrandKit | null {
  const record = exactRecord(value, [
    "id",
    "name",
    "createdAt",
    "updatedAt",
    "paletteId",
    "headingFont",
    "bodyFont",
    "logo",
  ]);
  if (!record || !isBrandKit(record)) return null;
  const logo = canonicalLogo(record.logo);
  if (
    (record.logo !== null && logo === null)
    || record.id.trim() !== record.id
    || record.id.length === 0
    || record.id.length > MAX_BRAND_KIT_ID_LENGTH
    || record.name.trim() !== record.name
    || record.name.length === 0
    || record.name.length > MAX_BRAND_KIT_NAME_LENGTH
    || !Number.isSafeInteger(record.createdAt)
    || record.createdAt < 0
    || !Number.isSafeInteger(record.updatedAt)
    || record.updatedAt < record.createdAt
    || (typeof record.paletteId === "string" && (
      record.paletteId.trim() !== record.paletteId
      || record.paletteId.length === 0
      || record.paletteId.length > MAX_BRAND_KIT_ID_LENGTH
    ))
    || record.headingFont.trim() !== record.headingFont
    || record.headingFont.length === 0
    || record.headingFont.length > MAX_BRAND_KIT_FONT_LENGTH
    || record.bodyFont.trim() !== record.bodyFont
    || record.bodyFont.length === 0
    || record.bodyFont.length > MAX_BRAND_KIT_FONT_LENGTH
  ) {
    return null;
  }
  return {
    id: record.id,
    name: record.name,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    paletteId: record.paletteId,
    headingFont: record.headingFont,
    bodyFont: record.bodyFont,
    logo,
  };
}

function canonicalBrandKitLibrary(values: readonly unknown[]): BrandKit[] {
  if (values.length > MAX_BRAND_KITS) {
    throw new StudioBrandKitLibraryError(
      "library-too-large",
      `브랜드 킷은 ${MAX_BRAND_KITS}개를 넘을 수 없습니다.`,
    );
  }
  const ids = new Set<string>();
  return values.map((value) => {
    const kit = canonicalBrandKit(value);
    if (!kit || ids.has(kit.id)) {
      throw new StudioBrandKitLibraryError(
        "invalid-kit",
        "브랜드 킷 라이브러리에 손상되거나 중복된 항목이 있습니다.",
      );
    }
    ids.add(kit.id);
    return kit;
  });
}

function brandKitEnvelope(items: readonly BrandKit[]) {
  return {
    schema: STUDIO_BRAND_KIT_LIBRARY_SCHEMA,
    version: 1 as const,
    items,
  };
}

export function serializeStudioBrandKitLibrary(values: readonly BrandKit[]): string {
  const serialized = JSON.stringify(brandKitEnvelope(canonicalBrandKitLibrary(values)));
  if (new TextEncoder().encode(serialized).byteLength > MAX_BRAND_KIT_LIBRARY_SERIALIZED_BYTES) {
    throw new StudioBrandKitLibraryError(
      "library-too-large",
      "브랜드 킷 라이브러리가 SQLite 저장 상한을 넘었습니다.",
    );
  }
  return serialized;
}

export function parseCanonicalStudioBrandKitLibrary(raw: string): BrandKit[] {
  if (
    typeof raw !== "string"
    || new TextEncoder().encode(raw).byteLength > MAX_BRAND_KIT_LIBRARY_SERIALIZED_BYTES
  ) {
    throw new StudioBrandKitLibraryError(
      "library-too-large",
      "브랜드 킷 저장값이 허용 크기를 넘었습니다.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new StudioBrandKitLibraryError("corrupt-data", "브랜드 킷 JSON이 손상되었습니다.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new StudioBrandKitLibraryError("corrupt-data", "브랜드 킷 envelope가 올바르지 않습니다.");
  }
  const envelope = parsed as Record<string, unknown>;
  if (
    Object.keys(envelope).sort().join(",") !== "items,schema,version"
    || envelope.schema !== STUDIO_BRAND_KIT_LIBRARY_SCHEMA
    || envelope.version !== 1
    || !Array.isArray(envelope.items)
  ) {
    throw new StudioBrandKitLibraryError("corrupt-data", "브랜드 킷 저장 계약이 올바르지 않습니다.");
  }
  const items = canonicalBrandKitLibrary(envelope.items);
  if (serializeStudioBrandKitLibrary(items) !== raw) {
    throw new StudioBrandKitLibraryError("corrupt-data", "브랜드 킷 저장값이 canonical 형식이 아닙니다.");
  }
  return items;
}

export function upsertBrandKitInMemory(
  values: readonly BrandKit[],
  kit: BrandKit,
): BrandKit[] {
  const current = canonicalBrandKitLibrary(values);
  const canonical = canonicalBrandKit(kit);
  if (!canonical) {
    throw new StudioBrandKitLibraryError("invalid-kit", "유효하지 않은 브랜드 킷입니다.");
  }
  const exists = current.some((item) => item.id === canonical.id);
  if (!exists && current.length >= MAX_BRAND_KITS) {
    throw new StudioBrandKitLibraryError(
      "library-too-large",
      `브랜드 킷은 ${MAX_BRAND_KITS}개를 넘을 수 없습니다. 기존 킷을 먼저 삭제해 주세요.`,
    );
  }
  return [canonical, ...current.filter((item) => item.id !== canonical.id)];
}

export function renameBrandKitInMemory(
  values: readonly BrandKit[],
  id: string,
  name: string,
  now: number = Date.now(),
): BrandKit[] {
  const current = canonicalBrandKitLibrary(values);
  const trimmed = name.trim();
  if (!trimmed) return current;
  if (trimmed.length > MAX_BRAND_KIT_NAME_LENGTH || !Number.isSafeInteger(now) || now < 0) {
    throw new StudioBrandKitLibraryError("invalid-kit", "브랜드 킷 이름 또는 수정 시각이 올바르지 않습니다.");
  }
  return current.map((kit) => kit.id === id
    ? { ...kit, name: trimmed, updatedAt: Math.max(kit.createdAt, now) }
    : kit);
}

export function deleteBrandKitInMemory(values: readonly BrandKit[], id: string): BrandKit[] {
  return canonicalBrandKitLibrary(values).filter((kit) => kit.id !== id);
}

/** Legacy/test/import seam. V12 product boot never probes this key automatically. */
export function listBrandKits(storage: BrandKitStorage | null | undefined): BrandKit[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(BRAND_KIT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isBrandKit);
  } catch {
    return [];
  }
}

function persist(storage: BrandKitStorage | null | undefined, kits: BrandKit[]): void {
  if (!storage) return;
  try {
    storage.setItem(BRAND_KIT_KEY, JSON.stringify(kits));
  } catch {
    // 저장 실패(쿼터 초과·시크릿 모드 등) — 무시. 팔레트·클립과 동일한 정책.
  }
}

/** Legacy sync seam only. The V12 product uses the queued SQLite repository. */
export function saveBrandKit(storage: BrandKitStorage | null | undefined, kit: BrandKit): BrandKit[] {
  const next = [kit, ...listBrandKits(storage).filter((k) => k.id !== kit.id)].slice(0, MAX_BRAND_KITS);
  persist(storage, next);
  return next;
}

/** 이름 변경(순서 유지, updatedAt 갱신). 빈 이름은 무시. */
export function renameBrandKit(storage: BrandKitStorage | null | undefined, id: string, name: string): BrandKit[] {
  const trimmed = name.trim();
  const current = listBrandKits(storage);
  if (!trimmed) return current;
  const next = current.map((k) => (k.id === id ? { ...k, name: trimmed, updatedAt: Date.now() } : k));
  persist(storage, next);
  return next;
}

/** 삭제. */
export function deleteBrandKit(storage: BrandKitStorage | null | undefined, id: string): BrandKit[] {
  const next = listBrandKits(storage).filter((k) => k.id !== id);
  persist(storage, next);
  return next;
}

/**
 * 새 브랜드 킷 생성 — createPalette와 달리 **절대 던지지 않는다**. 브랜드 킷은 팔레트처럼
 * "유효한 색이 하나는 있어야" 하는 불변식이 없다: 이름만 있고 나머지는 비어 있는 킷도
 * 유효하다(사용자가 이름부터 짓고 점진적으로 채워나가는 흐름을 막지 않기 위함).
 * 빈 이름/빈 글꼴은 각각 DEFAULT_BRAND_KIT_NAME/DEFAULT_BRAND_KIT_FONT로 대체된다.
 */
export function createBrandKit(input: {
  name: string;
  paletteId?: string | null;
  headingFont?: string;
  bodyFont?: string;
  logo?: BrandKitLogo | null;
}): BrandKit {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name: input.name.trim() || DEFAULT_BRAND_KIT_NAME,
    createdAt: now,
    updatedAt: now,
    paletteId: input.paletteId ?? null,
    headingFont: input.headingFont?.trim() || DEFAULT_BRAND_KIT_FONT,
    bodyFont: input.bodyFont?.trim() || DEFAULT_BRAND_KIT_FONT,
    logo: input.logo ?? null,
  };
}

/**
 * 킷에 번들된 paletteId를 실제 팔레트로 해석한다. paletteId가 null이면 null(팔레트 미번들),
 * 참조가 끊겼으면(팔레트가 삭제됨) 마찬가지로 null(패널이 "삭제된 팔레트"로 표시할 신호).
 * palettes는 호출측이 studio-palette-library.listPalettes(...)로 얻어 전달한다.
 */
export function resolveBrandKitPalette(
  kit: BrandKit,
  palettes: readonly StudioNamedPalette[]
): StudioNamedPalette | null {
  if (!kit.paletteId) return null;
  return palettes.find((p) => p.id === kit.paletteId) ?? null;
}

export interface BrandKitLogoPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

/**
 * 로고를 캔버스 우하단 모서리에 여백을 두고 종횡비를 보존해 배치한다(코너 워터마크 관례,
 * studio-watermark.ts의 margin 계산과 같은 자릿수). "기존 로고 요소가 있으면 그 위치·크기를
 * 재사용한다"는 로직은 이 함수의 책임이 아니다 — 그건 호출측(StudioPage.tsx)이 결정할
 * "같은 자리에 교체할지, 새로 배치할지"의 정책이고, 이 함수는 "처음 배치할 때" 좌표만
 * 계산하는 순수 함수다.
 */
export function placeBrandKitLogo(
  canvasWidth: number,
  canvasHeight: number,
  sourceWidth: number,
  sourceHeight: number,
  maxDim = 140,
  margin = 28
): BrandKitLogoPlacement {
  const safeW = Math.max(1, sourceWidth);
  const safeH = Math.max(1, sourceHeight);
  const fit = Math.min(1, maxDim / Math.max(safeW, safeH));
  const width = Math.max(1, Math.round(safeW * fit));
  const height = Math.max(1, Math.round(safeH * fit));
  return {
    x: Math.max(0, Math.round(canvasWidth - margin - width)),
    y: Math.max(0, Math.round(canvasHeight - margin - height)),
    width,
    height,
    rotation: 0,
  };
}
