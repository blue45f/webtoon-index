/**
 * Studio ICC Profile — ICC.1 프로파일 **읽기** 코어(순수·DOM 무의존).
 *
 * 왜 필요한가: 인쇄소는 "이 프로파일로 넘겨주세요" 라며 .icc 파일을 준다. 그 파일에서 최소한
 *  (1) 어떤 장치 클래스·색공간인지, (2) 렌더링 인텐트가 무엇인지, (3) 우리가 실제로 변환에 쓸 수
 *  있는 종류인지를 **정직하게** 판별할 수 있어야 한다. 이 모듈이 그 판별기다.
 *
 * ── 지원 범위(의도적으로 좁다) ──────────────────────────────────────────────
 *  ✅ 헤더 128바이트 전체(크기·버전·장치클래스·색공간·PCS·서명·렌더링 인텐트·PCS 조명·플래그).
 *  ✅ 태그 테이블(개수·시그니처·오프셋·크기)과 범위 검증.
 *  ✅ 태그 타입: `XYZ `(XYZType), `curv`(curveType: 항등/감마/테이블), `para`(parametricCurveType
 *     타입 0~4), `text`, `desc`(textDescriptionType), `mluc`(multiLocalizedUnicodeType).
 *  ✅ **매트릭스/TRC RGB 프로파일** → 실제로 쓸 수 있는 `RGB → XYZ(D50)` 변환을 만들어 준다.
 *  ❌ **LUT 기반 프로파일**(`A2B0`/`B2A0` = `mft1`/`mft2`/`mAB `/`mBA `) → 파싱은 하되
 *     `transform: null` + `unsupportedReason` 을 돌려준다. 실제 CMYK 출력 프로파일은 거의 전부
 *     이쪽이다 — **그래서 이 저장소는 "ICC 기반 CMYK 교정" 을 한다고 말하지 않는다.**
 *     (`studio-canvaskit-cmyk-core.ts` 의 §정직성 규약과 같은 선.)
 *
 * ── 손상 입력 방어 ──────────────────────────────────────────────────────────
 * 프로파일은 사용자가 아무 파일이나 끌어다 놓을 수 있는 신뢰 불가 바이너리다. 모든 읽기는
 * 길이 검사를 통과해야 하고, 어긋나면 예외 대신 `{ ok: false, error }` 를 돌려준다
 * (한국어 사유). 특히 다음을 명시적으로 막는다:
 *   - 128바이트 미만 / `acsp` 서명 없음
 *   - 헤더의 profileSize 가 실제 바이트 수와 불일치(잘림·덧붙임)
 *   - 태그 개수가 남은 바이트로 담을 수 없는 값(개수 위조로 인한 대용량 할당 유도)
 *   - 태그 오프셋/크기가 파일 밖이거나 헤더(0..127)를 침범
 *   - 곡선 포인트 수가 태그 크기를 초과
 *
 * 모든 함수는 순수·결정적이다. 시간·난수·DOM 없음.
 */

// ---------------------------------------------------------------------------
// 공개 타입
// ---------------------------------------------------------------------------

/** ICC 렌더링 인텐트(헤더 오프셋 64, uint32). */
export type StudioIccRenderingIntent = "perceptual" | "media-relative" | "saturation" | "icc-absolute";

export const STUDIO_ICC_RENDERING_INTENTS: readonly StudioIccRenderingIntent[] = [
  "perceptual",
  "media-relative",
  "saturation",
  "icc-absolute",
];

/** 렌더링 인텐트 한국어 라벨 — 인쇄 대화에서 실제로 쓰이는 표현. */
export const STUDIO_ICC_RENDERING_INTENT_LABELS: Readonly<Record<StudioIccRenderingIntent, string>> = {
  perceptual: "지각적 (사진·그림 기본값)",
  "media-relative": "상대색도 (백색 맞춤)",
  saturation: "채도 (그래프·도표)",
  "icc-absolute": "절대색도 (교정쇄 시뮬레이션)",
};

