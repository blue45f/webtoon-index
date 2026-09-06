/**
 * Studio Paper Texture — 절차적 수채지 높이맵과 물리 기반 안료 거동
 *
 * 수채화를 "수채화처럼" 보이게 하는 두 가지 시각 특징을 CPU 순수 함수로 구현한다.
 * 둘 다 Curtis et al. 1997 "Computer-Generated Watercolor"(SIGGRAPH) 얕은 물 모델의
 * 고전 항목이며, 여기서는 GPU 없이 검증 가능한 참조 구현으로 둔다.
 *
 *   1. **입자 침착(granulation)** — 안료가 종이 요철의 *골*에 가라앉아 생기는 얼룩덜룩한 질감.
 *      정착 가중치 w = (1 - height)^gamma 를 타일 평균으로 나눠 평균 1로 만든 뒤 곱하므로,
 *      균일 워시의 총 안료량은 정확히 보존되고 공간 분포만 골 쪽으로 재배치된다.
 *   2. **가장자리 어두워짐(edge darkening / backrun)** — 물이 마르며 젖은 영역 경계로
 *      안료가 실려 나가 테두리가 진해지는 현상. 습윤 필드의 그래디언트를 따라 내리막
 *      (=마르는 쪽) 방향으로 안료를 실제로 **이송**하고, 이송 대상이 이미 마른 셀이면
 *      안료를 그 자리에 고정(pinning)한다. 마지막 젖은 링에 안료가 쌓여 링이 생긴다.
 *      전달은 항상 쌍(빼기/더하기)으로 일어나므로 총 안료량이 보존된다.
 *
 * 설계 규칙
 * - 순수·결정적: Math.random / DOM / Konva / GPU 의존 없음. 같은 (kind, seed, 크기) → 같은 출력.
 * - 외부 의존성 0: 값 노이즈와 해시를 이 파일에서 직접 구현한다.
 * - 타일링 가능(seamless): 모든 옥타브의 격자 인덱스를 옥타브별 셀 수로 wrap 하므로
 *   높이맵은 가로·세로 모두 주기 함수다. 큰 캔버스에서 반복해도 이음선이 생기지 않는다.
 * - 잘못된 기하(음수 크기, 짧은 버퍼)는 조용히 통과시키지 않고 RangeError로 즉시 실패한다.
 *
 * 유체 v2(GPU)와의 접합은 이 모듈의 순수 함수 시그니처를 그대로 쓰면 된다 —
 * `createPaperHeightField`로 만든 타일을 R8/R16F 텍스처로 올리고,
 * `createPaperGranulationGain`/`accumulateEdgeDarkening`의 수식을 셰이더로 옮기면
 * CPU 참조 구현과 픽셀 단위로 대조할 수 있다.
 */

// ---------------------------------------------------------------------------
// 종이 프리셋
// ---------------------------------------------------------------------------

/**
 * 문서 단위 종이 표면 카탈로그.
 *
 * 앞의 3종(hot/cold/rough)은 수채지 표면 가공의 고전 등급이며 기존 문서·잉크워시와 호환된다.
 * 뒤의 종들은 스케치·만화장·동양화 워크플로에서 자주 고르는 실물 매체 근사다.
 */
export const PAPER_GRAIN_KINDS = [
  "hot-press",
  "cold-press",
  "rough",
  "bristol",
  "washi",
  "kraft",
  "canvas",
  "charcoal",
  "newsprint",
  "pastel-board",
  // Extended catalog — texture-first media sheets
  "cotton-rag",
  "watercolor-block",
  "linen-canvas",
  "marker-pad",
  "manga-paper",
  "toned-tan",
  "toned-gray",
  "sanded-pastel",
  "rice-paper",
  "mulberry",
  "vellum",
] as const;

/** 절차적 종이 표면 종류. */
export type PaperGrainKind = (typeof PAPER_GRAIN_KINDS)[number];

/** 수채화 기본 종이. 실물에서도 cold-press(중목)가 표준 사생지다. */
export const DEFAULT_PAPER_GRAIN_KIND: PaperGrainKind = "cold-press";

/**
 * 절차적 높이맵 파라미터.
 *
 * `baseCells`는 `PAPER_REFERENCE_TILE`(128px) 기준 셀 개수라, 타일 크기를 바꿔도
 * 결의 물리적 크기(px 단위 파장)가 유지된다.
 */
export interface PaperTextureParams {
  /** 겹칠 옥타브 수. 많을수록 미세 결이 풍부해진다. */
  readonly octaves: number;
  /** 기준 타일(128px)의 최저 주파수 옥타브 셀 수. 작을수록 결이 굵다. */
  readonly baseCells: number;
  /** 옥타브당 주파수 배수. 셀 수를 정수로 유지하려고 정수만 받는다. */
  readonly lacunarity: number;
  /** 옥타브당 진폭 감쇠. 클수록 고주파(까끌한 결) 비중이 커진다. */
  readonly persistence: number;
  /** 세로 주파수 / 가로 주파수 비. >1이면 결이 가로로 늘어난다(초지기 발 방향). */
  readonly fibreAnisotropy: number;
  /** 최종 높이 진폭. RMS 거칠기를 직접 좌우한다. */
  readonly amplitude: number;
  /** fbm에 거는 감마. >1이면 낮은 쪽이 넓어져 골이 깊고 봉우리가 성글어진다. */
  readonly toothBias: number;
}

/** 모든 `baseCells`가 기준으로 삼는 타일 한 변(px). */
export const PAPER_REFERENCE_TILE = 128;

/**
 * 종이 표면 파라미터 — 실물 매체 차이를 절차적 높이맵 축으로 옮긴다.
 *
 * - **hot-press(세목)**: 뜨거운 롤러로 눌러 결을 죽인 매끈한 종이. 요철 파장이 짧고
 *   진폭이 낮아 granulation이 거의 생기지 않는다.
 * - **cold-press(중목)**: 표준 사생지. 초지기 발 방향 이방성으로 수채 얼룩이 잘 보인다.
 * - **rough(황목)**: 펠트 자국이 굵은 거친 종이. 깊은 골에 안료가 크게 뭉친다.
 * - **bristol(브리스톨)**: hot-press보다 더 매끈한 일러스트/마커 용지.
 * - **washi(한지)**: 긴 섬유 이방성 + 중간 요철. 수묵·동양화 느낌.
 * - **kraft(크라프트)**: 포장지 느낌의 중간 결. 톤 스케치에 적합.
 * - **canvas(캔버스 천)**: 씨실·날실 격자 근사(낮은 이방성 + 중간 주파수 요철).
 * - **charcoal(목탄지)**: 매우 거친 이빨. 목탄·콩테가 골에 잘 남는다.
 * - **newsprint(신문지)**: 미세·조밀한 저진폭 결. 빠른 스케치용.
 * - **pastel-board(파스텔지)**: 건성 매체용 중간 이빨 + 높은 toothBias.
 * - **cotton-rag(면 수채지)**: 면 섬유 덩어리 + 중간 요철. cold-press보다 흡수·이빨 균형.
 * - **watercolor-block(수채 블록)**: cold-press 계열 + 높은 사이징 느낌(미세 균일 표면).
 * - **linen-canvas(린넨 캔버스)**: canvas보다 촘촘한 직조.
 * - **marker-pad(마커지)**: 블리드프루프에 가까운 저진폭 평활면.
 * - **manga-paper(만화 원고지)**: 세필·G펜용 미세 결.
 * - **toned-tan / toned-gray**: 톤 스케치 바탕 결.
 * - **sanded-pastel**: 사포형 강 이빨(파스텔·목탄 고정).
 * - **rice-paper(선화지)**: 얇고 긴 섬유, washi보다 가늘고 흡수 빠름.
 * - **mulberry(닥 두꺼운 한지)**: washi보다 성긴 장섬유·깊은 골.
 * - **vellum(벨럼)**: 반투명 느낌의 고른 미세 결.
 */
