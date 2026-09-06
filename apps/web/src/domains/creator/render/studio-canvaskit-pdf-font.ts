/**
 * Studio PDF Font — PDF 벡터 출고에 쓸 글꼴 메트릭 읽기 + 임베드 계획(순수·DOM 무의존).
 *
 * 기존 `studio-custom-fonts.ts` 는 사용자 글꼴 바이너리를 **FontFace 로 브라우저에 등록**하는
 * 데까지만 간다(앞 4바이트 서명 스니핑이 전부). PDF 에 글자를 벡터로 넣으려면 그보다 훨씬
 * 안쪽이 필요하다 — 글리프 인덱스, 전진폭(advance width), unitsPerEm, 그리고 어떤 글리프를
 * 실제로 담을지의 계획. 이 모듈이 그 층이다.
 *
 * ── 읽는 테이블 ─────────────────────────────────────────────────────────────
 *   head  — unitsPerEm, indexToLocFormat, 글꼴 bbox
 *   hhea  — numberOfHMetrics, ascender/descender
 *   maxp  — numGlyphs
 *   hmtx  — 글리프별 전진폭(마지막 longHorMetric 이후는 그 값을 반복 — 스펙 규정)
 *   cmap  — 유니코드 → 글리프 인덱스. format 4(BMP)와 format 12(SMP 이상) 지원.
 *   OS/2  — capHeight/typo 메트릭 + fsType 임베딩 권한(선택). 테이블이 없거나 fsType 이
 *           모순되면 메트릭은 읽되 PDF 임베딩은 fail-closed 로 막는다.
 * `glyf`/`loca`/`CFF ` 아웃라인 자체는 읽지 않는다 — 전체 임베드에서는 원본 바이트를 그대로
 * 스트림에 넣기 때문이다.
 *
 * ── 임베드 전략 두 가지 ─────────────────────────────────────────────────────
 * A. **표준 14 폰트 폴백**(`standard-14`). Helvetica/Times/Courier 계열은 PDF 뷰어가 반드시
 *    갖고 있어야 하는 폰트라 바이트를 넣지 않는다. 라틴 문자만 안전하다(WinAnsiEncoding).
 *    **한글은 낼 수 없다** — 그래서 폴백이지 기본값이 아니다.
 * B. **CIDFontType2 전체 임베드**(`truetype-cid`). 원본 sfnt 바이트를 `FontFile2` 로 통째로 넣고
 *    `Identity-H` 인코딩 + `/W` 폭 배열을 쓴다. 글리프 인덱스를 직접 쓰므로 한글·이모지·합자
 *    무엇이든 **글꼴이 가진 그대로** 나온다. 대가는 크기(한글 TTF 4~8MB).
 *
 * ── 서브셋 계획(구현하지 않은 것과 그 이유) ─────────────────────────────────
 * 진짜 서브셋(쓰인 글리프만 남기고 `glyf`/`loca`/`hmtx`/`cmap` 을 재조립)은 이 모듈이 하지
 * 않는다. `planFontSubset` 은 **계획만** 낸다: 어떤 코드포인트가 쓰였고, 어떤 글리프 id 로
 * 매핑되며, 몇 개가 빠졌고, 전체 대비 몇 퍼센트인지. 구현하려면 추가로 필요한 것:
 *   1) `loca` 를 읽어 글리프별 바이트 구간을 자르고,
 *   2) **합성 글리프**(composite glyf, flag 0x0020 MORE_COMPONENTS)가 참조하는 글리프를 폐포
 *      (transitive closure)로 끌어와야 하며 — 한글 완성형 글꼴이 자모 합성으로 만들어진 경우
 *      이걸 빼먹으면 글자가 조각난다,
 *   3) 새 `loca`(indexToLocFormat 재결정) · `hmtx` · `maxp.numGlyphs` 를 다시 쓰고
 *      테이블 체크섬과 `head.checkSumAdjustment` 를 재계산해야 한다.
 * 이는 별도 슬라이스로 다룰 일이고(권장: CanvasKit 채택과 함께 — Skia 가 서브셋터를 갖고 있다),
 * 그때까지는 "전체 임베드 + 크기 경고" 가 정직한 동작이다. `estimateSubsetSaving` 이 절감
 * 예상치를 돌려주므로 UI 가 "서브셋하면 약 N% 줄어요" 를 미리 말할 수 있다.
 *
 * 전부 순수·결정적. 손상 입력은 예외 대신 `{ ok:false, error }`(한국어).
 */

