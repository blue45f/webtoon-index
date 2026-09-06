/**
 * Studio Custom Fonts — 창작자가 라이선스를 보유한 자기 글꼴 파일(TTF/OTF/TTC/WOFF/WOFF2)을
 * 스튜디오로 가져와 레터링·효과음(SFX)에 쓰게 한다. studio-google-fonts.ts가 "공개 웹폰트를
 * <link>로 주입"하는 쪽이라면, 이 모듈은 "사용자가 가진 바이너리를 FontFace로 등록"하는 쪽이다
 * (교체가 아니라 나란히 놓이는 두 번째 공급원 — 두 목록은 서로를 알지 못한다).
 *
 * 제품 경로는 studio-custom-font-sqlite-opfs-repository.ts의 SQLite canonical manifest와
 * OPFS SHA-256 CAS를 사용한다. 아래 localStorage 호환 함수는 자동 호출되지 않는 명시적
 * legacy import/test seam으로만 유지한다.
 *
 * ── 용량 예산(왜 이 숫자인가) ────────────────────────────────────────────
 * CJK TTC·다축 variable font는 수십 MiB가 될 수 있다. 제품 상한은 파일 128 MiB,
 * 라이브러리 2 GiB다. 항목 수는 제품 총량으로 제한하지 않고 SQLite cursor page로 읽는다.
 * 한 번의 File.arrayBuffer/FontFace 메모리 폭주는 개별 파일·page hydration 바이트 경계가
 * 막고, 실제 디스크 여유는 OPFS quota estimator가 별도로 검사한다.
 */

import { firstFontFamilyName } from "./studio-google-fonts";

// ── 모델 ────────────────────────────────────────────────────────────────

export type StudioCustomFontFormat = "ttf" | "otf" | "ttc" | "woff" | "woff2";

export interface StudioCustomFont {
  id: string;
  /** CSS font-family에 그대로 들어가는 안전화된 이름. 보관함 안에서 유일하다. */
  family: string;
  /** 사용자가 고른 원본 파일명(표시·재가져오기 안내용). */
  fileName: string;
  /** 실제 글꼴 바이트 수(예산 계산의 단일 기준). */
  byteLength: number;
  /** explicit legacy seam에서만 사용하는 인라인 사본. 제품 SQLite에는 절대 저장하지 않는다. */
  dataUrl?: string;
  /** OPFS CAS에서 SHA-256 검증을 마친 제품 hydration 바이트. */
  verifiedBytes?: Uint8Array;
}

/** category가 없는 사용자 글꼴의 CSS 폴백. studioGoogleFontCssValue의 sans/display와 같은 값. */
const CUSTOM_FONT_FALLBACK = "sans-serif";

export const DEFAULT_CUSTOM_FONT_FAMILY = "사용자 글꼴";
export const MAX_CUSTOM_FONT_FAMILY_LENGTH = 64;

export const MAX_CUSTOM_FONT_FILE_BYTES = 128 * 1024 * 1024;
export const MAX_CUSTOM_FONT_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;

const FORMAT_MIME: Record<StudioCustomFontFormat, string> = {
  ttf: "font/ttf",
  otf: "font/otf",
  ttc: "font/collection",
  woff: "font/woff",
  woff2: "font/woff2",
};

export function studioCustomFontMime(format: StudioCustomFontFormat): string {
  return FORMAT_MIME[format];
}

/** 파일 선택 대화상자에 넘길 accept 문자열. 확장자와 MIME을 함께 준다(OS별로 한쪽만 맞는다). */
export const CUSTOM_FONT_ACCEPT =
  ".ttf,.otf,.ttc,.woff,.woff2,font/ttf,font/otf,font/collection,font/woff,font/woff2,"
  + "application/font-woff,application/x-font-ttf,application/x-font-otf,application/vnd.ms-opentype";

export const CUSTOM_FONT_FORMAT_HELP = "TTF·OTF·TTC·WOFF·WOFF2";