export const PAPER_TEXTURE_PRESETS: Readonly<Record<PaperGrainKind, PaperTextureParams>> = {
  "hot-press": {
    octaves: 2,
    baseCells: 32,
    lacunarity: 2,
    persistence: 0.42,
    fibreAnisotropy: 1,
    amplitude: 0.2,
    toothBias: 0.92,
  },
  "cold-press": {
    octaves: 4,
    baseCells: 16,
    lacunarity: 2,
    persistence: 0.55,
    fibreAnisotropy: 1.55,
    amplitude: 0.48,
    toothBias: 1.15,
  },
  rough: {
    octaves: 5,
    baseCells: 8,
    lacunarity: 2,
    persistence: 0.62,
    fibreAnisotropy: 1.2,
    amplitude: 0.78,
    toothBias: 1.3,
  },
  bristol: {
    octaves: 2,
    baseCells: 40,
    lacunarity: 2,
    persistence: 0.35,
    fibreAnisotropy: 1,
    amplitude: 0.12,
    toothBias: 0.88,
  },
  washi: {
    octaves: 4,
    baseCells: 12,
    lacunarity: 2,
    persistence: 0.58,
    fibreAnisotropy: 2.35,
    amplitude: 0.42,
    toothBias: 1.18,
  },
  kraft: {
    octaves: 3,
    baseCells: 18,
    lacunarity: 2,
    persistence: 0.5,
    fibreAnisotropy: 1.35,
    amplitude: 0.4,
    toothBias: 1.08,
  },
  canvas: {
    octaves: 3,
    baseCells: 14,
    lacunarity: 2,
    persistence: 0.48,
    fibreAnisotropy: 0.85,
    amplitude: 0.55,
    toothBias: 1.05,
  },
  charcoal: {
    octaves: 5,
    baseCells: 7,
    lacunarity: 2,
    persistence: 0.68,
    fibreAnisotropy: 1.15,
    amplitude: 0.88,
    toothBias: 1.38,
  },
  newsprint: {
    octaves: 3,
    baseCells: 36,
    lacunarity: 2,
    persistence: 0.45,
    fibreAnisotropy: 1.1,
    amplitude: 0.22,
    toothBias: 0.98,
  },
  "pastel-board": {
    octaves: 4,
    baseCells: 11,
    lacunarity: 2,
    persistence: 0.6,
    fibreAnisotropy: 1.25,
    amplitude: 0.62,
    toothBias: 1.28,
  },
  "cotton-rag": {
    octaves: 4,
    baseCells: 14,
    lacunarity: 2,
    persistence: 0.56,
    fibreAnisotropy: 1.4,
    amplitude: 0.52,
    toothBias: 1.2,
  },
  "watercolor-block": {
    octaves: 4,
    baseCells: 17,
    lacunarity: 2,
    persistence: 0.52,
    fibreAnisotropy: 1.45,
    amplitude: 0.44,
    toothBias: 1.12,
  },
  "linen-canvas": {
    octaves: 4,
    baseCells: 16,
    lacunarity: 2,
    persistence: 0.5,
    fibreAnisotropy: 0.92,
    amplitude: 0.5,
    toothBias: 1.02,
  },
  "marker-pad": {
    octaves: 2,
    baseCells: 48,
    lacunarity: 2,
    persistence: 0.32,
    fibreAnisotropy: 1,
    amplitude: 0.08,
    toothBias: 0.85,
  },
  "manga-paper": {
    octaves: 3,
    baseCells: 38,
    lacunarity: 2,
    persistence: 0.4,
    fibreAnisotropy: 1.08,
    amplitude: 0.16,
    toothBias: 0.9,
  },
  "toned-tan": {
    octaves: 3,
    baseCells: 20,
    lacunarity: 2,
    persistence: 0.5,
    fibreAnisotropy: 1.3,
    amplitude: 0.36,
    toothBias: 1.1,
  },
  "toned-gray": {
    octaves: 3,
    baseCells: 22,
    lacunarity: 2,
    persistence: 0.48,
    fibreAnisotropy: 1.25,
    amplitude: 0.34,
    toothBias: 1.08,
  },
  "sanded-pastel": {
    octaves: 5,
    baseCells: 9,
    lacunarity: 2,
    persistence: 0.66,
    fibreAnisotropy: 1.1,
    amplitude: 0.92,
    toothBias: 1.45,
  },
  "rice-paper": {
    octaves: 4,
    baseCells: 10,
    lacunarity: 2,
    persistence: 0.6,
    fibreAnisotropy: 2.6,
    amplitude: 0.36,
    toothBias: 1.22,
  },
  mulberry: {
    octaves: 5,
    baseCells: 9,
    lacunarity: 2,
    persistence: 0.64,
    fibreAnisotropy: 2.15,
    amplitude: 0.58,
    toothBias: 1.32,
  },
  vellum: {
    octaves: 3,
    baseCells: 34,
    lacunarity: 2,
    persistence: 0.4,
    fibreAnisotropy: 1.05,
    amplitude: 0.18,
    toothBias: 0.94,
  },
};

/** 미지의 문자열을 안전한 종이 종류로 정규화한다. */
export function normalizePaperGrainKind(raw: unknown): PaperGrainKind {
  return PAPER_GRAIN_KINDS.includes(raw as PaperGrainKind) ? (raw as PaperGrainKind) : DEFAULT_PAPER_GRAIN_KIND;
}

// ---------------------------------------------------------------------------
// 결정적 해시 + 주기 값 노이즈(자체 구현)
// ---------------------------------------------------------------------------

const HASH_MIX_X = 0x27d4eb2d;
const HASH_MIX_Y = 0x165667b1;
const HASH_MIX_SEED = 0x9e3779b1;
const HASH_FINAL_A = 0x85ebca6b;
const HASH_FINAL_B = 0xc2b2ae35;
const UINT32_SCALE = 4294967296;