// ---------------------------------------------------------------------------
// 타입
// ---------------------------------------------------------------------------

export interface StudioSfntMetrics {
  /** em 당 폰트 유닛(보통 1000 또는 2048). */
  unitsPerEm: number;
  numGlyphs: number;
  /** 글리프 인덱스별 전진폭(폰트 유닛). 길이 = numGlyphs. */
  advanceWidths: readonly number[];
  /** 유니코드 코드포인트 → 글리프 인덱스. */
  cmap: ReadonlyMap<number, number>;
  ascender: number;
  descender: number;
  /** [xMin, yMin, xMax, yMax] 폰트 유닛. */
  bbox: readonly [number, number, number, number];
  capHeight: number | null;
  /** CFF(OTTO) 아웃라인이면 true — PDF 에서는 FontFile3 경로가 필요하다. */
  hasCffOutlines: boolean;
  /** OS/2.fsType 에 선언된 임베딩 권한. PDF writer 는 이 정책을 반드시 검사한다. */
  embeddingPolicy: StudioSfntEmbeddingPolicy;
}

export type StudioSfntReadResult = { ok: true; metrics: StudioSfntMetrics } | { ok: false; error: string };

/**
 * OS/2.fsType bits 0..3의 사용 권한.
 *
 * `unknown`은 OS/2 테이블/필드가 없어 권한을 입증할 수 없는 상태, `invalid`는 예약 비트나
 * 상호 배타적인 권한 비트가 함께 켜진 손상·비표준 상태다. 둘 다 임베딩에서는 fail-closed다.
 */
export type StudioSfntEmbeddingPermission =
  | "installable"
  | "restricted"
  | "preview-print"
  | "editable"
  | "unknown"
  | "invalid";

export interface StudioSfntEmbeddingPolicy {
  /** OS/2.fsType 원시 uint16. OS/2 테이블/필드가 없으면 null. */
  fsType: number | null;
  permission: StudioSfntEmbeddingPermission;
  /** bit 8(0x0100): 원본 전체만 임베드할 수 있고 서브셋은 금지. */
  noSubsetting: boolean;
  /** bit 9(0x0200): 내장 비트맵만 가능하고 glyf/CFF 아웃라인 임베드는 금지. */
  bitmapOnly: boolean;
  /** false면 `issue`가 원인을 설명하며 어떤 임베딩 요청도 허용하지 않는다. */
  valid: boolean;
  issue: string | null;
}

export type StudioPdfFontDocumentIntent = "preview-print" | "editable";
export type StudioPdfFontEmbeddingMode = "full" | "subset";
export type StudioPdfFontPayloadKind = "outline" | "bitmap";

export interface StudioPdfFontEmbeddingRequest {
  /**
   * 내보낸 문서를 읽기·인쇄 전용으로 다룰지, 수신자가 텍스트까지 편집할 수 있게 할지.
   * 명시하지 않으면 Preview & Print 권한을 임의로 가정하지 않고 거절한다.
   */
  documentIntent?: StudioPdfFontDocumentIntent;
  embeddingMode: StudioPdfFontEmbeddingMode;
  payloadKind: StudioPdfFontPayloadKind;
}

export type StudioPdfFontEmbeddingDenialCode =
  | "missing-document-intent"
  | "unknown-license"
  | "invalid-fstype"
  | "restricted-license"
  | "preview-print-only"
  | "no-subsetting"
  | "bitmap-only";

export type StudioPdfFontEmbeddingDecision =
  | { allowed: true; policy: StudioSfntEmbeddingPolicy }
  | {
      allowed: false;
      code: StudioPdfFontEmbeddingDenialCode;
      message: string;
      policy: StudioSfntEmbeddingPolicy;
    };