/** 표시용 용량 문자열. StudioPublishPackagePanel.formatBytes와 같은 10진 눈금·한국어 로케일. */
export function formatCustomFontBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "용량 미확인";
  if (value < 1_000) return `${Math.round(value).toLocaleString("ko-KR")} B`;
  if (value < 1_000_000) {
    return `${(value / 1_000).toLocaleString("ko-KR", { maximumFractionDigits: 1 })} KB`;
  }
  return `${(value / 1_000_000).toLocaleString("ko-KR", { maximumFractionDigits: 2 })} MB`;
}

// ── 매직 넘버 판별 ───────────────────────────────────────────────────────

function ascii4(bytes: Uint8Array): string {
  return String.fromCharCode(
    bytes[0] ?? 0,
    bytes[1] ?? 0,
    bytes[2] ?? 0,
    bytes[3] ?? 0
  );
}

/**
 * 앞 4바이트만으로 글꼴 컨테이너를 판별한다. 확장자는 신뢰하지 않는다(사용자가 .ttf로
 * 이름만 바꾼 zip을 FontFace에 먹이면 브라우저가 조용히 실패할 뿐이라 여기서 먼저 막는다).
 * 아는 서명이 아니면 null — 호출부가 한국어 메시지로 거절한다.
 */
export function sniffStudioFontFormat(bytes: Uint8Array): StudioCustomFontFormat | null {
  if (bytes.byteLength < 4) return null;
  // 0x00010000 — sfnt(TrueType outlines). OpenType/TTF의 정식 버전 태그다.
  if (bytes[0] === 0x00 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) return "ttf";
  switch (ascii4(bytes)) {
    case "OTTO": // CFF outlines를 가진 OpenType
      return "otf";
    case "true": // Apple TrueType
      return "ttf";
    case "ttcf": // TrueType Collection
      return "ttc";
    case "wOFF":
      return "woff";
    case "wOF2":
      return "woff2";
    default:
      return null;
  }
}

// ── family 이름 유도 ─────────────────────────────────────────────────────

const FONT_EXTENSION_RE = /\.(?:ttf|otf|ttc|woff2|woff)$/iu;
// font-family 선언(`'name', sans-serif`)과 document.fonts.load(`16px 'name'`) 양쪽에 그대로
// 들어가는 값이라, 따옴표·역슬래시·구분자·제어문자를 애초에 만들지 않는다. 이스케이프하지 않고
// 제거하는 쪽을 고른 이유: 이름은 사람이 읽는 라벨일 뿐이고, 이스케이프 규칙을 두 소비처에서
// 각각 다시 맞추는 것보다 문자 집합을 좁히는 편이 회귀가 없다.
const FAMILY_FORBIDDEN_PUNCTUATION = "'\"\\,;<>{}[]/";

function isForbiddenFamilyChar(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  if (code < 0x20 || code === 0x7f) return true; // 제어문자(DEL 포함)
  return FAMILY_FORBIDDEN_PUNCTUATION.includes(ch);
}

export function normalizeStudioCustomFontFamily(raw: string): string {
  let stripped = "";
  for (const ch of String(raw ?? "")) stripped += isForbiddenFamilyChar(ch) ? " " : ch;
  const cleaned = stripped.replace(/\s+/gu, " ").replace(/^[.\s]+|[.\s]+$/gu, "").trim();
  if (!cleaned) return "";
  return cleaned.length > MAX_CUSTOM_FONT_FAMILY_LENGTH
    ? cleaned.slice(0, MAX_CUSTOM_FONT_FAMILY_LENGTH).trim()
    : cleaned;
}