/**
 * 격자 좌표 + 시드 → 0..1 결정적 해시. Math.imul로 32비트 곱을 정확히 수행해
 * 좌표가 커져도 부동소수 정밀도 손실이 없다(hash2와 달리 격자 인덱스 전용).
 */
function paperHash(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, HASH_MIX_X) ^ Math.imul(y | 0, HASH_MIX_Y) ^ Math.imul(seed | 0, HASH_MIX_SEED);
  h ^= h >>> 15;
  h = Math.imul(h, HASH_FINAL_A);
  h ^= h >>> 13;
  h = Math.imul(h, HASH_FINAL_B);
  h ^= h >>> 16;
  return (h >>> 0) / UINT32_SCALE;
}

/** C2 연속 보간 커브(6t^5-15t^4+10t^3). 이음선 검사에서 기울기까지 매끈해야 하므로 smoothstep보다 강하다. */
function smootherstep01(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function wrapIndex(value: number, period: number): number {
  const mod = value % period;
  return mod < 0 ? mod + period : mod;
}

/**
 * 주기 값 노이즈 한 옥타브. `u`,`v`는 0..1 정규화 좌표이고 격자 인덱스를
 * 셀 수로 wrap 하므로 u=0과 u=1이 같은 값·같은 기울기를 갖는다(seamless).
 */
function periodicValueNoise(u: number, v: number, cellsX: number, cellsY: number, seed: number): number {
  const gx = u * cellsX;
  const gy = v * cellsY;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const tx = smootherstep01(gx - x0);
  const ty = smootherstep01(gy - y0);
  const xa = wrapIndex(x0, cellsX);
  const xb = wrapIndex(x0 + 1, cellsX);
  const ya = wrapIndex(y0, cellsY);
  const yb = wrapIndex(y0 + 1, cellsY);
  const n00 = paperHash(xa, ya, seed);
  const n10 = paperHash(xb, ya, seed);
  const n01 = paperHash(xa, yb, seed);
  const n11 = paperHash(xb, yb, seed);
  const top = n00 + (n10 - n00) * tx;
  const bottom = n01 + (n11 - n01) * tx;
  return top + (bottom - top) * ty;
}

// ---------------------------------------------------------------------------
// 높이맵 생성
// ---------------------------------------------------------------------------

/** 결정적 절차 높이맵. `values`는 0..1, row-major, 가로·세로 모두 주기적이다. */
export interface PaperHeightField {
  readonly kind: PaperGrainKind;
  readonly params: PaperTextureParams;
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  readonly values: Float32Array;
}

export interface PaperHeightFieldOptions {
  readonly kind?: PaperGrainKind;
  /** 타일 한 변(px). 기본 128. 값이 달라져도 결의 물리적 파장은 유지된다. */
  readonly width?: number;
  readonly height?: number;
  readonly seed?: number;
  /** 프리셋 파라미터 부분 덮어쓰기(실험·튜닝용). */
  readonly params?: Partial<PaperTextureParams>;
  /**
   * 대비 정규화 방식. 생략하면 **역사적 계약**(평균만 빼는 경로)이 바이트 단위로 그대로 돌고,
   * 아래 주석이 설명하는 "RMS가 옥타브 구성에서 창발한다"는 성질도 그대로 유지된다.
   *
   * `"shaped-v2"`는 표준편차까지 정규화한 뒤 `tanh`로 성형해 **선언된 amplitude가 실제 span이
   * 되도록** 만든다. 기존 경로는 평균만 빼기 때문에 rough가 amplitude 0.78을 선언하고도 실측
   * RMS 0.067(선언값의 8.6%)에 그쳤고, RMS/amplitude 비가 프리셋마다 0.086~0.154로 1.8배
   * 흔들려 "이 종이가 얼마나 거친가"라는 선언이 렌더에 도달하지 못했다.
   */
  readonly contrast?: StudioPaperHeightContrast;
}

/**
 * `"shaped-v2"` — 표준편차 정규화 + tanh 성형. 생략(= `undefined`)은 역사적 평균-only 경로다.
 */
export const STUDIO_PAPER_HEIGHT_CONTRAST_SHAPED_V2 = "shaped-v2" as const;

export type StudioPaperHeightContrast = typeof STUDIO_PAPER_HEIGHT_CONTRAST_SHAPED_V2;

/**
 * tanh 성형 계수.
 *
 * 정규화된 z를 그대로 amplitude에 곱하면 fbm 꼬리가 0/1에 하드 클립되어 종이 골이 평평한
 * 판으로 뭉개진다. `tanh`는 꼬리만 부드럽게 눌러 클립을 0%로 유지하면서 중심부 대비는
 * 살려 둔다 — `studio-procedural-media-surface-provider`가 이미 쓰고 있는 기법과 같다.
 * 1.1은 단위분산 z에 대해 RMS(tanh(1.1z)) ≈ 0.63을 주는 값이라, span 대비 RMS 비가
 * 모든 프리셋에서 상수 ≈0.315가 된다.
 */
export const STUDIO_PAPER_HEIGHT_SHAPED_V2_CONTRAST = 1.1;

const PAPER_TILE_MIN = 4;
const PAPER_TILE_MAX = 4096;
/** 옥타브별 시드 분리 상수 — 옥타브끼리 같은 격자값을 재사용하지 않게 한다. */
const OCTAVE_SEED_STRIDE = 1013;

function clampNumber(raw: unknown, min: number, max: number, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, raw));
}

function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  return Math.floor(clampNumber(raw, min, max, fallback));
}

function clampUnit(value: number): number {
  return value <= 0 ? 0 : value >= 1 ? 1 : value;
}

/** 프리셋 + 덮어쓰기를 물리적으로 성립하는 범위로 정규화한다. */
export function normalizePaperTextureParams(
  raw: Partial<PaperTextureParams> | null | undefined,
  base: PaperTextureParams,
): PaperTextureParams {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    octaves: clampInt(src.octaves, 1, 8, base.octaves),
    baseCells: clampInt(src.baseCells, 1, PAPER_REFERENCE_TILE, base.baseCells),
    lacunarity: clampInt(src.lacunarity, 2, 4, base.lacunarity),
    persistence: clampNumber(src.persistence, 0.05, 0.95, base.persistence),
    fibreAnisotropy: clampNumber(src.fibreAnisotropy, 0.25, 4, base.fibreAnisotropy),
    amplitude: clampNumber(src.amplitude, 0, 1, base.amplitude),
    toothBias: clampNumber(src.toothBias, 0.25, 4, base.toothBias),
  };
}

function octaveCells(baseCells: number, axisLength: number, factor: number, octave: number, lacunarity: number): number {
  const scaled = baseCells * factor * (axisLength / PAPER_REFERENCE_TILE) * lacunarity ** octave;
  // 셀 수는 정수여야 wrap이 성립한다(= seamless). 최소 1, 최대 축 길이(1px 셀)로 묶는다.
  return Math.max(1, Math.min(Math.round(axisLength), Math.round(scaled)));
}