const FSTYPE_USAGE_MASK = 0x000f;
const FSTYPE_NO_SUBSETTING = 0x0100;
const FSTYPE_BITMAP_ONLY = 0x0200;
const FSTYPE_RESERVED_MASK = 0xfcf1;

/**
 * OS/2.fsType uint16을 제품 정책으로 정규화한다.
 *
 * OpenType 규격상 유효한 usage 값은 0, 2, 4, 8뿐이고 예약 비트는 0이어야 한다. 오래된
 * 비표준 폰트가 bit 0을 잘못 쓴 경우도 여기서는 추측해 완화하지 않는다. PDF에 원본 폰트
 * 프로그램을 넣는 행위는 되돌릴 수 없으므로 불명확한 권한은 거절하는 편이 안전하다.
 */
export function parseSfntEmbeddingPolicy(fsType: number | null): StudioSfntEmbeddingPolicy {
  if (fsType === null) {
    return {
      fsType: null,
      permission: "unknown",
      noSubsetting: false,
      bitmapOnly: false,
      valid: false,
      issue: "OS/2 테이블에 fsType 임베딩 권한 정보가 없어요.",
    };
  }
  if (!Number.isInteger(fsType) || fsType < 0 || fsType > 0xffff) {
    return {
      fsType: null,
      permission: "invalid",
      noSubsetting: false,
      bitmapOnly: false,
      valid: false,
      issue: "OS/2.fsType 값이 uint16 범위를 벗어났어요.",
    };
  }

  const usage = fsType & FSTYPE_USAGE_MASK;
  const noSubsetting = (fsType & FSTYPE_NO_SUBSETTING) !== 0;
  const bitmapOnly = (fsType & FSTYPE_BITMAP_ONLY) !== 0;
  if ((fsType & FSTYPE_RESERVED_MASK) !== 0 || (usage !== 0 && usage !== 2 && usage !== 4 && usage !== 8)) {
    return {
      fsType,
      permission: "invalid",
      noSubsetting,
      bitmapOnly,
      valid: false,
      issue: "OS/2.fsType에 예약 비트나 서로 양립할 수 없는 사용 권한이 설정되어 있어요.",
    };
  }

  const permission: StudioSfntEmbeddingPermission =
    usage === 0 ? "installable" : usage === 2 ? "restricted" : usage === 4 ? "preview-print" : "editable";
  return { fsType, permission, noSubsetting, bitmapOnly, valid: true, issue: null };
}

/**
 * 하나의 PDF 폰트 임베딩 요청이 OS/2.fsType을 만족하는지 순수하게 판정한다.
 * 호출부는 `allowed:false`를 경고로만 소비하지 말고 출고를 중단해야 한다.
 */
export function evaluatePdfFontEmbedding(
  policy: StudioSfntEmbeddingPolicy,
  request: StudioPdfFontEmbeddingRequest,
): StudioPdfFontEmbeddingDecision {
  if (!request.documentIntent) {
    return {
      allowed: false,
      code: "missing-document-intent",
      message: "PDF가 읽기·인쇄 전용인지 편집 가능한 문서인지 명시해야 해요.",
      policy,
    };
  }
  if (!policy.valid) {
    return {
      allowed: false,
      code: policy.permission === "unknown" ? "unknown-license" : "invalid-fstype",
      message: policy.issue ?? "글꼴 임베딩 권한을 확인할 수 없어요.",
      policy,
    };
  }
  if (policy.permission === "restricted") {
    return {
      allowed: false,
      code: "restricted-license",
      message: "Restricted License 글꼴은 권리자의 명시적 허락 없이 PDF에 임베드할 수 없어요.",
      policy,
    };
  }
  if (policy.permission === "preview-print" && request.documentIntent === "editable") {
    return {
      allowed: false,
      code: "preview-print-only",
      message: "Preview & Print 글꼴은 읽기·인쇄 전용 PDF에만 임베드할 수 있어요.",
      policy,
    };
  }
  if (policy.noSubsetting && request.embeddingMode === "subset") {
    return {
      allowed: false,
      code: "no-subsetting",
      message: "이 글꼴은 OS/2.fsType에서 서브셋 임베딩을 금지했어요. 원본 전체를 임베드해야 해요.",
      policy,
    };
  }
  if (policy.bitmapOnly && request.payloadKind === "outline") {
    return {
      allowed: false,
      code: "bitmap-only",
      message: "이 글꼴은 내장 비트맵만 임베드할 수 있어 아웃라인 FontFile2/FontFile3로 내보낼 수 없어요.",
      policy,
    };
  }
  return { allowed: true, policy };
}