function uniqueFamily(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  // `taken.size + 2`개의 suffix 후보 중 하나는 반드시 비어 있다. 고정 999회 탐색 뒤
  // Date.now()로 빠지던 옛 경로는 1,000개가 넘는 동명 family에서 충돌할 수 있었다.
  for (let suffix = 2; suffix <= taken.size + 2; suffix += 1) {
    const suffixText = ` (${suffix})`;
    const candidate = `${base.slice(0, MAX_CUSTOM_FONT_FAMILY_LENGTH - suffixText.length).trim()}${suffixText}`;
    if (!taken.has(candidate)) return candidate;
  }
  // 위 pigeonhole 경계상 도달하지 않는다. 타입 수준의 total function을 유지한다.
  return base;
}

/**
 * 파일명에서 CSS에 안전한 family 이름을 만든다. 확장자·경로·따옴표·콤마·역슬래시를 걷어내고
 * 공백을 접은 뒤, 이미 쓰이는 이름이면 " (2)", " (3)" … 으로 비켜 간다.
 * 한글·공백·하이픈은 그대로 남긴다(사용자가 자기 글꼴을 알아볼 수 있어야 한다).
 */
export function deriveCustomFontFamily(fileName: string, taken: Iterable<string> = []): string {
  const withoutPath = String(fileName ?? "").split(/[\\/]/u).pop() ?? "";
  const base = normalizeStudioCustomFontFamily(withoutPath.replace(FONT_EXTENSION_RE, ""));
  return uniqueFamily(base || DEFAULT_CUSTOM_FONT_FAMILY, new Set(taken));
}

// ── CSS 값 ──────────────────────────────────────────────────────────────

/** studioGoogleFontCssValue와 같은 shape의 CSS font-family 문자열(`'가나다', sans-serif`). */
export function customFontCssValue(font: Pick<StudioCustomFont, "family">): string {
  return `'${font.family}', ${CUSTOM_FONT_FALLBACK}`;
}

/** FontFace 생성자에 넘길 CSS src 서술자. base64 문자 집합엔 따옴표가 없어 안전하게 감싼다. */
export function customFontFaceSource(font: { readonly dataUrl: string }): string {
  return `url("${font.dataUrl}")`;
}

/** CSS font-family 값이 보관함의 사용자 글꼴을 가리키면 그 항목을, 아니면 undefined. */
export function resolveCustomFontFromCssValue(
  fonts: readonly StudioCustomFont[],
  cssValue: string
): StudioCustomFont | undefined {
  const name = firstFontFamilyName(cssValue);
  if (!name) return undefined;
  return fonts.find((font) => font.family === name);
}

// ── 순수 CRUD + 예산 ─────────────────────────────────────────────────────

export function totalCustomFontBytes(fonts: readonly StudioCustomFont[]): number {
  return fonts.reduce((sum, font) => sum + font.byteLength, 0);
}

/** 남은 예산(바이트). 음수는 0으로 접는다. */
export function remainingCustomFontBytes(fonts: readonly StudioCustomFont[]): number {
  return Math.max(0, MAX_CUSTOM_FONT_TOTAL_BYTES - totalCustomFontBytes(fonts));
}

export interface StudioCustomFontInput {
  fileName: string;
  bytes: Uint8Array;
  /** 결정적 테스트를 위한 주입 지점. 생략하면 crypto.randomUUID(). */
  id?: string;
}

export type StudioCustomFontAddResult =
  | { status: "added"; fonts: StudioCustomFont[]; font: StudioCustomFont }
  | { status: "rejected"; fonts: StudioCustomFont[]; message: string };

const CHUNK = 0x8000;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.byteLength; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}

/**
 * 글꼴 파일 바이트를 검증해 보관함 뒤에 붙인다. 절대 throw하지 않고, 거절은 숫자를 밝힌
 * 한국어 메시지로 돌려준다. 원본 배열은 변형하지 않는다(새 배열 반환).
 */