/** 프로파일이 우리 변환 파이프라인에서 쓸 수 있는 형태인지. */
export type StudioIccProfileKind = "matrix-trc-rgb" | "gray-trc" | "lut-based" | "unsupported";

export interface StudioIccCurve {
  /** `identity` = 곡선 데이터 없음(감마 1.0), `gamma` = 단일 지수, `table` = 균등 샘플 배열. */
  kind: "identity" | "gamma" | "table" | "parametric";
  /** kind === "gamma" 일 때 지수. */
  gamma?: number;
  /** kind === "table" 일 때 0..1 정규화 샘플(최소 2개). */
  table?: readonly number[];
  /** kind === "parametric" 일 때 ICC parametricCurveType 함수 타입(0..4). */
  functionType?: number;
  /** kind === "parametric" 일 때 파라미터 [g, a, b, c, d, e, f] 중 타입이 쓰는 앞부분. */
  params?: readonly number[];
}

export interface StudioIccTag {
  signature: string;
  offset: number;
  size: number;
}

export interface StudioIccHeader {
  /** 헤더가 주장하는 전체 바이트 수. */
  profileSize: number;
  /** 예: "4.3.0". */
  version: string;
  /** 'mntr' | 'prtr' | 'scnr' | 'link' | 'spac' | 'abst' | 'nmcl'. */
  deviceClass: string;
  /** 데이터 색공간: 'RGB ' | 'CMYK' | 'GRAY' | 'Lab ' 등(4바이트 원문 그대로, 공백 포함). */
  dataColorSpace: string;
  /** 연결 색공간(PCS): 보통 'XYZ ' 또는 'Lab '. */
  pcs: string;
  /** 'acsp' 고정 — 아니면 파싱 자체가 실패한다. */
  signature: string;
  renderingIntent: StudioIccRenderingIntent;
  /** 헤더가 기록한 PCS 조명 XYZ(사실상 항상 D50). */
  pcsIlluminant: { x: number; y: number; z: number };
  creator: string;
  /** 제조사 시그니처(공백 제거). */
  manufacturer: string;
}

export interface StudioIccMatrixTrc {
  /** 열이 R/G/B 원색인 3×3 RGB→XYZ(D50) 행렬. */
  matrix: readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]];
  redTrc: StudioIccCurve;
  greenTrc: StudioIccCurve;
  blueTrc: StudioIccCurve;
  whitePoint: { x: number; y: number; z: number };
}

export interface StudioIccProfile {
  header: StudioIccHeader;
  tags: readonly StudioIccTag[];
  /** 프로파일 설명(`desc`/`mluc`) — 없으면 빈 문자열. */
  description: string;
  copyright: string;
  kind: StudioIccProfileKind;
  /** kind === "matrix-trc-rgb" 일 때만 채워진다. */
  matrixTrc: StudioIccMatrixTrc | null;
  /**
   * 변환에 쓸 수 없는 이유(한국어). 쓸 수 있으면 null.
   * LUT 기반 CMYK 프로파일은 여기에 "미지원" 사유가 들어간다 — 조용히 근사하지 않는다.
   */
  unsupportedReason: string | null;
}

export type StudioIccParseResult =
  | { ok: true; profile: StudioIccProfile }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// 바이트 읽기 헬퍼 — 전부 경계 검사를 통과해야 값을 돌려준다.
// ---------------------------------------------------------------------------

class IccParseError extends Error {}

function fail(message: string): never {
  throw new IccParseError(message);
}

function requireRange(bytes: Uint8Array, offset: number, length: number, what: string): void {
  if (!Number.isInteger(offset) || offset < 0 || length < 0 || offset + length > bytes.byteLength) {
    fail(`ICC 프로파일이 손상됐어요(${what} 위치가 파일 범위를 벗어납니다).`);
  }
}

function readUint32(bytes: Uint8Array, offset: number): number {
  requireRange(bytes, offset, 4, "32비트 값");
  return (
    ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0
  );
}

function readUint16(bytes: Uint8Array, offset: number): number {
  requireRange(bytes, offset, 2, "16비트 값");
  return (bytes[offset]! << 8) | bytes[offset + 1]!;
}