// ---------------------------------------------------------------------------
// sfnt 읽기
// ---------------------------------------------------------------------------

class SfntError extends Error {}

function sfntFail(message: string): never {
  throw new SfntError(message);
}

function u8(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset >= bytes.byteLength) sfntFail("글꼴 파일이 잘렸어요.");
  return bytes[offset]!;
}

function u16(bytes: Uint8Array, offset: number): number {
  return (u8(bytes, offset) << 8) | u8(bytes, offset + 1);
}

function i16(bytes: Uint8Array, offset: number): number {
  const value = u16(bytes, offset);
  return value > 0x7fff ? value - 0x10000 : value;
}

function u32(bytes: Uint8Array, offset: number): number {
  return ((u16(bytes, offset) << 16) | u16(bytes, offset + 2)) >>> 0;
}

function tag4(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(u8(bytes, offset), u8(bytes, offset + 1), u8(bytes, offset + 2), u8(bytes, offset + 3));
}

/**
 * sfnt(TTF/OTF) 바이트에서 PDF 임베드에 필요한 메트릭만 뽑는다.
 * WOFF/WOFF2/TTC 는 거절한다 — 압축 해제·컬렉션 인덱스 선택이 별도 작업이고, 조용히
 * 잘못된 폰트를 임베드하는 것보다 명확히 거절하는 편이 낫다.
 */
export function readSfntMetrics(input: Uint8Array | ArrayBuffer): StudioSfntReadResult {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  try {
    return { ok: true, metrics: readChecked(bytes) };
  } catch (error) {
    if (error instanceof SfntError) return { ok: false, error: error.message };
    return { ok: false, error: "글꼴 파일을 읽지 못했어요. 파일이 손상됐을 수 있습니다." };
  }
}