/**
 * Kind-specific micro-structure layered on top of fBm.
 * All terms are seamless in u,v ∈ [0,1) so large canvases tile without seams.
 * These are physical structure approximations (weave, long fibre, pore beds), not photo stamps.
 */
function specialtyMicrostructure(
  kind: PaperGrainKind,
  u: number,
  v: number,
  seed: number,
): number {
  switch (kind) {
    case "canvas": {
      // Orthogonal warp/weft with slight yarn irregularity — stronger than pure fBm "roughness".
      const warp = Math.sin(u * Math.PI * 2 * 18 + seed * 0.01);
      const weft = Math.sin(v * Math.PI * 2 * 18 + seed * 0.013);
      const yarn = periodicValueNoise(u, v, 36, 36, seed + 17);
      const crossing = warp * weft;
      return 0.5 + 0.28 * crossing + 0.12 * yarn + 0.08 * (warp * 0.5 + weft * 0.5);
    }
    case "linen-canvas": {
      // Tighter linen weave than cotton canvas.
      const warp = Math.sin(u * Math.PI * 2 * 26 + seed * 0.009);
      const weft = Math.sin(v * Math.PI * 2 * 26 + seed * 0.011);
      const yarn = periodicValueNoise(u, v, 48, 48, seed + 19);
      return 0.5 + 0.24 * warp * weft + 0.1 * yarn + 0.06 * (warp + weft) * 0.5;
    }
    case "washi": {
      // Long kozo-like fibres: anisotropic streaks + sparse nodes where fibres cross.
      const fibreA = periodicValueNoise(u, v, 6, 48, seed + 3);
      const fibreB = periodicValueNoise(u + 0.17, v, 5, 52, seed + 11);
      const node = periodicValueNoise(u, v, 14, 14, seed + 23);
      const ridge = Math.max(0, fibreA - 0.55) * 1.4 + Math.max(0, fibreB - 0.58) * 1.2;
      return clampUnit(0.42 + ridge * 0.55 + (node - 0.5) * 0.12);
    }
    case "rice-paper": {
      // Finer long fibres than washi — thin oriental calligraphy sheet.
      const fibreA = periodicValueNoise(u, v, 5, 56, seed + 4);
      const fibreB = periodicValueNoise(u + 0.11, v, 4, 60, seed + 12);
      const veil = periodicValueNoise(u, v, 22, 22, seed + 28);
      const ridge = Math.max(0, fibreA - 0.52) * 1.5 + Math.max(0, fibreB - 0.54) * 1.3;
      return clampUnit(0.4 + ridge * 0.5 + (veil - 0.5) * 0.1);
    }
    case "mulberry": {
      // Thicker, more open bast fibres than washi.
      const fibreA = periodicValueNoise(u, v, 7, 40, seed + 6);
      const fibreB = periodicValueNoise(u + 0.2, v, 6, 44, seed + 14);
      const clump = periodicValueNoise(u, v, 11, 11, seed + 30);
      const ridge = Math.max(0, fibreA - 0.48) * 1.55 + Math.max(0, fibreB - 0.5) * 1.35;
      return clampUnit(0.38 + ridge * 0.58 + Math.max(0, clump - 0.62) * 0.35);
    }
    case "charcoal": {
      // Sparse deep tooth beds for dry media lodging — heavy-tailed pores, not uniform noise.
      const bed = periodicValueNoise(u, v, 10, 10, seed + 7);
      const pore = periodicValueNoise(u, v, 28, 28, seed + 19);
      const deep = Math.pow(Math.max(0, 0.72 - bed), 1.6);
      return clampUnit(0.55 + deep * 0.7 - (pore - 0.5) * 0.18);
    }
    case "sanded-pastel": {
      // Abrasive grit plate — high spatial frequency + heavy tooth for pastel lodgement.
      const grit = periodicValueNoise(u, v, 32, 32, seed + 33);
      const plate = periodicValueNoise(u, v, 8, 8, seed + 41);
      const sharp = Math.pow(grit, 1.35);
      return clampUnit(0.42 + (sharp - 0.5) * 0.78 + (plate - 0.5) * 0.14);
    }
    case "kraft": {
      // Recycled-fibre flecks + mild board grain.
      const fleck = periodicValueNoise(u, v, 40, 40, seed + 5);
      const board = periodicValueNoise(u, v, 9, 14, seed + 13);
      const speck = fleck > 0.82 ? (fleck - 0.82) * 3.2 : 0;
      return clampUnit(0.5 + (board - 0.5) * 0.35 + speck * 0.45);
    }
    case "newsprint": {
      // Dense fine pulp + mild machine direction.
      const pulp = periodicValueNoise(u, v, 48, 44, seed + 9);
      const machine = periodicValueNoise(u, v, 64, 12, seed + 21);
      return clampUnit(0.5 + (pulp - 0.5) * 0.55 + (machine - 0.5) * 0.18);
    }
    case "pastel-board": {
      // Even tooth bed with sanded plateaus — holds pastel without extreme peaks.
      const tooth = periodicValueNoise(u, v, 16, 16, seed + 15);
      const plateau = periodicValueNoise(u, v, 7, 7, seed + 27);
      const grit = Math.pow(tooth, 0.85);
      return clampUnit(0.48 + (grit - 0.5) * 0.62 + (plateau - 0.5) * 0.12);
    }
    case "bristol":
    case "marker-pad": {
      // Near-plate finish with only micro polish marks (marker-pad even flatter).
      const polish = periodicValueNoise(u, v, kind === "marker-pad" ? 64 : 56, kind === "marker-pad" ? 64 : 56, seed + 31);
      return clampUnit(0.5 + (polish - 0.5) * (kind === "marker-pad" ? 0.1 : 0.16));
    }
    case "manga-paper": {
      const pulp = periodicValueNoise(u, v, 52, 50, seed + 37);
      const wire = periodicValueNoise(u, v, 70, 18, seed + 43);
      return clampUnit(0.5 + (pulp - 0.5) * 0.28 + (wire - 0.5) * 0.12);
    }
    case "cotton-rag": {
      // Soft cotton flocks + mild felt.
      const flock = periodicValueNoise(u, v, 18, 18, seed + 45);
      const felt = periodicValueNoise(u, v, 12, 14, seed + 47);
      return clampUnit(0.48 + (flock - 0.5) * 0.4 + (felt - 0.5) * 0.28);
    }
    case "watercolor-block": {
      // Cold-press family with more even sizing film (less extreme peaks).
      const felt = periodicValueNoise(u, v, 15, 18, seed + 49);
      const size = periodicValueNoise(u, v, 28, 28, seed + 51);
      return clampUnit(0.5 + (felt - 0.5) * 0.32 + (size - 0.5) * 0.14);
    }
    case "cold-press": {
      const felt = periodicValueNoise(u, v, 14, 18, seed + 53);
      const pore = periodicValueNoise(u, v, 26, 26, seed + 55);
      return clampUnit(0.5 + (felt - 0.5) * 0.38 + (pore - 0.5) * 0.16);
    }
    case "rough": {
      // Heavy felt impressions + deep troughs.
      const felt = periodicValueNoise(u, v, 8, 10, seed + 57);
      const trough = Math.pow(Math.max(0, 0.68 - felt), 1.45);
      const pore = periodicValueNoise(u, v, 20, 20, seed + 59);
      return clampUnit(0.45 + trough * 0.65 + (pore - 0.5) * 0.12);
    }
    case "toned-tan":
    case "toned-gray": {
      const pulp = periodicValueNoise(u, v, 24, 22, seed + 61);
      const fleck = periodicValueNoise(u, v, 38, 36, seed + 63);
      const speck = fleck > 0.78 ? (fleck - 0.78) * 2.4 : 0;
      return clampUnit(0.5 + (pulp - 0.5) * 0.32 + speck * 0.3);
    }
    case "vellum": {
      const smooth = periodicValueNoise(u, v, 40, 40, seed + 65);
      const veil = periodicValueNoise(u, v, 18, 18, seed + 67);
      return clampUnit(0.5 + (smooth - 0.5) * 0.2 + (veil - 0.5) * 0.1);
    }
    case "hot-press":
    default:
      return 0.5;
  }
}