export function addCustomFont(
  fonts: readonly StudioCustomFont[],
  input: StudioCustomFontInput
): StudioCustomFontAddResult {
  const current = [...fonts];
  const bytes = input.bytes;
  if (!bytes || bytes.byteLength === 0) {
    return { status: "rejected", fonts: current, message: "빈 파일이에요. 글꼴 파일을 선택해주세요." };
  }
  const format = sniffStudioFontFormat(bytes);
  if (!format) {
    return {
      status: "rejected",
      fonts: current,
      message: `글꼴 파일이 아니에요. ${CUSTOM_FONT_FORMAT_HELP} 파일을 선택해주세요.`,
    };
  }
  if (bytes.byteLength > MAX_CUSTOM_FONT_FILE_BYTES) {
    return {
      status: "rejected",
      fonts: current,
      message:
        `글꼴 파일이 ${formatCustomFontBytes(bytes.byteLength)}로 한 개당 `
        + `${formatCustomFontBytes(MAX_CUSTOM_FONT_FILE_BYTES)} 한도를 넘었어요. `
        + "필요한 굵기만 서브셋한 WOFF2로 변환해 주세요.",
    };
  }
  const used = totalCustomFontBytes(current);
  if (used + bytes.byteLength > MAX_CUSTOM_FONT_TOTAL_BYTES) {
    return {
      status: "rejected",
      fonts: current,
      message:
        `보관함 용량이 ${formatCustomFontBytes(used)}/`
        + `${formatCustomFontBytes(MAX_CUSTOM_FONT_TOTAL_BYTES)}라 `
        + `${formatCustomFontBytes(bytes.byteLength)}를 더 담을 수 없어요. `
        + "쓰지 않는 글꼴을 지운 뒤 다시 시도해주세요.",
    };
  }

  const family = deriveCustomFontFamily(input.fileName, current.map((font) => font.family));
  const font: StudioCustomFont = {
    id: input.id ?? crypto.randomUUID(),
    family,
    fileName: String(input.fileName ?? "").split(/[\\/]/u).pop() ?? "",
    byteLength: bytes.byteLength,
    dataUrl: `data:${FORMAT_MIME[format]};base64,${toBase64(bytes)}`,
  };
  return { status: "added", fonts: [...current, font], font };
}

/** 삭제. 없는 id면 같은 내용의 새 배열을 그대로 돌려준다. */
export function removeCustomFont(
  fonts: readonly StudioCustomFont[],
  id: string
): StudioCustomFont[] {
  return fonts.filter((font) => font.id !== id);
}

/**
 * family 이름 변경(목록 순서 유지). 빈 이름·안전화 후 빈 문자열이면 원본을 그대로 둔다.
 * 다른 글꼴과 이름이 겹치면 " (2)"로 비켜 간다 — 보관함 안에서 family는 항상 유일하다.
 */
export function renameCustomFont(
  fonts: readonly StudioCustomFont[],
  id: string,
  family: string
): StudioCustomFont[] {
  const target = fonts.find((font) => font.id === id);
  if (!target) return [...fonts];
  const cleaned = normalizeStudioCustomFontFamily(String(family ?? ""));
  if (!cleaned) return [...fonts];
  const taken = new Set(fonts.filter((font) => font.id !== id).map((font) => font.family));
  const next = uniqueFamily(cleaned, taken);
  return fonts.map((font) => (font.id === id ? { ...font, family: next } : font));
}

// ── 직렬화 / 방어적 파싱 ─────────────────────────────────────────────────

export const CUSTOM_FONT_LIBRARY_KEY = "toonspectrum-studio-custom-fonts";
export const CUSTOM_FONT_LIBRARY_STORAGE_VERSION = 1;