function readChecked(bytes: Uint8Array): StudioSfntMetrics {
  if (bytes.byteLength < 12) sfntFail("글꼴 파일이 너무 짧아요.");
  const version = u32(bytes, 0);
  const versionTag = tag4(bytes, 0);
  if (versionTag === "wOFF" || versionTag === "wOF2") {
    sfntFail("WOFF/WOFF2 글꼴은 PDF에 바로 넣을 수 없어요. TTF나 OTF 파일로 다시 올려주세요.");
  }
  if (versionTag === "ttcf") {
    sfntFail("TTC(글꼴 모음) 파일은 지원하지 않아요. 개별 TTF/OTF로 분리해 올려주세요.");
  }
  const hasCffOutlines = versionTag === "OTTO";
  if (version !== 0x00010000 && versionTag !== "true" && !hasCffOutlines) {
    sfntFail("알 수 없는 글꼴 형식이에요(TTF/OTF만 지원합니다).");
  }

  const numTables = u16(bytes, 4);
  // 테이블 개수 위조 방어 — 디렉터리 항목 16바이트가 파일 안에 들어와야 한다.
  if (12 + numTables * 16 > bytes.byteLength) sfntFail("글꼴 테이블 목록이 파일 범위를 벗어나요.");
  const tables = new Map<string, { offset: number; length: number }>();
  for (let i = 0; i < numTables; i++) {
    const base = 12 + i * 16;
    const name = tag4(bytes, base);
    const offset = u32(bytes, base + 8);
    const length = u32(bytes, base + 12);
    if (offset + length > bytes.byteLength) sfntFail(`글꼴 테이블 '${name}'이 파일 끝을 넘어갑니다.`);
    tables.set(name, { offset, length });
  }

  const head = tables.get("head");
  const hhea = tables.get("hhea");
  const maxp = tables.get("maxp");
  if (!head || head.length < 54) sfntFail("글꼴에 head 테이블이 없어요.");
  if (!hhea || hhea.length < 36) sfntFail("글꼴에 hhea 테이블이 없어요.");
  if (!maxp || maxp.length < 6) sfntFail("글꼴에 maxp 테이블이 없어요.");

  const unitsPerEm = u16(bytes, head.offset + 18);
  if (unitsPerEm === 0) sfntFail("글꼴의 unitsPerEm이 0이에요(손상된 head 테이블).");
  const bbox: [number, number, number, number] = [
    i16(bytes, head.offset + 36),
    i16(bytes, head.offset + 38),
    i16(bytes, head.offset + 40),
    i16(bytes, head.offset + 42),
  ];
  const ascender = i16(bytes, hhea.offset + 4);
  const descender = i16(bytes, hhea.offset + 6);
  const numberOfHMetrics = u16(bytes, hhea.offset + 34);
  const numGlyphs = u16(bytes, maxp.offset + 4);
  if (numGlyphs === 0) sfntFail("글꼴에 글리프가 없어요.");
  if (numberOfHMetrics === 0 || numberOfHMetrics > numGlyphs) {
    sfntFail("글꼴의 hmtx 메트릭 개수가 글리프 수와 맞지 않아요.");
  }

  const advanceWidths = readHmtx(bytes, tables.get("hmtx"), numberOfHMetrics, numGlyphs);
  const cmap = readCmap(bytes, tables.get("cmap"));
  const os2 = tables.get("OS/2");
  const embeddingPolicy = parseSfntEmbeddingPolicy(os2 && os2.length >= 10 ? u16(bytes, os2.offset + 8) : null);
  // capHeight 는 OS/2 version 2 이상에서만 유효(offset 88). 그 미만이면 null.
  const capHeight =
    os2 && os2.length >= 90 && u16(bytes, os2.offset) >= 2 ? i16(bytes, os2.offset + 88) : null;

  return {
    unitsPerEm,
    numGlyphs,
    advanceWidths,
    cmap,
    ascender,
    descender,
    bbox,
    capHeight,
    hasCffOutlines,
    embeddingPolicy,
  };
}

function readHmtx(
  bytes: Uint8Array,
  hmtx: { offset: number; length: number } | undefined,
  numberOfHMetrics: number,
  numGlyphs: number,
): number[] {
  const widths = new Array<number>(numGlyphs).fill(0);
  if (!hmtx) return widths;
  if (hmtx.length < numberOfHMetrics * 4) sfntFail("글꼴의 hmtx 테이블이 잘렸어요.");
  let last = 0;
  for (let i = 0; i < numberOfHMetrics; i++) {
    last = u16(bytes, hmtx.offset + i * 4);
    widths[i] = last;
  }
  // 스펙: numberOfHMetrics 이후 글리프는 마지막 전진폭을 그대로 쓴다(단조 폭 글꼴 절약).
  for (let i = numberOfHMetrics; i < numGlyphs; i++) widths[i] = last;
  return widths;
}

function readCmap(bytes: Uint8Array, cmap: { offset: number; length: number } | undefined): Map<number, number> {
  const map = new Map<number, number>();
  if (!cmap || cmap.length < 4) return map;
  const numSubtables = u16(bytes, cmap.offset + 2);
  if (4 + numSubtables * 8 > cmap.length) sfntFail("글꼴의 cmap 서브테이블 목록이 잘렸어요.");
  let best: { offset: number; score: number } | null = null;
  for (let i = 0; i < numSubtables; i++) {
    const base = cmap.offset + 4 + i * 8;
    const platform = u16(bytes, base);
    const encoding = u16(bytes, base + 2);
    const offset = cmap.offset + u32(bytes, base + 4);
    if (offset + 4 > bytes.byteLength) continue;
    // 선호 순위: (3,10) UCS-4 > (3,1) BMP > (0,x) 유니코드 > 나머지.
    const score =
      platform === 3 && encoding === 10 ? 4 : platform === 3 && encoding === 1 ? 3 : platform === 0 ? 2 : 1;
    if (!best || score > best.score) best = { offset, score };
  }
  if (!best) return map;
  const format = u16(bytes, best.offset);
  if (format === 4) readCmapFormat4(bytes, best.offset, map);
  else if (format === 12) readCmapFormat12(bytes, best.offset, map);
  return map;
}