function specialtyMixWeight(kind: PaperGrainKind): number {
  switch (kind) {
    case "canvas":
      return 0.42;
    case "linen-canvas":
      return 0.4;
    case "washi":
      return 0.38;
    case "rice-paper":
      return 0.4;
    case "mulberry":
      return 0.42;
    case "charcoal":
      return 0.4;
    case "sanded-pastel":
      return 0.46;
    case "kraft":
      return 0.28;
    case "newsprint":
      return 0.24;
    case "pastel-board":
      return 0.32;
    case "bristol":
      return 0.18;
    case "marker-pad":
      return 0.14;
    case "manga-paper":
      return 0.2;
    case "cotton-rag":
      return 0.34;
    case "watercolor-block":
      return 0.3;
    case "cold-press":
      return 0.26;
    case "rough":
      return 0.36;
    case "toned-tan":
    case "toned-gray":
      return 0.26;
    case "vellum":
      return 0.2;
    case "hot-press":
      return 0.1;
    default:
      return 0;
  }
}

/**
 * Document paper physical axes — drive brush coupling and Living Ink materials.
 * Values are unitless 0..1 gains (or multipliers around 1 for scaleMul).
 */
export interface StudioPaperPhysicsProfile {
  /** Multiplies brush granulation (tooth contact). */
  readonly toothGain: number;
  /** Multiplies brush staining (surface sizing / ink hold). */
  readonly sizingGain: number;
  /** Multiplies paper texels-per-document-px. */
  readonly scaleMul: number;
  /** Wet absorbency — higher soaks water/pigment faster. */
  readonly absorbency: number;
  /** Lateral wet bleed bias for Living Ink / wet paths. */
  readonly bleedBias: number;
  /** Relative drying rate (higher = dries faster). */
  readonly dryRate: number;
  /** Dry-media friction / lodging (charcoal, pastel). */
  readonly contactFriction: number;
}

export const PAPER_PHYSICS_PROFILES: Readonly<
  Record<PaperGrainKind, StudioPaperPhysicsProfile>
> = {
  "hot-press": {
    toothGain: 0.55,
    sizingGain: 1.15,
    scaleMul: 0.9,
    absorbency: 0.42,
    bleedBias: 0.35,
    dryRate: 0.72,
    contactFriction: 0.35,
  },
  "cold-press": {
    toothGain: 1,
    sizingGain: 1,
    scaleMul: 1,
    absorbency: 0.62,
    bleedBias: 0.55,
    dryRate: 0.55,
    contactFriction: 0.55,
  },
  rough: {
    toothGain: 1.22,
    sizingGain: 0.88,
    scaleMul: 1.25,
    absorbency: 0.78,
    bleedBias: 0.72,
    dryRate: 0.42,
    contactFriction: 0.72,
  },
  bristol: {
    toothGain: 0.4,
    sizingGain: 1.25,
    scaleMul: 0.85,
    absorbency: 0.28,
    bleedBias: 0.18,
    dryRate: 0.85,
    contactFriction: 0.28,
  },
  washi: {
    toothGain: 0.95,
    sizingGain: 0.75,
    scaleMul: 1.1,
    absorbency: 0.88,
    bleedBias: 0.82,
    dryRate: 0.38,
    contactFriction: 0.48,
  },
  kraft: {
    toothGain: 0.92,
    sizingGain: 0.9,
    scaleMul: 1.05,
    absorbency: 0.55,
    bleedBias: 0.48,
    dryRate: 0.6,
    contactFriction: 0.58,
  },
  canvas: {
    toothGain: 1.08,
    sizingGain: 0.95,
    scaleMul: 1.15,
    absorbency: 0.48,
    bleedBias: 0.32,
    dryRate: 0.5,
    contactFriction: 0.65,
  },
  charcoal: {
    toothGain: 1.28,
    sizingGain: 0.7,
    scaleMul: 1.35,
    absorbency: 0.5,
    bleedBias: 0.28,
    dryRate: 0.65,
    contactFriction: 0.92,
  },
  newsprint: {
    toothGain: 0.7,
    sizingGain: 0.65,
    scaleMul: 0.95,
    absorbency: 0.7,
    bleedBias: 0.6,
    dryRate: 0.48,
    contactFriction: 0.42,
  },
  "pastel-board": {
    toothGain: 1.15,
    sizingGain: 0.85,
    scaleMul: 1.2,
    absorbency: 0.4,
    bleedBias: 0.22,
    dryRate: 0.7,
    contactFriction: 0.85,
  },
  "cotton-rag": {
    toothGain: 1.05,
    sizingGain: 0.95,
    scaleMul: 1.05,
    absorbency: 0.72,
    bleedBias: 0.58,
    dryRate: 0.48,
    contactFriction: 0.6,
  },
  "watercolor-block": {
    toothGain: 0.95,
    sizingGain: 1.2,
    scaleMul: 1,
    absorbency: 0.58,
    bleedBias: 0.45,
    dryRate: 0.62,
    contactFriction: 0.52,
  },
  "linen-canvas": {
    toothGain: 1.02,
    sizingGain: 1,
    scaleMul: 1.08,
    absorbency: 0.45,
    bleedBias: 0.28,
    dryRate: 0.52,
    contactFriction: 0.62,
  },
  "marker-pad": {
    toothGain: 0.25,
    sizingGain: 1.45,
    scaleMul: 0.8,
    absorbency: 0.15,
    bleedBias: 0.08,
    dryRate: 0.92,
    contactFriction: 0.18,
  },
  "manga-paper": {
    toothGain: 0.48,
    sizingGain: 1.2,
    scaleMul: 0.88,
    absorbency: 0.32,
    bleedBias: 0.2,
    dryRate: 0.8,
    contactFriction: 0.32,
  },
  "toned-tan": {
    toothGain: 0.88,
    sizingGain: 0.95,
    scaleMul: 1,
    absorbency: 0.52,
    bleedBias: 0.42,
    dryRate: 0.58,
    contactFriction: 0.55,
  },
  "toned-gray": {
    toothGain: 0.86,
    sizingGain: 0.95,
    scaleMul: 1,
    absorbency: 0.5,
    bleedBias: 0.4,
    dryRate: 0.6,
    contactFriction: 0.54,
  },
  "sanded-pastel": {
    toothGain: 1.35,
    sizingGain: 0.65,
    scaleMul: 1.4,
    absorbency: 0.35,
    bleedBias: 0.15,
    dryRate: 0.75,
    contactFriction: 0.98,
  },
  "rice-paper": {
    toothGain: 0.82,
    sizingGain: 0.55,
    scaleMul: 1.05,
    absorbency: 0.95,
    bleedBias: 0.92,
    dryRate: 0.28,
    contactFriction: 0.4,
  },
  mulberry: {
    toothGain: 1.1,
    sizingGain: 0.68,
    scaleMul: 1.18,
    absorbency: 0.9,
    bleedBias: 0.85,
    dryRate: 0.32,
    contactFriction: 0.55,
  },
  vellum: {
    toothGain: 0.5,
    sizingGain: 1.18,
    scaleMul: 0.9,
    absorbency: 0.38,
    bleedBias: 0.25,
    dryRate: 0.78,
    contactFriction: 0.38,
  },
};