/** s15Fixed16Number → double. 부호 있는 32비트를 65536 으로 나눈다. */
function readS15Fixed16(bytes: Uint8Array, offset: number): number {
  const raw = readUint32(bytes, offset);
  return (raw > 0x7fffffff ? raw - 0x100000000 : raw) / 65536;
}

function readSignature(bytes: Uint8Array, offset: number): string {
  requireRange(bytes, offset, 4, "시그니처");
  let out = "";
  for (let i = 0; i < 4; i++) {
    const code = bytes[offset + i]!;
    // 제어문자는 프로파일 시그니처에 올 수 없다 — 위조 탐지 겸 로그 오염 방지.
    out += code >= 0x20 && code <= 0x7e ? String.fromCharCode(code) : " ";
  }
  return out;
}

// ---------------------------------------------------------------------------
// 파싱
// ---------------------------------------------------------------------------

const ICC_HEADER_SIZE = 128;
const ICC_FILE_SIGNATURE = "acsp";
/** 태그 하나당 12바이트. 남은 바이트로 담을 수 없는 개수는 위조로 본다. */
const ICC_TAG_ENTRY_SIZE = 12;

const RENDERING_INTENTS: readonly StudioIccRenderingIntent[] = [
  "perceptual",
  "media-relative",
  "saturation",
  "icc-absolute",
];

/** LUT 기반 변환 태그 타입 — 우리가 실행할 수 없는 것들. */
const LUT_TAG_TYPES = new Set(["mft1", "mft2", "mAB ", "mBA "]);

/**
 * ICC 바이트 → 프로파일. 실패는 예외가 아니라 `{ ok:false, error }` 로 돌려준다
 * (사용자가 끌어다 놓은 아무 파일이나 들어올 수 있어, 호출부가 한국어 사유를 그대로 띄운다).
 */
export function parseIccProfile(input: Uint8Array | ArrayBuffer): StudioIccParseResult {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  try {
    return { ok: true, profile: parseChecked(bytes) };
  } catch (error) {
    if (error instanceof IccParseError) return { ok: false, error: error.message };
    return { ok: false, error: "ICC 프로파일을 읽지 못했어요. 파일이 손상됐을 수 있습니다." };
  }
}