function readCmapFormat4(bytes: Uint8Array, offset: number, map: Map<number, number>): void {
  const segCountX2 = u16(bytes, offset + 6);
  const segCount = segCountX2 >> 1;
  const endBase = offset + 14;
  const startBase = endBase + segCountX2 + 2;
  const deltaBase = startBase + segCountX2;
  const rangeBase = deltaBase + segCountX2;
  for (let s = 0; s < segCount; s++) {
    const end = u16(bytes, endBase + s * 2);
    const start = u16(bytes, startBase + s * 2);
    if (start > end) continue;
    const delta = u16(bytes, deltaBase + s * 2);
    const rangeOffset = u16(bytes, rangeBase + s * 2);
    for (let code = start; code <= end && code !== 0xffff; code++) {
      let glyph: number;
      if (rangeOffset === 0) {
        glyph = (code + delta) & 0xffff;
      } else {
        const glyphIndexAddress = rangeBase + s * 2 + rangeOffset + (code - start) * 2;
        if (glyphIndexAddress + 1 >= bytes.byteLength) continue;
        const raw = u16(bytes, glyphIndexAddress);
        glyph = raw === 0 ? 0 : (raw + delta) & 0xffff;
      }
      if (glyph !== 0) map.set(code, glyph);
    }
  }
}

function readCmapFormat12(bytes: Uint8Array, offset: number, map: Map<number, number>): void {
  const numGroups = u32(bytes, offset + 12);
  // 그룹 개수 위조 방어.
  if (offset + 16 + numGroups * 12 > bytes.byteLength) sfntFail("글꼴의 cmap format 12 그룹이 잘렸어요.");
  for (let g = 0; g < numGroups; g++) {
    const base = offset + 16 + g * 12;
    const start = u32(bytes, base);
    const end = u32(bytes, base + 4);
    const startGlyph = u32(bytes, base + 8);
    if (end < start) continue;
    // 한 그룹이 코드포인트 공간 전체를 덮는다고 주장할 수 있다 — 유니코드 상한으로 조인다.
    const cappedEnd = Math.min(end, 0x10ffff);
    for (let code = start; code <= cappedEnd; code++) {
      map.set(code, startGlyph + (code - start));
    }
  }
}

// ---------------------------------------------------------------------------
// 서브셋 계획
// ---------------------------------------------------------------------------

export interface StudioFontSubsetPlan {
  /** 실제로 쓰인 코드포인트(정렬됨 — 결정적 출력). */
  codepoints: readonly number[];
  /** 쓰인 글리프 인덱스(정렬됨, 0=.notdef 포함). */
  glyphIds: readonly number[];
  /** 글꼴에 없어서 .notdef 로 떨어질 코드포인트. */
  missing: readonly number[];
  /** 전체 글리프 대비 사용 비율(0..1). */
  coverage: number;
  /** 한국어 요약 — UI 가 그대로 노출한다. */
  summary: string;
}

/**
 * 텍스트에 실제로 쓰인 글리프를 집계한다(서로게이트 쌍을 코드포인트로 합쳐 센다).
 * 결과는 정렬해 돌려주므로 같은 입력이면 같은 배열이다(결정성).
 */