export function getStudioPaperPhysicsProfile(
  kind: PaperGrainKind | unknown,
): StudioPaperPhysicsProfile {
  const id = normalizePaperGrainKind(kind);
  return PAPER_PHYSICS_PROFILES[id];
}

/**
 * 시드 기반 절차 높이맵을 만든다. 항상 새 버퍼를 반환하는 순수 함수다.
 *
 * fbm을 먼저 쌓고(0..1), toothBias 감마로 골/봉우리 비대칭을 준 뒤,
 * 매체별 미세 구조(천 직조·한지 장섬유·목탄 이빨 등)를 섞고,
 * **타일 평균만** 빼서 0.5 중심으로 옮긴다. 표준편차로 정규화하지 않으므로
 * RMS 거칠기는 옥타브 구성과 amplitude에서 실제로 창발한다(프리셋 간 유의차의 근거).
 */
export function createPaperHeightField(options?: PaperHeightFieldOptions): PaperHeightField {
  const kind = normalizePaperGrainKind(options?.kind ?? DEFAULT_PAPER_GRAIN_KIND);
  const width = clampInt(options?.width, PAPER_TILE_MIN, PAPER_TILE_MAX, PAPER_REFERENCE_TILE);
  const height = clampInt(options?.height, PAPER_TILE_MIN, PAPER_TILE_MAX, width);
  const seed = clampInt(options?.seed, 0, 0xffffff, 41);
  const params = normalizePaperTextureParams(options?.params, PAPER_TEXTURE_PRESETS[kind]);

  const count = width * height;
  const values = new Float32Array(count);

  // 옥타브별 셀 수/진폭을 미리 확정해 픽셀 루프에서 재계산하지 않는다.
  const cellsX: number[] = [];
  const cellsY: number[] = [];
  const amplitudes: number[] = [];
  let amplitudeSum = 0;
  let amplitude = 1;
  for (let octave = 0; octave < params.octaves; octave++) {
    cellsX.push(octaveCells(params.baseCells, width, 1, octave, params.lacunarity));
    cellsY.push(octaveCells(params.baseCells, height, params.fibreAnisotropy, octave, params.lacunarity));
    amplitudes.push(amplitude);
    amplitudeSum += amplitude;
    amplitude *= params.persistence;
  }

  const microWeight = specialtyMixWeight(kind);
  const baseWeight = 1 - microWeight;

  let shapedSum = 0;
  for (let y = 0; y < height; y++) {
    const v = y / height;
    for (let x = 0; x < width; x++) {
      const u = x / width;
      let fbm = 0;
      for (let octave = 0; octave < params.octaves; octave++) {
        fbm
          += amplitudes[octave]!
          * periodicValueNoise(u, v, cellsX[octave]!, cellsY[octave]!, seed + octave * OCTAVE_SEED_STRIDE);
      }
      const base = (fbm / amplitudeSum) ** params.toothBias;
      const micro = specialtyMicrostructure(kind, u, v, seed);
      const shaped = clampUnit(base * baseWeight + micro * microWeight);
      values[y * width + x] = shaped;
      shapedSum += shaped;
    }
  }

  const shapedMean = shapedSum / count;
  if (options?.contrast === STUDIO_PAPER_HEIGHT_CONTRAST_SHAPED_V2) {
    // 표준편차까지 정규화해야 amplitude가 실제 span이 된다. 평균만 빼는 아래 경로는
    // 옥타브 구성이 결정한 임의의 sd를 그대로 남겨 선언값을 무의미하게 만든다.
    let varianceSum = 0;
    for (let index = 0; index < count; index++) {
      const delta = values[index]! - shapedMean;
      varianceSum += delta * delta;
    }
    const deviation = Math.sqrt(varianceSum / count);
    // sd 0 = 완전 균일한 판(병리적 입력). 나눗셈 대신 평평한 0.5로 fail-closed.
    const inverseDeviation = deviation > 1e-9 ? 1 / deviation : 0;
    const halfSpan = params.amplitude * 0.5;
    for (let index = 0; index < count; index++) {
      const z = (values[index]! - shapedMean) * inverseDeviation;
      values[index] = clampUnit(
        0.5 + halfSpan * Math.tanh(z * STUDIO_PAPER_HEIGHT_SHAPED_V2_CONTRAST),
      );
    }
    return { kind, params, width, height, seed, values };
  }
  for (let index = 0; index < count; index++) {
    values[index] = clampUnit(0.5 + params.amplitude * (values[index]! - shapedMean));
  }

  return { kind, params, width, height, seed, values };
}

/** 주기 경계를 wrap 해 높이를 읽는다. 캔버스보다 작은 타일을 반복 적용할 때 쓴다. */
export function samplePaperHeight(field: PaperHeightField, x: number, y: number): number {
  const wx = wrapIndex(Math.floor(x), field.width);
  const wy = wrapIndex(Math.floor(y), field.height);
  return field.values[wy * field.width + wx]!;
}

// ---------------------------------------------------------------------------
// 입자 침착(granulation)
// ---------------------------------------------------------------------------