function parseChecked(bytes: Uint8Array): StudioIccProfile {
  if (bytes.byteLength < ICC_HEADER_SIZE) {
    fail("ICC 프로파일이 너무 짧아요(헤더 128바이트에 못 미칩니다).");
  }
  const signature = readSignature(bytes, 36);
  if (signature !== ICC_FILE_SIGNATURE) {
    fail("ICC 프로파일이 아니에요('acsp' 서명이 없습니다).");
  }
  const profileSize = readUint32(bytes, 0);
  if (profileSize !== bytes.byteLength) {
    fail(
      `ICC 프로파일 크기가 맞지 않아요(헤더는 ${profileSize}바이트라고 하는데 실제는 ${bytes.byteLength}바이트입니다).`,
    );
  }

  const versionRaw = readUint32(bytes, 8);
  const header: StudioIccHeader = {
    profileSize,
    version: `${(versionRaw >>> 24) & 0xff}.${(versionRaw >>> 20) & 0x0f}.${(versionRaw >>> 16) & 0x0f}`,
    deviceClass: readSignature(bytes, 12),
    dataColorSpace: readSignature(bytes, 16),
    pcs: readSignature(bytes, 20),
    signature,
    renderingIntent: RENDERING_INTENTS[readUint32(bytes, 64)] ?? "perceptual",
    pcsIlluminant: {
      x: readS15Fixed16(bytes, 68),
      y: readS15Fixed16(bytes, 72),
      z: readS15Fixed16(bytes, 76),
    },
    creator: readSignature(bytes, 80).trim(),
    manufacturer: readSignature(bytes, 48).trim(),
  };

  const tagCount = readUint32(bytes, ICC_HEADER_SIZE);
  const tableBytes = bytes.byteLength - ICC_HEADER_SIZE - 4;
  if (tagCount > Math.max(0, Math.floor(tableBytes / ICC_TAG_ENTRY_SIZE))) {
    fail(`ICC 태그 개수(${tagCount})가 파일 크기와 맞지 않아요.`);
  }
  const tags: StudioIccTag[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < tagCount; i++) {
    const base = ICC_HEADER_SIZE + 4 + i * ICC_TAG_ENTRY_SIZE;
    const tagSignature = readSignature(bytes, base);
    const offset = readUint32(bytes, base + 4);
    const size = readUint32(bytes, base + 8);
    if (offset < ICC_HEADER_SIZE) {
      fail(`ICC 태그 '${tagSignature}'의 위치가 헤더 영역을 침범합니다.`);
    }
    if (offset + size > bytes.byteLength) {
      fail(`ICC 태그 '${tagSignature}'가 파일 끝을 넘어갑니다.`);
    }
    // 같은 시그니처가 두 번 나오면 어느 쪽이 진짜인지 정의되지 않는다 — 첫 번째만 채택하고 무시.
    if (seen.has(tagSignature)) continue;
    seen.add(tagSignature);
    tags.push({ signature: tagSignature, offset, size });
  }

  const tagMap = new Map(tags.map((tag) => [tag.signature, tag]));
  const description = readTextTag(bytes, tagMap.get("desc")) ?? readTextTag(bytes, tagMap.get("dmdd")) ?? "";
  const copyright = readTextTag(bytes, tagMap.get("cprt")) ?? "";

  const hasLut = tags.some((tag) => {
    if (tag.size < 4) return false;
    return LUT_TAG_TYPES.has(readSignature(bytes, tag.offset));
  });

  let kind: StudioIccProfileKind = "unsupported";
  let matrixTrc: StudioIccMatrixTrc | null = null;
  let unsupportedReason: string | null = null;

  const hasMatrix = tagMap.has("rXYZ") && tagMap.has("gXYZ") && tagMap.has("bXYZ");
  if (hasMatrix && header.dataColorSpace.trim() === "RGB") {
    matrixTrc = {
      matrix: buildMatrix(bytes, tagMap),
      redTrc: readCurveTag(bytes, tagMap.get("rTRC")),
      greenTrc: readCurveTag(bytes, tagMap.get("gTRC")),
      blueTrc: readCurveTag(bytes, tagMap.get("bTRC")),
      whitePoint: readXyzTag(bytes, tagMap.get("wtpt")) ?? { x: 0.9642, y: 1, z: 0.8249 },
    };
    kind = "matrix-trc-rgb";
  } else if (header.dataColorSpace.trim() === "GRAY" && tagMap.has("kTRC")) {
    kind = "gray-trc";
    unsupportedReason = "회색조 프로파일입니다. 색 변환 대신 톤 곡선만 읽을 수 있어요.";
  } else if (hasLut) {
    kind = "lut-based";
    unsupportedReason =
      "LUT(A2B/B2A) 기반 프로파일이라 이 앱에서 색 변환을 실행할 수 없어요. 헤더와 렌더링 인텐트만 읽었습니다.";
  } else {
    unsupportedReason = "이 앱이 실행할 수 있는 변환 태그(매트릭스/TRC 또는 LUT)가 없는 프로파일입니다.";
  }

  return { header, tags, description, copyright, kind, matrixTrc, unsupportedReason };
}

function buildMatrix(
  bytes: Uint8Array,
  tagMap: Map<string, StudioIccTag>,
): StudioIccMatrixTrc["matrix"] {
  const red = readXyzTag(bytes, tagMap.get("rXYZ"));
  const green = readXyzTag(bytes, tagMap.get("gXYZ"));
  const blue = readXyzTag(bytes, tagMap.get("bXYZ"));
  if (!red || !green || !blue) fail("ICC 매트릭스 태그(rXYZ/gXYZ/bXYZ)를 읽지 못했어요.");
  return [
    [red.x, green.x, blue.x],
    [red.y, green.y, blue.y],
    [red.z, green.z, blue.z],
  ];
}