export function planFontSubset(metrics: StudioSfntMetrics, texts: readonly string[]): StudioFontSubsetPlan {
  const codepoints = new Set<number>();
  for (const text of texts) {
    for (const char of text) {
      const code = char.codePointAt(0);
      if (code !== undefined) codepoints.add(code);
    }
  }
  const glyphIds = new Set<number>([0]);
  const missing: number[] = [];
  for (const code of codepoints) {
    const glyph = metrics.cmap.get(code);
    if (glyph === undefined) missing.push(code);
    else glyphIds.add(glyph);
  }
  // 세 배열 모두 정렬해서 낸다 — Set 순회는 삽입 순서라 입력 순서만 바뀌어도 결과 배열이
  // 달라지고, 그러면 "같은 글자를 쓰는 두 페이지" 가 다른 계획을 낸다.
  missing.sort((a, b) => a - b);
  const sortedCodepoints = [...codepoints].sort((a, b) => a - b);
  const sortedGlyphs = [...glyphIds].sort((a, b) => a - b);
  const coverage = metrics.numGlyphs === 0 ? 0 : sortedGlyphs.length / metrics.numGlyphs;
  const summary =
    missing.length === 0
      ? `글자 ${sortedCodepoints.length}종 · 글리프 ${sortedGlyphs.length}개(전체의 ${(coverage * 100).toFixed(1)}%)를 씁니다.`
      : `글자 ${sortedCodepoints.length}종 중 ${missing.length}종이 이 글꼴에 없어 빈 글자로 나옵니다.`;
  return { codepoints: sortedCodepoints, glyphIds: sortedGlyphs, missing, coverage, summary };
}

/**
 * 서브셋했을 때의 대략적 절감 — 아웃라인 데이터가 파일 크기를 지배한다는 가정 위의 **추정치**다
 * (헤더·cmap·이름 테이블은 줄지 않으므로 하한을 0.85배로 둔다). 정확한 수는 실제 서브셋터가
 * 나와야 알 수 있고, 그래서 이름이 `estimate` 다.
 */
export function estimateSubsetSaving(plan: StudioFontSubsetPlan, fontByteLength: number): {
  estimatedBytes: number;
  savedRatio: number;
  note: string;
} {
  const retained = Math.min(1, Math.max(plan.coverage, 0));
  const estimatedBytes = Math.round(fontByteLength * (0.15 + 0.85 * retained));
  const savedRatio = fontByteLength === 0 ? 0 : 1 - estimatedBytes / fontByteLength;
  return {
    estimatedBytes,
    savedRatio,
    note: `서브셋 기능이 붙으면 약 ${Math.round(savedRatio * 100)}% 작아질 것으로 보입니다(추정치).`,
  };
}

// ---------------------------------------------------------------------------
// 표준 14 폰트 폴백
// ---------------------------------------------------------------------------

export type StudioStandardFontName =
  | "Helvetica"
  | "Helvetica-Bold"
  | "Helvetica-Oblique"
  | "Helvetica-BoldOblique"
  | "Times-Roman"
  | "Times-Bold"
  | "Times-Italic"
  | "Times-BoldItalic"
  | "Courier"
  | "Courier-Bold"
  | "Symbol"
  | "ZapfDingbats";

export const STUDIO_STANDARD_FONT_NAMES: readonly StudioStandardFontName[] = [
  "Helvetica",
  "Helvetica-Bold",
  "Helvetica-Oblique",
  "Helvetica-BoldOblique",
  "Times-Roman",
  "Times-Bold",
  "Times-Italic",
  "Times-BoldItalic",
  "Courier",
  "Courier-Bold",
  "Symbol",
  "ZapfDingbats",
];

/**
 * CSS font-family 문자열 → 표준 14 폰트 폴백. 굵기·기울임 신호를 이름에서 읽는다.
 * **의도적으로 한글 폰트를 매핑하지 않는다** — 표준 14 로는 한글을 낼 수 없으므로, 한글이
 * 섞이면 호출부가 `truetype-cid` 임베드를 요구해야 한다(`textNeedsEmbeddedFont` 참고).
 */
export function resolveStandardFontFallback(family: string, bold = false, italic = false): StudioStandardFontName {
  const name = family.toLowerCase();
  const serif = name.includes("serif") && !name.includes("sans");
  const mono = name.includes("mono") || name.includes("courier");
  if (mono) return bold ? "Courier-Bold" : "Courier";
  if (serif) {
    if (bold && italic) return "Times-BoldItalic";
    if (bold) return "Times-Bold";
    if (italic) return "Times-Italic";
    return "Times-Roman";
  }
  if (bold && italic) return "Helvetica-BoldOblique";
  if (bold) return "Helvetica-Bold";
  if (italic) return "Helvetica-Oblique";
  return "Helvetica";
}