/**
 * 안료별 침착 성질. 실물 물감도 granulating(울트라마린·세룰리안)과
 * staining(프탈로·퀴나크리돈)이 확연히 다르다.
 */
export interface PigmentGranulationProfile {
  readonly id: string;
  readonly label: string;
  /** 0..1 — 종이 골에 가라앉는 경향. */
  readonly granulation: number;
  /** 0..1 — 섬유에 즉시 물들어 재분포가 억제되는 정도. */
  readonly staining: number;
}

/** 실물 수채 물감의 granulating/staining 성질을 근사한 프로파일 표. */
export const PIGMENT_GRANULATION_PROFILES: readonly PigmentGranulationProfile[] = [
  // 대표적 granulating 안료 — 무거운 입자가 골마다 눈에 띄게 뭉친다.
  { id: "ultramarine-blue", label: "울트라마린", granulation: 0.88, staining: 0.12 },
  { id: "cerulean-blue", label: "세룰리안", granulation: 0.94, staining: 0.06 },
  { id: "burnt-umber", label: "번트 엄버", granulation: 0.62, staining: 0.22 },
  // 먹/램프블랙은 중간 — 입자가 곱지만 완전 staining은 아니다.
  { id: "sumi-ink", label: "먹", granulation: 0.36, staining: 0.52 },
  // staining 안료 — 종이에 즉시 물들어 골로 재분포되지 않는다.
  { id: "phthalo-blue", label: "프탈로 블루", granulation: 0.06, staining: 0.94 },
  { id: "quinacridone-rose", label: "퀴나크리돈 로즈", granulation: 0.08, staining: 0.9 },
];

export interface PigmentSettleOptions {
  /** 0..1 — 안료의 granulating 성질. 0이면 정확히 항등이다. */
  readonly strength: number;
  /** 0..1 — staining 성질. 높을수록 골 재분포가 억제된다. 기본 0. */
  readonly staining?: number;
}

/** granulation 감마 상한: strength 1에서 (1-h)^2.5까지 골이 강조된다. */
const GRANULATION_GAMMA_GAIN = 1.5;

function effectiveGranulation(options: PigmentSettleOptions): number {
  const strength = clampUnit(clampNumber(options.strength, 0, 1, 0));
  const staining = clampUnit(clampNumber(options.staining, 0, 1, 0));
  return strength * (1 - staining);
}

/**
 * 정착 가중치 `w = (1 - height)^gamma`. gamma는 granulating 성질이 강할수록 커져
 * 골에 몰리는 정도가 비선형으로 세진다(울트라마린 같은 무거운 안료의 알갱이 뭉침).
 */
function granulationWeights(paper: PaperHeightField, effective: number): Float32Array {
  const count = paper.width * paper.height;
  const gamma = 1 + GRANULATION_GAMMA_GAIN * effective;
  const weights = new Float32Array(count);
  for (let index = 0; index < count; index++) {
    weights[index] = (1 - paper.values[index]!) ** gamma;
  }
  return weights;
}

/**
 * 종이 높이맵 → 픽셀별 정착 이득 `g`를 만든다. 정착량은 `pigment * (1 + g)`다.
 *
 *   w = (1 - height)^gamma,  gamma = 1 + 1.5 * effective
 *   g = effective * (w / mean(w) - 1)
 *
 * 타일 평균으로 나눠 `mean(g) == 0`을 만들므로 **균일 워시**의 총 안료량은 정확히
 * 보존되고 공간 분포만 골(낮은 height) 쪽으로 몰린다. 안료 분포가 국소적이면 이 이득은
 * 근사이며(정확한 보존은 `settlePigmentOnPaper`가 안료 가중 평균으로 처리한다),
 * 대신 안료와 무관해서 한 번 만들어 캐시·재사용할 수 있다 — 래스터 필터용 빠른 경로다.
 *
 * effective가 0이면 전 구간 0을 반환해 호출부가 항등을 그대로 얻는다.
 */
export function createPaperGranulationGain(paper: PaperHeightField, options: PigmentSettleOptions): Float32Array {
  const count = paper.width * paper.height;
  const effective = effectiveGranulation(options);
  if (effective <= 0) return new Float32Array(count);

  const gain = granulationWeights(paper, effective);
  let weightSum = 0;
  for (let index = 0; index < count; index++) weightSum += gain[index]!;
  const weightMean = weightSum / count;
  // 종이가 전부 height=1인 병리적 입력이면 재분포할 골이 없다 — 항등으로 남긴다.
  if (!(weightMean > 0)) return new Float32Array(count);

  for (let index = 0; index < count; index++) {
    gain[index] = effective * (gain[index]! / weightMean - 1);
  }
  return gain;
}

export interface PigmentSettleInput {
  readonly pigment: ArrayLike<number>;
  readonly paper: PaperHeightField;
}

/**
 * 안료 층을 종이 위에 정착시킨다. 항상 새 Float32Array를 반환하고 입력은 건드리지 않는다.
 *
 * 정규화 기준을 타일 평균이 아니라 **안료 가중 평균** `Σ p·w / Σ p`로 잡는다. 그래서
 * 원형 워시처럼 국소적인 분포에서도 `Σ settled == Σ pigment`가 정확히 성립한다 —
 * 침착은 있는 안료를 골로 재배치할 뿐 만들거나 없애지 않는다는 물리를 그대로 지킨다.
 *
 * 길이가 종이 타일보다 짧으면 조용히 잘라내지 않고 RangeError로 실패한다.
 */
export function settlePigmentOnPaper(input: PigmentSettleInput, options: PigmentSettleOptions): Float32Array {
  const count = input.paper.width * input.paper.height;
  if (input.pigment.length < count) {
    throw new RangeError(
      `settlePigmentOnPaper: pigment length ${input.pigment.length} is smaller than paper tile ${count}`,
    );
  }

  const settled = new Float32Array(count);
  for (let index = 0; index < count; index++) settled[index] = input.pigment[index]!;

  const effective = effectiveGranulation(options);
  if (effective <= 0) return settled;

  const weights = granulationWeights(input.paper, effective);
  let pigmentSum = 0;
  let weightedSum = 0;
  for (let index = 0; index < count; index++) {
    pigmentSum += settled[index]!;
    weightedSum += settled[index]! * weights[index]!;
  }
  const reference = pigmentSum > 0 ? weightedSum / pigmentSum : 0;
  // 안료가 없거나 종이에 골이 없으면 재배치할 것이 없다.
  if (!(reference > 0)) return settled;

  for (let index = 0; index < count; index++) {
    settled[index] = settled[index]! * (1 + effective * (weights[index]! / reference - 1));
  }
  return settled;
}

// ---------------------------------------------------------------------------
// 가장자리 어두워짐(edge darkening / backrun)
// ---------------------------------------------------------------------------

export interface EdgeDarkeningField {
  readonly pigment: ArrayLike<number>;
  /** 습윤도 0..1. 값이 큰 쪽이 더 젖어 있다. */
  readonly wetness: ArrayLike<number>;
  readonly width: number;
  readonly height: number;
}