function readXyzTag(bytes: Uint8Array, tag: StudioIccTag | undefined): { x: number; y: number; z: number } | null {
  if (!tag) return null;
  if (tag.size < 20) fail(`ICC XYZ 태그 '${tag.signature}'가 너무 짧아요.`);
  if (readSignature(bytes, tag.offset) !== "XYZ ") {
    fail(`ICC 태그 '${tag.signature}'의 타입이 XYZ가 아니에요.`);
  }
  return {
    x: readS15Fixed16(bytes, tag.offset + 8),
    y: readS15Fixed16(bytes, tag.offset + 12),
    z: readS15Fixed16(bytes, tag.offset + 16),
  };
}

/** parametricCurveType 함수 타입별 파라미터 개수(ICC.1:2010 표 65). */
const PARAMETRIC_PARAM_COUNTS: readonly number[] = [1, 3, 4, 5, 7];

function readCurveTag(bytes: Uint8Array, tag: StudioIccTag | undefined): StudioIccCurve {
  if (!tag || tag.size < 8) return { kind: "identity" };
  const type = readSignature(bytes, tag.offset);
  if (type === "para") {
    const functionType = readUint16(bytes, tag.offset + 8);
    const count = PARAMETRIC_PARAM_COUNTS[functionType];
    if (count === undefined) fail(`알 수 없는 ICC 파라메트릭 곡선 타입(${functionType})이에요.`);
    if (tag.size < 12 + count * 4) fail("ICC 파라메트릭 곡선 태그가 잘렸어요.");
    const params: number[] = [];
    for (let i = 0; i < count; i++) params.push(readS15Fixed16(bytes, tag.offset + 12 + i * 4));
    return { kind: "parametric", functionType, params };
  }
  if (type !== "curv") fail(`ICC 태그 '${tag.signature}'의 타입이 곡선(curv/para)이 아니에요.`);
  const count = readUint32(bytes, tag.offset + 8);
  if (count === 0) return { kind: "identity" };
  // 포인트 수 위조 방어 — 선언한 개수가 태그 크기 안에 들어와야 한다.
  if (12 + count * 2 > tag.size) fail("ICC 곡선 태그의 포인트 수가 태그 크기를 넘습니다.");
  if (count === 1) {
    // u8Fixed8Number 감마.
    return { kind: "gamma", gamma: readUint16(bytes, tag.offset + 12) / 256 };
  }
  const table: number[] = [];
  for (let i = 0; i < count; i++) table.push(readUint16(bytes, tag.offset + 12 + i * 2) / 65535);
  return { kind: "table", table };
}

/** `desc`(textDescriptionType) · `mluc` · `text` 를 읽어 사람이 읽는 문자열로. */
function readTextTag(bytes: Uint8Array, tag: StudioIccTag | undefined): string | null {
  if (!tag || tag.size < 8) return null;
  const type = readSignature(bytes, tag.offset);
  if (type === "text") {
    return asciiSlice(bytes, tag.offset + 8, tag.size - 8);
  }
  if (type === "desc") {
    if (tag.size < 12) return null;
    const asciiLength = readUint32(bytes, tag.offset + 8);
    if (asciiLength === 0 || 12 + asciiLength > tag.size) return null;
    return asciiSlice(bytes, tag.offset + 12, asciiLength);
  }
  if (type === "mluc") {
    if (tag.size < 16) return null;
    const records = readUint32(bytes, tag.offset + 8);
    if (records === 0) return null;
    const recordSize = readUint32(bytes, tag.offset + 12);
    if (recordSize < 12 || 16 + recordSize > tag.size) return null;
    const length = readUint32(bytes, tag.offset + 20);
    const offset = readUint32(bytes, tag.offset + 24);
    if (offset + length > tag.size) return null;
    // UTF-16BE.
    let out = "";
    for (let i = 0; i + 1 < length; i += 2) {
      out += String.fromCharCode(readUint16(bytes, tag.offset + offset + i));
    }
    return out.replace(/\0+$/u, "");
  }
  return null;
}

function asciiSlice(bytes: Uint8Array, offset: number, length: number): string {
  requireRange(bytes, offset, length, "문자열");
  let out = "";
  for (let i = 0; i < length; i++) {
    const code = bytes[offset + i]!;
    if (code === 0) break;
    out += String.fromCharCode(code);
  }
  return out;
}