/**
 * 표준 14 폰트로 낼 수 없는 문자가 있는지. WinAnsiEncoding(≈ CP1252)을 벗어나면 true.
 * 한글은 전부 여기 걸린다 — 웹툰 스튜디오에서는 사실상 항상 임베드가 필요하다는 뜻이고,
 * 그 사실을 UI 가 미리 말해야 하므로 별도 함수로 뽑았다.
 */
export function textNeedsEmbeddedFont(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code > 0xff) return true;
    // CP1252 의 0x80~0x9F 특수 구간은 WinAnsi 로 표현되지만 0x7F~0x9F 원시 제어문자는 아니다.
    if (code >= 0x7f && code <= 0x9f) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// PDF 임베드 서술자 — `studio-canvaskit-pdf-vector.ts` 가 오브젝트로 바꾼다.
// ---------------------------------------------------------------------------

export type StudioPdfFontResource =
  | {
      kind: "standard-14";
      /** 콘텐츠 스트림에서 쓸 리소스 이름(예: "F0"). */
      resourceName: string;
      baseFont: StudioStandardFontName;
    }
  | {
      kind: "truetype-cid";
      resourceName: string;
      /** PostScript 이름으로 쓸 값(ASCII, 공백 없음). */
      baseFont: string;
      /** 원본 sfnt 바이트 — 그대로 FontFile2 스트림이 된다. */
      fontBytes: Uint8Array;
      metrics: StudioSfntMetrics;
      /** 이 폰트로 그릴 글리프 id 집합(‐ /W 배열 범위를 정한다). */
      usedGlyphIds: readonly number[];
    };

/** 1000 유닛/em 정규화 폭 — PDF 의 글리프 공간은 항상 1/1000 em 이다. */
export function glyphWidthToPdf(metrics: StudioSfntMetrics, glyphId: number): number {
  const raw = metrics.advanceWidths[glyphId] ?? 0;
  return Math.round((raw * 1000) / metrics.unitsPerEm);
}

/**
 * `/W` 배열 문자열 — `[ gid [w w w] gid [w] ... ]`. 연속 글리프는 한 묶음으로 합쳐 크기를 줄인다.
 * 정렬된 입력을 요구하지 않는다(내부에서 정렬) — 결정적 출력.
 */
export function buildCidWidthArray(resource: Extract<StudioPdfFontResource, { kind: "truetype-cid" }>): string {
  const ids = [...new Set(resource.usedGlyphIds)].sort((a, b) => a - b);
  if (ids.length === 0) return "[]";
  const parts: string[] = [];
  let index = 0;
  while (index < ids.length) {
    const start = ids[index]!;
    const widths: number[] = [glyphWidthToPdf(resource.metrics, start)];
    let next = index + 1;
    while (next < ids.length && ids[next] === ids[next - 1]! + 1) {
      widths.push(glyphWidthToPdf(resource.metrics, ids[next]!));
      next++;
    }
    parts.push(`${start} [${widths.join(" ")}]`);
    index = next;
  }
  return `[${parts.join(" ")}]`;
}

/**
 * 텍스트를 CID(=글리프 인덱스) 16비트 빅엔디언 hex 문자열로. Identity-H 인코딩의 요구 형식이다.
 * 글꼴에 없는 문자는 0(.notdef)으로 떨어지며, 그 사실은 `planFontSubset().missing` 이 이미 알린다.
 */
export function encodeIdentityHText(metrics: StudioSfntMetrics, text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    const glyph = metrics.cmap.get(code) ?? 0;
    out += glyph.toString(16).toUpperCase().padStart(4, "0");
  }
  return out;
}

/** FontDescriptor 의 /Flags 비트(1=FixedPitch, 2=Serif, 4=Symbolic, 32=Nonsymbolic, 64=Italic). */
export function fontDescriptorFlags(options: { fixedPitch?: boolean; serif?: boolean; italic?: boolean; symbolic?: boolean }): number {
  let flags = 0;
  if (options.fixedPitch) flags |= 1;
  if (options.serif) flags |= 2;
  flags |= options.symbolic ? 4 : 32;
  if (options.italic) flags |= 64;
  return flags;
}