const DATA_URL_RE = /^data:[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+;base64,([A-Za-z0-9+/]+={0,2})$/u;

/** base64 payload가 실제로 몇 바이트인지. 형식이 어긋나면 null. */
function base64ByteLength(payload: string): number | null {
  if (payload.length === 0 || payload.length % 4 !== 0) return null;
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return (payload.length / 4) * 3 - padding;
}

function normalizeStoredFont(value: unknown): StudioCustomFont | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const dataUrl = typeof record.dataUrl === "string" ? record.dataUrl : "";
  if (!id || !dataUrl) return null;
  const match = DATA_URL_RE.exec(dataUrl);
  if (!match) return null;
  // byteLength는 저장값을 믿지 않고 payload에서 다시 계산한다 — 손상·위조된 숫자가 예산
  // 계산을 통과하지 못하게 하는 유일한 방어선이다.
  const byteLength = base64ByteLength(match[1] ?? "");
  if (byteLength === null || byteLength <= 0 || byteLength > MAX_CUSTOM_FONT_FILE_BYTES) return null;
  const family = normalizeStudioCustomFontFamily(typeof record.family === "string" ? record.family : "");
  if (!family) return null;
  return {
    id,
    family,
    fileName: typeof record.fileName === "string" ? record.fileName : "",
    byteLength,
    dataUrl,
  };
}

/** 버전 envelope로 직렬화. brush 라이브러리와 같은 shape. */
export function serializeCustomFonts(fonts: readonly StudioCustomFont[]): string {
  return JSON.stringify({
    version: CUSTOM_FONT_LIBRARY_STORAGE_VERSION,
    fonts: fonts.map((font) => {
      if (!font.dataUrl) {
        throw new Error("verified OPFS font bytes cannot be serialized into the legacy data-url store");
      }
      return {
        id: font.id,
        family: font.family,
        fileName: font.fileName,
        byteLength: font.byteLength,
        dataUrl: font.dataUrl,
      };
    }),
  });
}

/**
 * 저장 문자열 → 목록. 절대 throw하지 않는다. 깨진 JSON·미래 버전·모르는 레코드·중복 id·
 * 중복 family는 전부 조용히 버리고, 남은 것만 돌려준다(부분 손상에서 나머지를 살린다).
 */
export function parseCustomFonts(raw: string | null | undefined): StudioCustomFont[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  let records: unknown[];
  if (Array.isArray(parsed)) {
    records = parsed;
  } else if (parsed && typeof parsed === "object") {
    const envelope = parsed as Record<string, unknown>;
    if (envelope.version !== CUSTOM_FONT_LIBRARY_STORAGE_VERSION) return [];
    if (!Array.isArray(envelope.fonts)) return [];
    records = envelope.fonts;
  } else {
    return [];
  }

  const fonts: StudioCustomFont[] = [];
  const ids = new Set<string>();
  const families = new Set<string>();
  let admittedBytes = 0;
  for (const record of records) {
    const font = normalizeStoredFont(record);
    if (!font || ids.has(font.id) || families.has(font.family)) continue;
    admittedBytes += font.byteLength;
    if (!Number.isSafeInteger(admittedBytes) || admittedBytes > MAX_CUSTOM_FONT_TOTAL_BYTES) {
      // Legacy import is best-effort for malformed rows, but never returns a silently truncated
      // prefix when the otherwise-valid library exceeds the canonical logical byte authority.
      return [];
    }
    ids.add(font.id);
    families.add(font.family);
    fonts.push(font);
  }
  return fonts;
}

// ── 저장소 seam ─────────────────────────────────────────────────────────