// ---------------------------------------------------------------------------
// TRC 곡선 평가
// ---------------------------------------------------------------------------

/**
 * 곡선을 0..1 입력에 적용한다(장치값 → 선형).
 * `table` 은 균등 간격 샘플이라 선형 보간한다(ICC 권장 — 곡선은 원래 조밀하다).
 * `parametric` 은 ICC.1:2010 표 65 의 정의를 그대로 따른다.
 */
export function evaluateIccCurve(curve: StudioIccCurve, input: number): number {
  const x = input < 0 ? 0 : input > 1 ? 1 : input;
  switch (curve.kind) {
    case "identity":
      return x;
    case "gamma":
      return x ** (curve.gamma ?? 1);
    case "table": {
      const table = curve.table;
      if (!table || table.length === 0) return x;
      if (table.length === 1) return table[0]!;
      const position = x * (table.length - 1);
      const index = Math.min(table.length - 2, Math.floor(position));
      const fraction = position - index;
      return table[index]! * (1 - fraction) + table[index + 1]! * fraction;
    }
    case "parametric":
      return evaluateParametric(curve, x);
    default:
      return x;
  }
}

function evaluateParametric(curve: StudioIccCurve, x: number): number {
  const p = curve.params ?? [];
  const g = p[0] ?? 1;
  switch (curve.functionType) {
    case 0:
      return x ** g;
    case 1: {
      const a = p[1] ?? 1;
      const b = p[2] ?? 0;
      return x >= -b / a ? (a * x + b) ** g : 0;
    }
    case 2: {
      const a = p[1] ?? 1;
      const b = p[2] ?? 0;
      const c = p[3] ?? 0;
      return x >= -b / a ? (a * x + b) ** g + c : c;
    }
    case 3: {
      const a = p[1] ?? 1;
      const b = p[2] ?? 0;
      const c = p[3] ?? 0;
      const d = p[4] ?? 0;
      return x >= d ? (a * x + b) ** g : c * x;
    }
    case 4: {
      const a = p[1] ?? 1;
      const b = p[2] ?? 0;
      const c = p[3] ?? 0;
      const d = p[4] ?? 0;
      const e = p[5] ?? 0;
      const f = p[6] ?? 0;
      return x >= d ? (a * x + b) ** g + e : c * x + f;
    }
    default:
      return x;
  }
}

/** 매트릭스/TRC 프로파일로 장치 RGB(0..1) → XYZ(D50). 다른 종류면 null. */
export function iccRgbToXyz(profile: StudioIccProfile, rgb: { r: number; g: number; b: number }): {
  x: number;
  y: number;
  z: number;
} | null {
  const trc = profile.matrixTrc;
  if (!trc) return null;
  const r = evaluateIccCurve(trc.redTrc, rgb.r);
  const g = evaluateIccCurve(trc.greenTrc, rgb.g);
  const b = evaluateIccCurve(trc.blueTrc, rgb.b);
  const m = trc.matrix;
  return {
    x: m[0][0] * r + m[0][1] * g + m[0][2] * b,
    y: m[1][0] * r + m[1][1] * g + m[1][2] * b,
    z: m[2][0] * r + m[2][1] * g + m[2][2] * b,
  };
}

/** 한 줄 한국어 요약 — 인쇄 설정 패널이 그대로 노출한다. */
export function describeIccProfile(profile: StudioIccProfile): string {
  const space = profile.header.dataColorSpace.trim() || "알 수 없음";
  const intent = STUDIO_ICC_RENDERING_INTENT_LABELS[profile.header.renderingIntent];
  const name = profile.description.trim() || "이름 없는 프로파일";
  return `${name} · ${space} · ICC ${profile.header.version} · 렌더링 인텐트 ${intent}`;
}