export interface EdgeDarkeningOptions {
  /** 0..1 — 0이면 입력을 그대로 복사해 반환한다(조작 감지용 항등). */
  readonly strength: number;
  /** 건조 반복 횟수 1..32. 기본 6. */
  readonly steps?: number;
  /** 이 값 이하는 마른 셀로 보고 안료를 고정(pinning)한다. 기본 0.02. */
  readonly wetThreshold?: number;
}

const EDGE_DEFAULT_STEPS = 6;
const EDGE_DEFAULT_WET_THRESHOLD = 0.02;
/** 최대 그래디언트 셀이 한 스텝에 내보내는 안료 비율(strength=1 기준). */
const EDGE_STEP_RATE = 0.5;
const EDGE_EPSILON = 1e-9;

function assertFieldGeometry(width: number, height: number, lengths: readonly [number, number]): number {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`accumulateEdgeDarkening: invalid field size ${width}x${height}`);
  }
  const count = width * height;
  if (lengths[0] < count || lengths[1] < count) {
    throw new RangeError(
      `accumulateEdgeDarkening: buffers (${lengths[0]}, ${lengths[1]}) are shorter than ${width}x${height}=${count}`,
    );
  }
  return count;
}

/**
 * 젖은 영역이 마르며 생기는 가장자리 안료 집적을 계산한다. 새 Float32Array를 반환한다.
 *
 * 각 젖은 셀에서 습윤도 그래디언트의 **내리막**(= 먼저 마르는 가장자리 쪽) 단위 벡터를
 * 구하고, 축 성분 비율대로 이웃 두 칸에 안료를 나눠 보낸다. 대상이 마른 셀이거나
 * 캔버스 밖이면 이송하지 않아 안료가 그 자리에 고정된다 — 이게 링(테두리)이 생기는 원리다.
 * 이동량은 국소 그래디언트를 전체 최대 그래디언트로 정규화해 정하므로, 40px 원형 워시든
 * 3px 점이든 같은 파라미터가 같은 세기로 동작한다(스케일 불변).
 *
 * 전달이 항상 (빼기, 더하기) 쌍으로 이뤄져 총 안료량은 부동소수 오차 내에서 보존된다.
 */
export function accumulateEdgeDarkening(field: EdgeDarkeningField, options: EdgeDarkeningOptions): Float32Array {
  const { width, height } = field;
  const count = assertFieldGeometry(width, height, [field.pigment.length, field.wetness.length]);

  let current = new Float32Array(count);
  for (let index = 0; index < count; index++) current[index] = field.pigment[index]!;

  const strength = clampUnit(clampNumber(options.strength, 0, 1, 0));
  if (strength <= 0) return current;

  const steps = clampInt(options.steps, 1, 32, EDGE_DEFAULT_STEPS);
  const wetThreshold = clampNumber(options.wetThreshold, 0, 1, EDGE_DEFAULT_WET_THRESHOLD);

  const wet = new Float32Array(count);
  for (let index = 0; index < count; index++) wet[index] = field.wetness[index]!;

  // 스케일 불변 정규화를 위해 전체 최대 그래디언트를 먼저 잰다.
  let maxGradient = 0;
  const gradientX = new Float32Array(count);
  const gradientY = new Float32Array(count);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (wet[index]! <= wetThreshold) continue;
      const left = wet[y * width + (x > 0 ? x - 1 : 0)]!;
      const right = wet[y * width + (x + 1 < width ? x + 1 : width - 1)]!;
      const up = wet[(y > 0 ? y - 1 : 0) * width + x]!;
      const down = wet[(y + 1 < height ? y + 1 : height - 1) * width + x]!;
      const gx = (right - left) * 0.5;
      const gy = (down - up) * 0.5;
      gradientX[index] = gx;
      gradientY[index] = gy;
      const magnitude = Math.hypot(gx, gy);
      if (magnitude > maxGradient) maxGradient = magnitude;
    }
  }
  if (maxGradient <= EDGE_EPSILON) return current;

  let next = new Float32Array(count);
  for (let step = 0; step < steps; step++) {
    next.set(current);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = y * width + x;
        if (wet[index]! <= wetThreshold) continue;
        const pigment = current[index]!;
        if (pigment <= EDGE_EPSILON) continue;
        const gx = gradientX[index]!;
        const gy = gradientY[index]!;
        const magnitude = Math.hypot(gx, gy);
        if (magnitude <= EDGE_EPSILON) continue;

        // 내리막 = 마르는 쪽. 안료는 물을 따라 이쪽으로 실려 나간다.
        const move = pigment * strength * EDGE_STEP_RATE * (magnitude / maxGradient);
        const axisWeightX = Math.abs(gx) / (Math.abs(gx) + Math.abs(gy));
        const stepX = gx < 0 ? 1 : -1;
        const stepY = gy < 0 ? 1 : -1;

        const moveX = move * axisWeightX;
        if (moveX > EDGE_EPSILON) {
          const targetX = x + stepX;
          if (targetX >= 0 && targetX < width) {
            const target = y * width + targetX;
            if (wet[target]! > wetThreshold) {
              next[target] += moveX;
              next[index] -= moveX;
            }
          }
        }

        const moveY = move - moveX;
        if (moveY > EDGE_EPSILON) {
          const targetY = y + stepY;
          if (targetY >= 0 && targetY < height) {
            const target = targetY * width + x;
            if (wet[target]! > wetThreshold) {
              next[target] += moveY;
              next[index] -= moveY;
            }
          }
        }
      }
    }
    const swap = current;
    current = next;
    next = swap;
  }

  return current;
}

// ---------------------------------------------------------------------------
// 참조 건조 파이프라인 — 두 특징을 순서대로 적용한다.
// ---------------------------------------------------------------------------

export interface DryWashInput {
  readonly pigment: ArrayLike<number>;
  readonly wetness: ArrayLike<number>;
  readonly paper: PaperHeightField;
}

export interface DryWashOptions {
  readonly edgeDarkening: EdgeDarkeningOptions;
  readonly granulation: PigmentSettleOptions;
}

/**
 * 젖은 워시가 마르는 전 과정의 CPU 참조 구현.
 * 물이 먼저 안료를 가장자리로 옮기고(이송), 그다음 남은 안료가 종이 골에 정착한다.
 * 순서를 바꾸면 링이 골 패턴으로만 흩어져 실제 수채와 어긋난다.
 */
export function dryWashOnPaper(input: DryWashInput, options: DryWashOptions): Float32Array {
  const moved = accumulateEdgeDarkening(
    { pigment: input.pigment, wetness: input.wetness, width: input.paper.width, height: input.paper.height },
    options.edgeDarkening,
  );
  return settlePigmentOnPaper({ pigment: moved, paper: input.paper }, options.granulation);
}