export interface CustomFontStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** 보안 샌드박스·사생활 보호 모드에서 localStorage 속성 접근 자체가 던지는 경우까지 막는다. */
export function browserCustomFontStorage(): CustomFontStorage | null {
  try {
    return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

/** 저장된 사용자 글꼴 목록. 저장소 부재·읽기 실패·손상 시 []. */
export function listCustomFonts(storage: CustomFontStorage | null | undefined): StudioCustomFont[] {
  if (!storage) return [];
  try {
    return parseCustomFonts(storage.getItem(CUSTOM_FONT_LIBRARY_KEY));
  } catch {
    return [];
  }
}

/** 목록 전체를 한 번에 쓴다. 쿼터 초과·저장소 부재는 false(호출부가 정직하게 안내한다). */
export function saveCustomFonts(
  storage: CustomFontStorage | null | undefined,
  fonts: readonly StudioCustomFont[]
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(CUSTOM_FONT_LIBRARY_KEY, serializeCustomFonts(fonts));
    return true;
  } catch {
    return false;
  }
}

// ── 런타임 등록(FontFace) ────────────────────────────────────────────────

export interface StudioFontFaceLike {
  readonly family: string;
  load(): Promise<unknown>;
}

/** document.fonts의 구조적 최소 계약 — 테스트가 가짜 세트를 넘길 수 있게 좁게 잡는다. */
export interface StudioFontSetLike {
  add(font: StudioFontFaceLike): unknown;
}

export type StudioFontFaceBinarySource = string | ArrayBuffer;

export type StudioFontFaceFactory = (
  family: string,
  source: StudioFontFaceBinarySource,
) => StudioFontFaceLike;

export type StudioCustomFontRegisterResult =
  | { status: "ok"; family: string }
  | { status: "unsupported"; family: string }
  | { status: "failed"; family: string; message: string };

/** 브라우저 기본 seam. FontFace가 없는 환경(구형·jsdom)에서는 null. */
export function browserFontFaceFactory(): StudioFontFaceFactory | null {
  const ctor = (globalThis as {
    FontFace?: new (family: string, source: StudioFontFaceBinarySource) => StudioFontFaceLike;
  })
    .FontFace;
  if (typeof ctor !== "function") return null;
  return (family, source) => new ctor(family, source);
}

/** 브라우저 기본 seam. document.fonts가 없는 환경에서는 null. */
export function browserFontSet(): StudioFontSetLike | null {
  try {
    const fonts = (globalThis as { document?: { fonts?: StudioFontSetLike } }).document?.fonts;
    return fonts && typeof fonts.add === "function" ? fonts : null;
  } catch {
    return null;
  }
}

/**
 * 글꼴 하나를 문서 폰트 집합에 등록한다. 절대 throw하지 않는다 —
 * 손상된 파일 하나가 스튜디오 부팅 전체를 막으면 안 된다.
 */
export async function registerStudioCustomFont(
  font: StudioCustomFont,
  fontSet: StudioFontSetLike | null | undefined,
  createFontFace: StudioFontFaceFactory | null = browserFontFaceFactory()
): Promise<StudioCustomFontRegisterResult> {
  if (!fontSet || !createFontFace) return { status: "unsupported", family: font.family };
  try {
    let source: StudioFontFaceBinarySource;
    if (font.verifiedBytes) {
      source = Uint8Array.from(font.verifiedBytes).buffer;
    } else if (font.dataUrl) {
      source = customFontFaceSource({ dataUrl: font.dataUrl });
    } else {
      throw new Error("검증된 글꼴 바이트가 없습니다.");
    }
    const face = createFontFace(font.family, source);
    await face.load();
    fontSet.add(face);
    return { status: "ok", family: font.family };
  } catch (error) {
    return {
      status: "failed",
      family: font.family,
      message:
        error instanceof Error && error.message
          ? `“${font.family}” 글꼴을 등록하지 못했어요: ${error.message}`
          : `“${font.family}” 글꼴을 등록하지 못했어요. 파일이 손상됐는지 확인해주세요.`,
    };
  }
}

/** 보관함 전체를 등록한다(스튜디오 시작 시 1회). 실패한 항목도 결과 배열에 남는다. */
export async function registerStudioCustomFonts(
  fonts: readonly StudioCustomFont[],
  fontSet: StudioFontSetLike | null | undefined,
  createFontFace: StudioFontFaceFactory | null = browserFontFaceFactory()
): Promise<StudioCustomFontRegisterResult[]> {
  const results: StudioCustomFontRegisterResult[] = [];
  for (const font of fonts) {
    results.push(await registerStudioCustomFont(font, fontSet, createFontFace));
  }
  return results;
}