// ---------------------------------------------------------------------------
// 최소 매트릭스/TRC 프로파일 **쓰기**
//
// 왜 쓰기가 필요한가: PDF/X 출고물의 `/OutputIntent` 에는 실제 프로파일 바이트를 넣어야 한다.
// 라이선스된 CMYK 프로파일은 배포할 수 없지만, **sRGB 매트릭스/TRC 프로파일은 공표된 상수만으로
// 우리가 직접 만들 수 있다**(IEC 61966-2-1 원색·백색점). 테스트 픽스처로도 쓴다
// (합성 프로파일을 만들어 파서로 되읽는 왕복 검증).
// ---------------------------------------------------------------------------

export interface StudioIccBuildOptions {
  description: string;
  copyright: string;
  /** 열이 R/G/B 원색인 RGB→XYZ(D50) 3×3. */
  matrix: readonly (readonly number[])[];
  /** 세 채널 공통 감마(단일 값 곡선). */
  gamma: number;
  whitePoint: { x: number; y: number; z: number };
  renderingIntent: StudioIccRenderingIntent;
  deviceClass?: string;
}

/**
 * sRGB(IEC 61966-2-1) 매트릭스/TRC 프로파일 생성 옵션.
 * 감마 2.2 단일 곡선은 sRGB 의 조각별 전달함수를 근사한 값이다(ICC v2 sRGB 프로파일이 널리 쓰는
 * 관례) — 정확한 조각별 곡선이 필요하면 `para` 타입 4 를 쓰도록 확장해야 한다.
 */
export const SRGB_ICC_BUILD_OPTIONS: StudioIccBuildOptions = {
  description: "ToonSpectrum sRGB",
  copyright: "Public domain sRGB primaries (IEC 61966-2-1)",
  matrix: [
    [0.4360747, 0.3850649, 0.1430804],
    [0.2225045, 0.7168786, 0.0606169],
    [0.0139322, 0.0971045, 0.7141733],
  ],
  gamma: 2.2,
  whitePoint: { x: 0.9642, y: 1, z: 0.8249 },
  renderingIntent: "media-relative",
  deviceClass: "mntr",
};

/**
 * 최소 ICC v2.4 매트릭스/TRC RGB 프로파일 바이트를 만든다(결정적 — 시각 메타데이터 없음).
 * 태그: desc, cprt, wtpt, rXYZ, gXYZ, bXYZ, rTRC, gTRC, bTRC. 모든 태그 데이터는 4바이트 정렬.
 */
export function buildMatrixTrcIccProfile(options: StudioIccBuildOptions = SRGB_ICC_BUILD_OPTIONS): Uint8Array {
  const desc = textDescriptionTag(options.description);
  const cprt = textTag(options.copyright);
  const wtpt = xyzTag(options.whitePoint.x, options.whitePoint.y, options.whitePoint.z);
  const m = options.matrix;
  const rXYZ = xyzTag(m[0]![0]!, m[1]![0]!, m[2]![0]!);
  const gXYZ = xyzTag(m[0]![1]!, m[1]![1]!, m[2]![1]!);
  const bXYZ = xyzTag(m[0]![2]!, m[1]![2]!, m[2]![2]!);
  const trc = gammaCurveTag(options.gamma);

  const entries: { signature: string; data: Uint8Array }[] = [
    { signature: "desc", data: desc },
    { signature: "cprt", data: cprt },
    { signature: "wtpt", data: wtpt },
    { signature: "rXYZ", data: rXYZ },
    { signature: "gXYZ", data: gXYZ },
    { signature: "bXYZ", data: bXYZ },
    { signature: "rTRC", data: trc },
    { signature: "gTRC", data: trc },
    { signature: "bTRC", data: trc },
  ];

  const tableSize = 4 + entries.length * ICC_TAG_ENTRY_SIZE;
  let cursor = ICC_HEADER_SIZE + tableSize;
  const placed: { signature: string; offset: number; size: number; data: Uint8Array }[] = [];
  // 같은 바이트열(rTRC/gTRC/bTRC)은 오프셋을 공유한다 — ICC 가 명시적으로 허용하는 절약이고,
  // 파서의 "중복 시그니처" 경로와 달리 시그니처는 서로 다르므로 안전하다.
  const shared = new Map<string, number>();
  for (const entry of entries) {
    const key = bytesKey(entry.data);
    const existing = shared.get(key);
    if (existing !== undefined) {
      placed.push({ signature: entry.signature, offset: existing, size: entry.data.byteLength, data: entry.data });
      continue;
    }
    shared.set(key, cursor);
    placed.push({ signature: entry.signature, offset: cursor, size: entry.data.byteLength, data: entry.data });
    cursor += align4(entry.data.byteLength);
  }

  const total = cursor;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);

  view.setUint32(0, total);
  writeAscii(out, 4, "none"); // preferred CMM
  view.setUint32(8, 0x02400000); // v2.4.0
  writeAscii(out, 12, options.deviceClass ?? "mntr");
  writeAscii(out, 16, "RGB ");
  writeAscii(out, 20, "XYZ ");
  // dateTime(24..35)은 0 으로 둔다 — 결정적 출력을 위해 의도적으로 비운다.
  writeAscii(out, 36, ICC_FILE_SIGNATURE);
  writeAscii(out, 40, "APPL");
  view.setUint32(64, RENDERING_INTENTS.indexOf(options.renderingIntent));
  writeS15Fixed16(view, 68, 0.9642);
  writeS15Fixed16(view, 72, 1);
  writeS15Fixed16(view, 76, 0.8249);
  writeAscii(out, 80, "TSpc");

  view.setUint32(ICC_HEADER_SIZE, placed.length);
  placed.forEach((entry, index) => {
    const base = ICC_HEADER_SIZE + 4 + index * ICC_TAG_ENTRY_SIZE;
    writeAscii(out, base, entry.signature);
    view.setUint32(base + 4, entry.offset);
    view.setUint32(base + 8, entry.size);
    out.set(entry.data, entry.offset);
  });

  return out;
}

function align4(value: number): number {
  return (value + 3) & ~3;
}

function bytesKey(bytes: Uint8Array): string {
  let key = "";
  for (let i = 0; i < bytes.length; i++) key += String.fromCharCode(bytes[i]!);
  return key;
}

function writeAscii(out: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) out[offset + i] = text.charCodeAt(i) & 0xff;
}

function writeS15Fixed16(view: DataView, offset: number, value: number): void {
  view.setInt32(offset, Math.round(value * 65536));
}

function xyzTag(x: number, y: number, z: number): Uint8Array {
  const out = new Uint8Array(20);
  const view = new DataView(out.buffer);
  writeAscii(out, 0, "XYZ ");
  writeS15Fixed16(view, 8, x);
  writeS15Fixed16(view, 12, y);
  writeS15Fixed16(view, 16, z);
  return out;
}

function gammaCurveTag(gamma: number): Uint8Array {
  const out = new Uint8Array(14);
  const view = new DataView(out.buffer);
  writeAscii(out, 0, "curv");
  view.setUint32(8, 1);
  view.setUint16(12, Math.round(gamma * 256));
  return out;
}

function textTag(text: string): Uint8Array {
  const ascii = toAscii(text);
  const out = new Uint8Array(align4(8 + ascii.length + 1));
  writeAscii(out, 0, "text");
  writeAscii(out, 8, ascii);
  return out;
}

/** textDescriptionType(ICC v2) — ASCII 본문 + 비어 있는 유니코드/스크립트코드 영역. */
function textDescriptionTag(text: string): Uint8Array {
  const ascii = toAscii(text);
  const asciiLength = ascii.length + 1;
  const size = 12 + asciiLength + 8 + 3 + 67;
  const out = new Uint8Array(align4(size));
  const view = new DataView(out.buffer);
  writeAscii(out, 0, "desc");
  view.setUint32(8, asciiLength);
  writeAscii(out, 12, ascii);
  return out;
}

/** ICC v2 텍스트 태그는 7비트 ASCII만 담는다 — 한글은 '?' 로 치환한다(정보 손실을 감춘다기보다, mluc 로 확장할 때까지의 명시적 한계). */
function toAscii(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.charCodeAt(0);
    out += code >= 0x20 && code <= 0x7e ? char : "?";
  }
  return out;
}
