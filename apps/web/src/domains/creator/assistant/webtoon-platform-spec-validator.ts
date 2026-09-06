/**
 * webtoon-platform-spec-validator.ts
 *
 * Webtoon Platform Upload Spec Validator & Vertical Strip Auto-Slicer.
 *
 * - Audits canvas width, height, slice counts, per-file weight, per-episode budget, and thumbnail
 *   dimensions against platform limits.
 * - Auto-computes safe vertical cut lines (Safe Split Gutter Lines) so panels, speech bubbles, and
 *   character heads are never sliced through the middle during multi-page export.
 *
 * PROVENANCE DISCIPLINE (2026-09-03)
 * ----------------------------------
 * Every number below carries a `SpecProvenance` naming where it came from and how much it can be
 * trusted. This matters because the rows differ enormously in quality: WEBTOON CANVAS's 800x1280 is
 * lifted from the platform's own help centre, while the Naver 도전만화 row is a third-party
 * summary that could not be corroborated against Naver's own page. A validator that renders both as
 * bare integers invites an author to trust the weak one as much as the strong one.
 *
 * Three rules follow from that, and they are enforced in `audit()` rather than left to a comment:
 *   1. Only an official platform rule, or a third-party one corroborated by an independent source,
 *      can grade "fail". An unverified number, an uncorroborated single third-party claim, or any
 *      `craft-guidance` rule caps at "warn" — we do not block an author on a number we cannot
 *      stand behind. `SpecAuditIssue.ruleSeverity` still reports what the rule itself asked for.
 *   2. Every issue message ends with a source tag, so the author sees the basis for the judgement.
 *   3. Where two documents disagree, BOTH values are recorded in `conflicts` and surfaced as a
 *      `provenance` issue on every audit — we do not silently pick a winner. (The CANVAS episode
 *      thumbnail is the live example: 202x142 in the current help centre, 160x151 in the older
 *      platform notice.) `provenance` issues are excluded from `overallGrade`/`isCompliant`: they
 *      describe our table, not the author's file, and a permanent warning badge on an otherwise
 *      perfect canvas would only teach the author to ignore the badge.
 *
 * Numbers whose only support was "it was already in this file" are marked `unverified`; they were
 * NOT replaced with invented ones.
 */

/** 규격 수치의 출처 신뢰도. */
export type SpecSourceConfidence =
  /** 플랫폼이 직접 발행한 공식 문서(공지·헬프센터·크리에이터 가이드). */
  | "official"
  /** 플랫폼 외부의 정리본. 내용이 맞을 수는 있으나 플랫폼이 보증하지 않는다. */
  | "third-party"
  /** 출처를 확인하지 못한 값. 이 코드베이스에 먼저 적혀 있었다는 것 외의 근거가 없다. */
  | "unverified";

/**
 * 규격 수치의 성격.
 *
 * 플랫폼이 업로드 단계에서 실제로 거부하는 규칙(`platform-rule`)과, 지켜지지 않아도 업로드는
 * 되는 연출 지침(`craft-guidance`)은 위반 시 심각도가 달라야 한다. 컷 간격이 대표적으로
 * 후자다 — 어떤 플랫폼도 여백이 좁다고 원고를 반려하지 않는다.
 */
export type SpecRuleKind = "platform-rule" | "craft-guidance";

export interface SpecProvenance {
  readonly confidence: SpecSourceConfidence;
  readonly kind: SpecRuleKind;
  /** 사람이 읽을 수 있는 출처 이름. UI 메시지에 그대로 노출된다. */
  readonly source: string;
  readonly url?: string;
  /** 출처를 확인한 날짜(ISO). */
  readonly checkedOn?: string;
  /**
   * 서로 독립적인 두 개 이상의 출처로 교차 확인됐는가.
   *
   * 확인되지 않은 외부 출처 하나만 가진 수치는 감사에서 "fail" 을 낼 수 없다 — 한 곳에서만
   * 나온 이야기로 작가의 원고를 막아서는 안 된다. `official` 에는 필요 없다.
   */
  readonly corroborated?: boolean;
  readonly note?: string;
}

/** 이 표의 수치를 마지막으로 1차 출처와 대조한 날짜. */
export const WEBTOON_PLATFORM_SPEC_SNAPSHOT_DATE = "2026-09-03" as const;

export type WebtoonPlatformId =
  | "naver-webtoon"
  | "kakao-page"
  | "webtoon-canvas"
  | "tapas"
  | "lezhin-comics"
  | "toptoon"
  | "postype";

export type WebtoonImageFormat = "jpg" | "png" | "webp" | "gif";

/**
 * 감사 항목. `episode-*`는 파일 1장이 아니라 회차 전체에 걸리는 한도이고,
 * `provenance`는 규격 수치 자체가 서로 어긋난다는 사실을 알리는 항목이다.
 */
export type SpecAuditField =
  | "width"
  | "height"
  | "size"
  | "format"
  | "gutter"
  | "episode-size"
  | "episode-count"
  | "provenance";

/** 같은 항목을 서로 다르게 적은 두 개 이상의 문서를 그대로 보존한다. */
export interface SpecValueConflict {
  readonly field: SpecAuditField;
  readonly summary: string;
  readonly candidates: readonly { readonly value: string; readonly provenance: SpecProvenance }[];
}

/** 명시적으로 "거부된다"고 보고된 포맷. 단순 미지원과 구분해 메시지를 다르게 낸다. */
export interface DeniedFormatRule {
  readonly format: WebtoonImageFormat;
  readonly provenance: SpecProvenance;
}

/** 파일 1장이 아니라 회차 전체에 걸리는 한도. */
export interface EpisodeBudgetSpec {
  readonly maxEpisodeBytes?: number;
  readonly maxImageCount?: number;
  readonly provenance: SpecProvenance;
}

export type ThumbnailSlot = "episode" | "series-square" | "series-vertical";

export interface ThumbnailSpec {
  readonly slot: ThumbnailSlot;
  readonly label: string;
  readonly widthPx: number;
  readonly heightPx: number;
  /** 공식 문언이 "미만(under)"이므로 경계값은 초과로 보지 않는다. */
  readonly maxBytesExclusive: number;
  readonly provenance: SpecProvenance;
  readonly conflicts?: readonly SpecValueConflict[];
}

export interface WebtoonPlatformSpec {
  readonly id: WebtoonPlatformId;
  readonly name: string;
  readonly recommendedWidthPx: number;
  readonly allowedWidthsPx: readonly number[];
  readonly maxSliceHeightPx: number;
  readonly recommendedSliceHeightPx: number;
  /**
   * `maxSliceHeightPx` 가 플랫폼이 강제하는 상한인가.
   *
   * false 이면 플랫폼에 세로 상한이 없고, `maxSliceHeightPx` 는 브라우저 캔버스 렌더 이식
   * 한계를 실질 상한으로 대신 넣은 값이다 — 초과해도 플랫폼이 반려하지는 않는다.
   * 생략하면 true.
   */
  readonly hasPlatformHeightCap?: boolean;
  readonly maxFileSizeBytes: number;
  readonly allowedFormats: readonly WebtoonImageFormat[];
  readonly deniedFormats: readonly DeniedFormatRule[];
  readonly minGutterPx: number;
  readonly maxGutterPx: number;
  readonly episodeBudget?: EpisodeBudgetSpec;
  readonly thumbnails: readonly ThumbnailSpec[];
  /** 항목별 출처. 감사 심각도와 메시지가 여기서 결정된다. */
  readonly provenance: Readonly<Record<"width" | "height" | "size" | "format" | "gutter", SpecProvenance>>;
  readonly conflicts: readonly SpecValueConflict[];
  readonly sourceUrls: readonly string[];
  readonly description: string;
}

export interface CanvasAuditInput {
  readonly width: number;
  readonly height: number;
  readonly dpi?: number;
  readonly estimatedSizeBytes?: number;
  readonly format?: WebtoonImageFormat;
  readonly panelGuttersPx?: readonly number[];
  /** 회차에 업로드할 모든 이미지의 바이트 합계. */
  readonly episodeTotalBytes?: number;
  /** 회차에 업로드할 이미지 장수. */
  readonly episodeImageCount?: number;
}

export type ComplianceGrade = "pass" | "warn" | "fail";

export interface SpecAuditIssue {
  readonly grade: ComplianceGrade;
  readonly field: SpecAuditField;
  readonly message: string;
  readonly recommendation: string;
  /**
   * 출처 신뢰도 상한을 적용하기 전, 규칙 자체가 요구하는 심각도.
   *
   * `grade` 와 다르면 "규칙상으로는 반려 사유지만 근거가 약해 경고로 낮췄다" 는 뜻이다.
   * UI가 그 사실을 그대로 보여줄 수 있도록 남긴다.
   */
  readonly ruleSeverity: ComplianceGrade;
  /** 이 판정의 근거가 된 출처. UI가 신뢰도 배지를 붙일 수 있도록 노출한다. */
  readonly provenance: SpecProvenance;
}

export interface SpecAuditResult {
  readonly platform: WebtoonPlatformSpec;
  readonly overallGrade: ComplianceGrade;
  readonly isCompliant: boolean;
  readonly issues: readonly SpecAuditIssue[];
  readonly recommendedSliceCount: number;
  readonly summary: string;
}

export interface ThumbnailAuditInput {
  readonly width: number;
  readonly height: number;
  readonly sizeBytes?: number;
}

export interface ThumbnailAuditResult {
  readonly spec: ThumbnailSpec;
  readonly overallGrade: ComplianceGrade;
  readonly issues: readonly SpecAuditIssue[];
}

export interface ElementBoundingBox {
  readonly top: number;
  readonly bottom: number;
  readonly label?: string;
}

export interface SafeSliceRange {
  readonly sliceIndex: number;
  readonly topY: number;
  readonly bottomY: number;
  readonly heightPx: number;
  /** 이 슬라이스의 아래 절단선이 보호 요소를 가로지르지 않았는가. 마지막 슬라이스는 절단이 아니므로 true. */
  readonly isGutterCut: boolean;
}

export interface AutoSlicePlan {
  readonly totalHeightPx: number;
  readonly targetSliceHeightPx: number;
  readonly slices: readonly SafeSliceRange[];
  readonly sliceCount: number;
  /** 실제 절단선(= 슬라이스 수 - 1) 중 보호 요소를 피한 비율. 절단이 없으면 100. */
  readonly safeSplitSuccessRate: number;
}

const MB = 1024 * 1024;
const KB = 1024;

/**
 * 플랫폼이 세로 상한을 두지 않을 때 대신 쓰는 실질 상한(px).
 *
 * 브라우저 캔버스 한 변의 이식 가능 한계로, 이 저장소의 내보내기 경로(studio-export)가 이미
 * 같은 값을 쓰고 있다. 플랫폼 규칙이 아니므로 `hasPlatformHeightCap: false` 와 함께 쓴다.
 */
const PORTABLE_RENDER_CEILING_PX = 16_384;

// ── 출처 정의 ────────────────────────────────────────────────────────────────
// 아래 상수를 여러 플랫폼이 공유한다. 새 수치를 넣을 때는 반드시 여기 출처를 먼저 만든다.

const WEBTOON_CANVAS_HELP_URL =
  "https://webtooncanvas.zendesk.com/hc/en-us/articles/32913712749588-File-Size-Overview-What-to-Know-before-Publishing-your-Comic-on-WEBTOON-CANVAS";
const TAPAS_FILE_SIZE_GUIDE_URL = "https://www.creators.tapas.io/file-size-guide";
const KAKAO_JOINUS_URL = "https://webtoon.kakao.com/joinus";
const TOONSLICER_URL = "https://toonslicer.com";

/** WEBTOON CANVAS 공식 업로드 규격 (헬프센터 기사 32913712749588 + webtoons.com 공지 3320·1766). */
const CANVAS_OFFICIAL: SpecProvenance = {
  confidence: "official",
  kind: "platform-rule",
  source: "WEBTOON CANVAS 공식 헬프센터 (File Size Overview) 및 webtoons.com 공지 3320·1766",
  url: WEBTOON_CANVAS_HELP_URL,
  checkedOn: WEBTOON_PLATFORM_SPEC_SNAPSHOT_DATE,
};

/**
 * WEBTOON CANVAS 공식 창작 가이드의 연출 수치 (컷 간격 200px 이상, 장면·시간 전환 600~1000px,
 * 한 화면에 컷 2개 이하).
 *
 * 이 프로젝트에서 컷 간격에 대해 확보한 유일한 1차 출처다. 다른 플랫폼은 자체 컷 간격 지침을
 * 발행하지 않으므로, 이 수치를 플랫폼 공통 연출 지침으로 적용하고 `kind: "craft-guidance"`로
 * 표시해 업로드 규칙과 구분한다 — 여백이 좁다고 원고를 반려하는 플랫폼은 없다.
 */
const CANVAS_CRAFT_GUIDANCE: SpecProvenance = {
  confidence: "official",
  kind: "craft-guidance",
  source: "WEBTOON CANVAS 공식 크리에이터 가이드 (컷 간격 200px 이상 · 장면 전환 600~1000px)",
  url: WEBTOON_CANVAS_HELP_URL,
  checkedOn: WEBTOON_PLATFORM_SPEC_SNAPSHOT_DATE,
  note: "업로드 규칙이 아니라 연출 지침이다. 위반해도 업로드는 통과한다.",
};

/** Tapas 공식 File Size Guide. */
const TAPAS_OFFICIAL: SpecProvenance = {
  confidence: "official",
  kind: "platform-rule",
  source: "Tapas 공식 File Size Guide",
  url: TAPAS_FILE_SIZE_GUIDE_URL,
  checkedOn: WEBTOON_PLATFORM_SPEC_SNAPSHOT_DATE,
};

/**
 * 네이버 도전/베스트도전 규격의 유일한 확보 출처인 외부 정리본.
 *
 * 네이버 공식 페이지는 이번 조사에서 열리지 않았다. 이 중 "690px + JPG"만 별개 출처(네이버
 * 공모전 요강·한국만화영상진흥원 자료)로 교차 확인됐고, 나머지 수치는 교차 확인되지 않았다.
 */
const NAVER_THIRD_PARTY: SpecProvenance = {
  confidence: "third-party",
  kind: "platform-rule",
  source: "toonslicer.com 정리본 (네이버 공식 페이지 열람 실패)",
  url: TOONSLICER_URL,
  checkedOn: WEBTOON_PLATFORM_SPEC_SNAPSHOT_DATE,
  note: "교차 확인되지 않은 저신뢰 수치. 업로드 전 네이버 공식 공지로 직접 확인할 것.",
};

/** 690px 폭과 JPG 사용은 외부 정리본과 별개로 네이버 공모전 요강·KOMACON 자료에서 교차 확인됐다. */
const NAVER_CORROBORATED: SpecProvenance = {
  confidence: "third-party",
  kind: "platform-rule",
  source: "toonslicer.com 정리본 + 네이버 공모전 요강·한국만화영상진흥원 자료 교차 확인",
  url: TOONSLICER_URL,
  checkedOn: WEBTOON_PLATFORM_SPEC_SNAPSHOT_DATE,
  corroborated: true,
};

/** 카카오페이지 업로드 규격 외부 정리본. 카카오 공식 문서로 확인하지 못했다. */
const KAKAO_THIRD_PARTY: SpecProvenance = {
  confidence: "third-party",
  kind: "platform-rule",
  source: "카카오페이지 업로드 규격 외부 정리본 (카카오 공식 문서 미확인)",
  checkedOn: WEBTOON_PLATFORM_SPEC_SNAPSHOT_DATE,
  note: "저신뢰 수치. 카카오 공식 안내로 직접 확인할 것.",
};

/** 레진 2025 공모전 요강. 상시 업로드 규격이 아니라 공모전 제출 규격이다. */
const LEZHIN_CONTEST_2025: SpecProvenance = {
  confidence: "third-party",
  kind: "platform-rule",
  source: "레진코믹스 2025 공모전 제출 규격 (1440px · 300dpi · JPG)",
  checkedOn: WEBTOON_PLATFORM_SPEC_SNAPSHOT_DATE,
  note: "공모전 기준이며 상시 연재 업로드 규격과 다를 수 있다.",
};

/**
 * 출처를 확보하지 못한 수치.
 *
 * 탑툰·포스타입의 원고 규격은 이번 조사에서 1차 출처를 찾지 못했다. 이 파일에 먼저 적혀 있던
 * 값을 지우지 않고 그대로 두되(임의의 새 숫자를 지어내지 않는다) 미검증으로 표시하고,
 * 감사에서는 절대 "fail"을 내지 않는다.
 */
const UNVERIFIED_LEGACY: SpecProvenance = {
  confidence: "unverified",
  kind: "platform-rule",
  source: "출처 미확인 — 이 저장소에 먼저 기록돼 있던 값",
  checkedOn: WEBTOON_PLATFORM_SPEC_SNAPSHOT_DATE,
  note: "1차 출처를 확인하지 못했다. 판정 근거로 쓰지 말고 플랫폼 공식 안내를 확인할 것.",
};

/**
 * WEBTOON CANVAS 회차 썸네일 규격이 플랫폼 문서끼리 어긋난다.
 *
 * 현행 헬프센터는 202x142, 더 오래된 플랫폼 공지는 160x151을 적고 있다. 어느 한쪽을 고르면
 * 나머지 한쪽 기준으로 만든 썸네일이 조용히 반려되므로, 두 값을 모두 보존하고 감사에서 경고로
 * 알린다.
 */
const CANVAS_EPISODE_THUMBNAIL_CONFLICT: SpecValueConflict = {
  field: "width",
  summary: "회차 썸네일 크기를 플랫폼 문서가 서로 다르게 적고 있습니다 (202x142 · 160x151).",
  candidates: [
    {
      value: "202 x 142 px",
      provenance: CANVAS_OFFICIAL,
    },
    {
      value: "160 x 151 px",
      provenance: {
        confidence: "official",
        kind: "platform-rule",
        source: "webtoons.com 구 공지 (헬프센터보다 오래된 문서)",
        checkedOn: WEBTOON_PLATFORM_SPEC_SNAPSHOT_DATE,
      },
    },
  ],
};

/**
 * WEBTOON CANVAS 썸네일 규격 (공식 헬프센터).
 * 시리즈 정방형 1080x1080 500KB 미만, 시리즈 세로형 1080x1920 700KB 미만, 회차 202x142 500KB 미만.
 */
export const WEBTOON_CANVAS_THUMBNAIL_SPECS: readonly ThumbnailSpec[] = [
  {
    slot: "series-square",
    label: "시리즈 정방형 썸네일",
    widthPx: 1080,
    heightPx: 1080,
    maxBytesExclusive: 500 * KB,
    provenance: CANVAS_OFFICIAL,
  },
  {
    slot: "series-vertical",
    label: "시리즈 세로형 썸네일",
    widthPx: 1080,
    heightPx: 1920,
    maxBytesExclusive: 700 * KB,
    provenance: CANVAS_OFFICIAL,
  },
  {
    slot: "episode",
    label: "회차 썸네일",
    widthPx: 202,
    heightPx: 142,
    maxBytesExclusive: 500 * KB,
    provenance: CANVAS_OFFICIAL,
    conflicts: [CANVAS_EPISODE_THUMBNAIL_CONFLICT],
  },
];

export const WEBTOON_PLATFORM_SPECS: Record<WebtoonPlatformId, WebtoonPlatformSpec> = {
  "naver-webtoon": {
    id: "naver-webtoon",
    // 표시명은 StudioCompanionAssistantDisplay.test.tsx 가 문자열로 고정하고 있어 그대로 둔다.
    // 다만 아래 수치의 출처는 도전/베스트도전 기준이며 정식 연재 규격은 확인하지 못했다 —
    // 그 사실은 description 에 적는다.
    name: "네이버웹툰 (도전/베도/정식)",
    // 690px: 외부 정리본 + 네이버 공모전 요강·KOMACON 자료 교차 확인.
    recommendedWidthPx: 690,
    allowedWidthsPx: [690],
    // 1280px: toonslicer.com 정리본. 이 저장소의 내보내기 프리셋(naver-challenge)도 같은 1280을
    // 쓰고 있어, 종전에 이 표에만 있던 근거 없는 20000/10000을 대체한다.
    maxSliceHeightPx: 1280,
    recommendedSliceHeightPx: 1280,
    maxFileSizeBytes: 5 * MB, // toonslicer.com 정리본 (내보내기 프리셋과 동일).
    // PNG는 거부된다고 보고됐다 — 저신뢰 출처이므로 allowedFormats 에서 빼되 fail 이 아닌 warn.
    allowedFormats: ["jpg", "gif"],
    deniedFormats: [{ format: "png", provenance: NAVER_THIRD_PARTY }],
    minGutterPx: 200,
    maxGutterPx: 1000,
    episodeBudget: {
      maxEpisodeBytes: 50 * MB, // toonslicer.com 정리본 (내보내기 프리셋과 동일).
      provenance: NAVER_THIRD_PARTY,
    },
    thumbnails: [],
    provenance: {
      width: NAVER_CORROBORATED,
      height: NAVER_THIRD_PARTY,
      size: NAVER_THIRD_PARTY,
      format: NAVER_CORROBORATED, // JPG 사용 자체는 교차 확인됨. PNG 거부는 deniedFormats 쪽 저신뢰.
      gutter: CANVAS_CRAFT_GUIDANCE,
    },
    conflicts: [],
    sourceUrls: [TOONSLICER_URL],
    description:
      "도전만화/베스트도전 기준: 가로 690px 고정, 컷당 최대 1280px·5MB, 회차 합계 약 50MB, PNG 거부 보고(저신뢰). 정식 연재 규격은 확인하지 못했고, 690px·JPG 외 수치는 외부 정리본 기준입니다.",
  },
  "kakao-page": {
    id: "kakao-page",
    name: "카카오페이지 / 카카오웹툰",
    recommendedWidthPx: 720,
    allowedWidthsPx: [720],
    // 약 1100px: 외부 정리본. 이 저장소의 내보내기 프리셋은 4200px 을 적고 있어 서로 어긋난다 →
    // conflicts 에 두 값을 모두 남기고 감사에서 경고한다.
    maxSliceHeightPx: 1100,
    recommendedSliceHeightPx: 1100,
    maxFileSizeBytes: 5 * MB, // 외부 정리본.
    allowedFormats: ["jpg", "png"],
    deniedFormats: [],
    minGutterPx: 200,
    maxGutterPx: 1000,
    thumbnails: [],
    provenance: {
      width: KAKAO_THIRD_PARTY,
      height: KAKAO_THIRD_PARTY,
      size: KAKAO_THIRD_PARTY,
      format: KAKAO_THIRD_PARTY,
      gutter: CANVAS_CRAFT_GUIDANCE,
    },
    conflicts: [
      {
        field: "height",
        summary: "컷 1장 최대 세로 길이를 두 출처가 다르게 적고 있습니다 (약 1100px · 4200px).",
        candidates: [
          { value: "약 1100px", provenance: KAKAO_THIRD_PARTY },
          {
            value: "4200px",
            provenance: {
              confidence: "unverified",
              kind: "platform-rule",
              source: "이 저장소의 내보내기 프리셋 studio-export-presets.ts (kakaopage)",
              checkedOn: WEBTOON_PLATFORM_SPEC_SNAPSHOT_DATE,
            },
          },
        ],
      },
    ],
    sourceUrls: [KAKAO_JOINUS_URL],
    description:
      "가로 720px, 컷당 5MB. 카카오 상시투고(공식)는 1화 완성 + 2~3화 콘티, 회차당 50컷 이상, JPG, ZIP 1개 제출입니다. 세로 길이 수치는 출처 간 불일치가 있습니다.",
  },
  "webtoon-canvas": {
    id: "webtoon-canvas",
    name: "WEBTOON CANVAS (글로벌)",
    recommendedWidthPx: 800,
    allowedWidthsPx: [800],
    maxSliceHeightPx: 1280, // 공식: 회차 이미지 최대 800 x 1280px. 업로더가 긴 이미지를 이 크기로 자동 분할한다.
    recommendedSliceHeightPx: 1280,
    maxFileSizeBytes: 2 * MB, // 공식: 이미지 1장당 2MB 이하.
    allowedFormats: ["jpg", "png"], // 공식: JPG/JPEG/PNG. 종전 이 파일의 "JPG 전용"은 공식 문서와 어긋났다.
    deniedFormats: [],
    minGutterPx: 200, // 공식 창작 가이드: 컷 간격 200px 이상.
    maxGutterPx: 1000, // 공식 창작 가이드: 장면·시간 전환 여백 600~1000px.
    episodeBudget: {
      maxEpisodeBytes: 20 * MB, // 공식: 회차당 20MB 또는 100장 중 먼저 걸리는 쪽.
      maxImageCount: 100,
      provenance: CANVAS_OFFICIAL,
    },
    thumbnails: WEBTOON_CANVAS_THUMBNAIL_SPECS,
    provenance: {
      width: CANVAS_OFFICIAL,
      height: CANVAS_OFFICIAL,
      size: CANVAS_OFFICIAL,
      format: CANVAS_OFFICIAL,
      gutter: CANVAS_CRAFT_GUIDANCE,
    },
    conflicts: [CANVAS_EPISODE_THUMBNAIL_CONFLICT],
    sourceUrls: [WEBTOON_CANVAS_HELP_URL],
    description:
      "가로 800px · 세로 최대 1280px · 장당 2MB 이하 JPG/PNG. 회차 합계 20MB 또는 100장 중 먼저 걸리는 쪽이 상한입니다.",
  },
  tapas: {
    id: "tapas",
    name: "Tapas",
    recommendedWidthPx: 940, // 공식 File Size Guide: 페이지 폭 940px.
    allowedWidthsPx: [940],
    // 공식 가이드에 세로 상한이 없다(GIF만 1000px). 이 표는 포맷별 높이를 표현하지 못하므로
    // 임의의 상한을 지어내는 대신, 브라우저 캔버스 이식 한계 16384px 를 실질 상한으로 두고
    // hasPlatformHeightCap: false 로 "플랫폼 규칙이 아님"을 명시한다.
    maxSliceHeightPx: PORTABLE_RENDER_CEILING_PX,
    // 공식 권장 분할 높이가 없다. 상한과 같게 두어 "굳이 나눌 필요 없음"을 그대로 반영한다.
    recommendedSliceHeightPx: PORTABLE_RENDER_CEILING_PX,
    hasPlatformHeightCap: false,
    maxFileSizeBytes: 2 * MB, // 공식: 파일당 2MB 이하.
    allowedFormats: ["png", "jpg", "gif"],
    deniedFormats: [],
    minGutterPx: 200,
    maxGutterPx: 1000,
    episodeBudget: {
      maxEpisodeBytes: 20 * MB, // 공식: 회차당 20MB 이하.
      provenance: TAPAS_OFFICIAL,
    },
    thumbnails: [
      {
        slot: "episode",
        label: "썸네일",
        widthPx: 300,
        heightPx: 300,
        maxBytesExclusive: 2 * MB,
        provenance: TAPAS_OFFICIAL,
      },
      {
        slot: "series-vertical",
        label: "북 커버",
        widthPx: 960,
        heightPx: 1440,
        maxBytesExclusive: 2 * MB,
        provenance: TAPAS_OFFICIAL,
      },
    ],
    provenance: {
      width: TAPAS_OFFICIAL,
      height: TAPAS_OFFICIAL,
      size: TAPAS_OFFICIAL,
      format: TAPAS_OFFICIAL,
      gutter: CANVAS_CRAFT_GUIDANCE,
    },
    conflicts: [],
    sourceUrls: [TAPAS_FILE_SIZE_GUIDE_URL],
    description:
      "가로 940px · 세로 제한 없음(GIF만 1000px) · 파일당 2MB · 회차 합계 20MB. 썸네일 300x300, 북 커버 960x1440.",
  },
  "lezhin-comics": {
    id: "lezhin-comics",
    name: "레진코믹스",
    recommendedWidthPx: 1440, // 2025 공모전 요강.
    allowedWidthsPx: [1280, 1440], // 1280은 그 이전 요강 값 — conflicts 참고.
    maxSliceHeightPx: 25000,
    recommendedSliceHeightPx: 12000,
    maxFileSizeBytes: 10 * MB,
    allowedFormats: ["jpg"], // 2025 공모전 요강: JPG.
    deniedFormats: [],
    minGutterPx: 200,
    maxGutterPx: 1000,
    thumbnails: [],
    provenance: {
      width: LEZHIN_CONTEST_2025,
      height: UNVERIFIED_LEGACY,
      size: UNVERIFIED_LEGACY,
      format: LEZHIN_CONTEST_2025,
      gutter: CANVAS_CRAFT_GUIDANCE,
    },
    conflicts: [
      {
        field: "width",
        summary: "제출 가로폭이 요강 개정으로 달라졌습니다 (1440px · 1280px).",
        candidates: [
          { value: "1440px (2025 공모전)", provenance: LEZHIN_CONTEST_2025 },
          {
            value: "1280px (이전 안내)",
            provenance: {
              confidence: "third-party",
              kind: "platform-rule",
              source: "레진코믹스 이전 제출 안내",
              checkedOn: WEBTOON_PLATFORM_SPEC_SNAPSHOT_DATE,
            },
          },
        ],
      },
    ],
    sourceUrls: [],
    description:
      "가로 1440px · 300dpi · JPG (2025 공모전 기준). 세로 길이와 용량 상한은 출처를 확인하지 못했습니다.",
  },
  toptoon: {
    id: "toptoon",
    name: "탑툰 (Toptoon)",
    // 이번 조사에서 탑툰 원고 규격의 1차 출처를 찾지 못했다. 값을 지어내지 않고 기존 값을
    // 유지하되 전 항목을 미검증으로 표시한다 — 감사에서 fail 이 나오지 않는다.
    recommendedWidthPx: 800,
    allowedWidthsPx: [800],
    maxSliceHeightPx: 20000,
    recommendedSliceHeightPx: 10000,
    maxFileSizeBytes: 8 * MB,
    allowedFormats: ["jpg", "png"],
    deniedFormats: [],
    minGutterPx: 200,
    maxGutterPx: 1000,
    thumbnails: [],
    provenance: {
      width: UNVERIFIED_LEGACY,
      height: UNVERIFIED_LEGACY,
      size: UNVERIFIED_LEGACY,
      format: UNVERIFIED_LEGACY,
      gutter: CANVAS_CRAFT_GUIDANCE,
    },
    conflicts: [],
    sourceUrls: [],
    description: "원고 규격의 1차 출처를 확인하지 못했습니다. 아래 수치는 참고용이며 판정 근거로 쓸 수 없습니다.",
  },
  postype: {
    id: "postype",
    name: "포스타입 / 딜리헙 (독립연재)",
    recommendedWidthPx: 1600,
    allowedWidthsPx: [690, 720, 800, 1200, 1600],
    maxSliceHeightPx: 30000,
    recommendedSliceHeightPx: 15000,
    maxFileSizeBytes: 20 * MB,
    allowedFormats: ["jpg", "png", "webp"],
    deniedFormats: [],
    minGutterPx: 200,
    maxGutterPx: 1000,
    thumbnails: [],
    provenance: {
      width: UNVERIFIED_LEGACY,
      height: UNVERIFIED_LEGACY,
      size: UNVERIFIED_LEGACY,
      format: UNVERIFIED_LEGACY,
      gutter: CANVAS_CRAFT_GUIDANCE,
    },
    conflicts: [],
    sourceUrls: [],
    description: "원고 규격의 1차 출처를 확인하지 못했습니다. 아래 수치는 참고용이며 판정 근거로 쓸 수 없습니다.",
  },
};

const CONFIDENCE_LABEL: Record<SpecSourceConfidence, string> = {
  official: "공식",
  "third-party": "외부 출처",
  unverified: "미검증",
};

/** 메시지 끝에 붙는 출처 꼬리표. 감사 결과를 근거 없이 믿지 않게 하는 장치다. */
export function studioSpecSourceTag(provenance: SpecProvenance): string {
  const kind = provenance.kind === "craft-guidance" ? "연출 지침" : "업로드 규칙";
  return `[${kind} · ${CONFIDENCE_LABEL[provenance.confidence]} · ${provenance.source}]`;
}

/**
 * 출처 신뢰도에 따라 심각도를 낮춘다.
 *
 * 미검증 수치·교차 확인되지 않은 외부 출처·연출 지침 위반으로 원고를 "규격 미달"로 막아서는
 * 안 된다. 실제로 반려되는 규칙(공식 문서, 또는 교차 확인된 외부 출처의 업로드 규칙)만
 * fail 을 낼 수 있다.
 */
function cappedGrade(provenance: SpecProvenance, ruleSeverity: ComplianceGrade): ComplianceGrade {
  if (ruleSeverity !== "fail") return ruleSeverity;
  if (provenance.kind === "craft-guidance") return "warn";
  if (provenance.confidence === "official") return "fail";
  if (provenance.confidence === "third-party" && provenance.corroborated === true) return "fail";
  return "warn";
}

function makeIssue(
  field: SpecAuditField,
  ruleSeverity: ComplianceGrade,
  provenance: SpecProvenance,
  message: string,
  recommendation: string,
): SpecAuditIssue {
  return {
    grade: cappedGrade(provenance, ruleSeverity),
    ruleSeverity,
    field,
    message,
    recommendation,
    provenance,
  };
}

/** 절단선을 앞으로 당길 때 보장하는 최소 슬라이스 높이(px). */
const MIN_SLICE_HEIGHT_PX = 200;
/** 보호 요소 경계에서 띄우는 여유(px). */
const PROTECTED_ELEMENT_MARGIN_PX = 20;

export class WebtoonPlatformSpecValidator {
  /**
   * Evaluates canvas properties against a chosen webtoon platform.
   */
  public audit(platformId: WebtoonPlatformId, canvas: CanvasAuditInput): SpecAuditResult {
    const spec = WEBTOON_PLATFORM_SPECS[platformId];
    const issues: SpecAuditIssue[] = [];

    // 0. 규격 수치 자체가 어긋나는 항목을 먼저 알린다. 캔버스 입력과 무관하게 항상 뜬다.
    for (const conflict of spec.conflicts) {
      issues.push(
        makeIssue(
          "provenance",
          "warn",
          conflict.candidates[0].provenance,
          `${conflict.summary} ${conflict.candidates
            .map((c) => `${c.value} ${studioSpecSourceTag(c.provenance)}`)
            .join(" / ")}`,
          "업로드 전 플랫폼 공식 안내에서 어느 값이 현행인지 확인하세요.",
        ),
      );
    }

    // 0-1. 전 항목 미검증 플랫폼은 그 사실 자체를 알린다.
    const allUnverified = (["width", "height", "size", "format"] as const).every(
      (f) => spec.provenance[f].confidence === "unverified",
    );
    if (allUnverified) {
      issues.push(
        makeIssue(
          "provenance",
          "warn",
          spec.provenance.width,
          `${spec.name} 규격은 1차 출처를 확인하지 못했습니다. 아래 판정은 참고용입니다. ${studioSpecSourceTag(spec.provenance.width)}`,
          "플랫폼 공식 업로드 안내에서 폭·세로·용량·포맷을 직접 확인하세요.",
        ),
      );
    }

    // 1. Width validation
    if (!spec.allowedWidthsPx.includes(canvas.width)) {
      // ±20px 허용치는 폭 선택지가 여러 개인 플랫폼에만 의미가 있다. 단일 폭 플랫폼에서
      // "가로 800px 엄격 제한"이라 안내해 놓고 790px 를 통과시키면 안내문과 판정이 모순된다.
      const hasMultipleWidths = spec.allowedWidthsPx.length > 1;
      const isClose = hasMultipleWidths && spec.allowedWidthsPx.some((w) => Math.abs(w - canvas.width) <= 20);
      issues.push(
        makeIssue(
          "width",
          isClose ? "warn" : "fail",
          spec.provenance.width,
          `캔버스 가로폭(${canvas.width}px)이 허용 가로폭(${spec.allowedWidthsPx.join(" / ")}px)과 일치하지 않습니다. ${studioSpecSourceTag(spec.provenance.width)}`,
          `내보내기 시 가로폭을 ${spec.recommendedWidthPx}px로 리샘플링하거나 캔버스 규격을 변경하세요.`,
        ),
      );
    }

    // 2. Height & Slice estimation
    const recommendedSliceCount = Math.max(1, Math.ceil(canvas.height / spec.recommendedSliceHeightPx));
    if (canvas.height > spec.maxSliceHeightPx) {
      const isPlatformCap = spec.hasPlatformHeightCap !== false;
      issues.push(
        makeIssue(
          "height",
          "warn",
          spec.provenance.height,
          isPlatformCap
            ? `원고 전체 높이(${canvas.height}px)가 컷 1장 최대 높이(${spec.maxSliceHeightPx}px)를 초과합니다. ${studioSpecSourceTag(spec.provenance.height)}`
            : `${spec.name}에는 세로 상한이 없지만, 원고 높이(${canvas.height}px)가 브라우저 렌더 이식 한계(${spec.maxSliceHeightPx}px)를 넘어 내보내기가 실패할 수 있습니다.`,
          `원고를 최소 ${recommendedSliceCount}개 파일로 분할(Auto-Slice)하여 업로드하세요.`,
        ),
      );
    }

    // 3. Per-file size validation
    if (canvas.estimatedSizeBytes !== undefined && canvas.estimatedSizeBytes > spec.maxFileSizeBytes) {
      issues.push(
        makeIssue(
          "size",
          "fail",
          spec.provenance.size,
          `이미지 1장 예상 크기(${formatMb(canvas.estimatedSizeBytes)})가 장당 한도(${formatMb(spec.maxFileSizeBytes)})를 초과합니다. ${studioSpecSourceTag(spec.provenance.size)}`,
          "압축률을 80~85%로 조정하거나 슬라이스 분할 개수를 늘리세요.",
        ),
      );
    }

    // 4. Episode-level budget — 장당 한도와 별개 항목으로 낸다.
    //    4.9MB 12장은 장별로는 전부 통과하지만 회차 합계 58MB 로 반려된다.
    const budget = spec.episodeBudget;
    if (budget) {
      if (
        budget.maxEpisodeBytes !== undefined &&
        canvas.episodeTotalBytes !== undefined &&
        canvas.episodeTotalBytes > budget.maxEpisodeBytes
      ) {
        issues.push(
          makeIssue(
            "episode-size",
            "fail",
            budget.provenance,
            `회차 전체 용량(${formatMb(canvas.episodeTotalBytes)})이 회차 합계 한도(${formatMb(budget.maxEpisodeBytes)})를 초과합니다. ${studioSpecSourceTag(budget.provenance)}`,
            "장별 품질을 낮추거나 회차를 나누어 업로드하세요. 장별 한도를 지켜도 합계에서 반려될 수 있습니다.",
          ),
        );
      }
      if (
        budget.maxImageCount !== undefined &&
        canvas.episodeImageCount !== undefined &&
        canvas.episodeImageCount > budget.maxImageCount
      ) {
        issues.push(
          makeIssue(
            "episode-count",
            "fail",
            budget.provenance,
            `회차 이미지 장수(${canvas.episodeImageCount}장)가 장수 한도(${budget.maxImageCount}장)를 초과합니다. ${studioSpecSourceTag(budget.provenance)}`,
            `분할 높이를 키워 장수를 ${budget.maxImageCount}장 이하로 줄이거나 회차를 나누세요.`,
          ),
        );
      }
    }

    // 5. Format validation — 명시적 거부와 단순 미지원을 구분하고, 출처 신뢰도를 문구에 드러낸다.
    if (canvas.format) {
      const denied = spec.deniedFormats.find((d) => d.format === canvas.format);
      if (denied) {
        const isLowConfidence = denied.provenance.confidence !== "official";
        issues.push(
          makeIssue(
            "format",
            "fail",
            denied.provenance,
            `${canvas.format.toUpperCase()}은(는) ${spec.name}에서 거부된다고 ${isLowConfidence ? "보고됐습니다(교차 확인되지 않은 저신뢰 정보)" : "명시돼 있습니다"}. ${studioSpecSourceTag(denied.provenance)}`,
            isLowConfidence
              ? `${spec.allowedFormats.join(", ").toUpperCase()} 로 변환하는 편이 안전하지만, 업로드 전 플랫폼 공식 공지로 직접 확인하세요.`
              : `${spec.allowedFormats.join(", ").toUpperCase()} 포맷으로 변환하세요.`,
          ),
        );
      } else if (!spec.allowedFormats.includes(canvas.format)) {
        issues.push(
          makeIssue(
            "format",
            "fail",
            spec.provenance.format,
            `${canvas.format.toUpperCase()}은(는) ${spec.name} 지원 목록(${spec.allowedFormats.join(", ").toUpperCase()})에 없습니다. ${studioSpecSourceTag(spec.provenance.format)}`,
            `${spec.allowedFormats.join(", ").toUpperCase()} 포맷으로 변환하세요.`,
          ),
        );
      }
    }

    // 6. Gutter analysis — 권장 문구가 임계값과 같은 숫자를 말하도록 spec 값을 보간한다.
    if (canvas.panelGuttersPx && canvas.panelGuttersPx.length > 0) {
      const tooNarrow = canvas.panelGuttersPx.some((g) => g < spec.minGutterPx);
      const tooWide = canvas.panelGuttersPx.some((g) => g > spec.maxGutterPx);
      if (tooNarrow) {
        issues.push(
          makeIssue(
            "gutter",
            "warn",
            spec.provenance.gutter,
            `일부 컷 간격이 권장 최소값(${spec.minGutterPx}px)보다 좁아 모바일에서 호흡이 급박해질 수 있습니다. ${studioSpecSourceTag(spec.provenance.gutter)}`,
            `컷 사이 여백을 ${spec.minGutterPx}px 이상 확보하세요. 장면·시간 전환에는 600~1000px를 권장합니다.`,
          ),
        );
      }
      if (tooWide) {
        issues.push(
          makeIssue(
            "gutter",
            "warn",
            spec.provenance.gutter,
            `일부 컷 간격이 권장 최대값(${spec.maxGutterPx}px)을 넘어 독자가 빈 화면으로 오인할 수 있습니다. ${studioSpecSourceTag(spec.provenance.gutter)}`,
            `긴 여백 연출 시 효과선이나 부유 효과를 가미하거나 간격을 ${spec.maxGutterPx}px 이내로 압축하세요.`,
          ),
        );
      }
    }

    // 등급은 "작가의 원고에 문제가 있는가"만 말한다. `provenance` 항목은 원고가 아니라 우리
    // 규격표에 대한 단서(문서 간 불일치·미검증)이므로 등급에서 뺀다 — 넣으면 완벽한 CANVAS
    // 원고도 썸네일 문서 불일치 때문에 영구히 노란 배지를 달게 된다. 단서 자체는 issues 에
    // 그대로 남아 UI에 노출된다.
    const canvasIssues = issues.filter((i) => i.field !== "provenance");
    const hasFail = canvasIssues.some((i) => i.grade === "fail");
    const hasWarn = canvasIssues.some((i) => i.grade === "warn");
    const overallGrade: ComplianceGrade = hasFail ? "fail" : hasWarn ? "warn" : "pass";
    const sourceNoteCount = issues.length - canvasIssues.length;
    const sourceNote = sourceNoteCount > 0 ? ` · 규격 출처 주의 ${sourceNoteCount}건` : "";

    const summary = `${spec.name}: ${
      overallGrade === "pass"
        ? "모든 규격 적합 (Pass)"
        : overallGrade === "warn"
          ? `주의 사항 ${canvasIssues.length}건 (Warning)`
          : `규격 미달 ${canvasIssues.filter((i) => i.grade === "fail").length}건 (Fail)`
    }${sourceNote}`;

    return {
      platform: spec,
      overallGrade,
      isCompliant: !hasFail,
      issues,
      recommendedSliceCount,
      summary,
    };
  }

  /**
   * Audits one thumbnail image against a platform's thumbnail slot spec.
   *
   * 회차 썸네일처럼 플랫폼 문서끼리 크기가 어긋나는 슬롯은, 어긋난다는 사실을 먼저 알린 뒤
   * 현행 문서 값으로 판정한다.
   */
  public auditThumbnail(
    platformId: WebtoonPlatformId,
    slot: ThumbnailSlot,
    input: ThumbnailAuditInput,
  ): ThumbnailAuditResult | null {
    const spec = WEBTOON_PLATFORM_SPECS[platformId].thumbnails.find((t) => t.slot === slot);
    if (!spec) return null;

    const issues: SpecAuditIssue[] = [];

    for (const conflict of spec.conflicts ?? []) {
      issues.push(
        makeIssue(
          "provenance",
          "warn",
          conflict.candidates[0].provenance,
          `${conflict.summary} ${conflict.candidates
            .map((c) => `${c.value} ${studioSpecSourceTag(c.provenance)}`)
            .join(" / ")}`,
          "두 크기 중 어느 쪽이 현행인지 플랫폼 공식 안내로 확인하세요.",
        ),
      );
    }

    if (input.width !== spec.widthPx || input.height !== spec.heightPx) {
      issues.push(
        makeIssue(
          "width",
          "fail",
          spec.provenance,
          `${spec.label} 크기(${input.width}x${input.height})가 규격(${spec.widthPx}x${spec.heightPx})과 다릅니다. ${studioSpecSourceTag(spec.provenance)}`,
          `${spec.widthPx}x${spec.heightPx}px로 다시 내보내세요.`,
        ),
      );
    }

    // 공식 문언이 "미만(under)"이므로 경계값 자체는 통과시킨다.
    if (input.sizeBytes !== undefined && input.sizeBytes >= spec.maxBytesExclusive) {
      issues.push(
        makeIssue(
          "size",
          "fail",
          spec.provenance,
          `${spec.label} 용량(${formatKb(input.sizeBytes)})이 한도(${formatKb(spec.maxBytesExclusive)} 미만)를 넘습니다. ${studioSpecSourceTag(spec.provenance)}`,
          "압축률을 낮추거나 PNG 대신 JPG로 저장하세요.",
        ),
      );
    }

    const hasFail = issues.some((i) => i.grade === "fail");
    const hasWarn = issues.some((i) => i.grade === "warn");
    return {
      spec,
      overallGrade: hasFail ? "fail" : hasWarn ? "warn" : "pass",
      issues,
    };
  }

  /**
   * Plans vertical split points avoiding slicing across panels or characters.
   *
   * 절단선을 옮긴 뒤 반드시 다시 검증한다. 종전 구현은 `intersecting.top - 20` 으로 당긴
   * 절단선이 최소 슬라이스 높이에 걸려 요소 안쪽에 떨어져도 `isGutterCut: true` 로 보고했고,
   * 그 결과 planAutoSlices(1000, 250, [{top:100, bottom:400}]) 가 200px(보호 영역 한가운데)에서
   * 자르고도 "안전 여백 절단 100%"라고 답했다.
   */
  public planAutoSlices(
    totalHeight: number,
    targetSliceHeight: number,
    protectedElements: readonly ElementBoundingBox[] = [],
  ): AutoSlicePlan {
    const slices: SafeSliceRange[] = [];
    let currentTop = 0;
    let safeCutCount = 0;

    // 0 이하가 들어오면 절단선이 전진하지 않아 while 이 영원히 돈다. 순수 엔진이 호출자의
    // 입력 검증에 기대면 안 되므로 여기서 최소 높이로 끌어올린다.
    const step = Math.max(MIN_SLICE_HEIGHT_PX, Math.floor(targetSliceHeight) || 0);

    const crossesElement = (y: number): boolean =>
      protectedElements.some((el) => y > el.top && y < el.bottom);

    while (currentTop < totalHeight) {
      const candidateBottom = Math.min(totalHeight, currentTop + step);

      if (candidateBottom >= totalHeight) {
        // 마지막 구간은 스트립의 끝이지 절단선이 아니다. 안전 비율의 분자/분모 어느 쪽에도
        // 넣지 않는다 — 넣으면 절단이 전부 실패해도 비율이 0 이 되지 않고 부풀려진다.
        slices.push({
          sliceIndex: slices.length + 1,
          topY: currentTop,
          bottomY: totalHeight,
          heightPx: totalHeight - currentTop,
          isGutterCut: true,
        });
        break;
      }

      const intersecting = protectedElements.find(
        (el) => candidateBottom > el.top && candidateBottom < el.bottom,
      );

      let chosenBottom = candidateBottom;
      let isSafeGutter = !crossesElement(candidateBottom);

      if (intersecting) {
        // 요소 바로 앞으로 당기거나, 요소를 통째로 넘긴다. 어느 쪽이든 고른 뒤 다시 검증한다 —
        // 최소 슬라이스 높이에 눌려 요소 안쪽에 떨어지거나, 다른 요소를 새로 가로지를 수 있다.
        const beforeTop = Math.max(currentTop + MIN_SLICE_HEIGHT_PX, intersecting.top - PROTECTED_ELEMENT_MARGIN_PX);
        const afterBottom = intersecting.bottom + PROTECTED_ELEMENT_MARGIN_PX;

        const candidates: readonly number[] = [
          ...(beforeTop > currentTop && beforeTop < candidateBottom ? [beforeTop] : []),
          ...(afterBottom < totalHeight && afterBottom - currentTop <= step * 1.2
            ? [afterBottom]
            : []),
        ];

        const safeCandidate = candidates.find((y) => !crossesElement(y));
        if (safeCandidate !== undefined) {
          chosenBottom = safeCandidate;
          isSafeGutter = true;
        } else {
          chosenBottom = candidateBottom;
          isSafeGutter = false;
        }
      }

      if (isSafeGutter) safeCutCount++;

      slices.push({
        sliceIndex: slices.length + 1,
        topY: currentTop,
        bottomY: chosenBottom,
        heightPx: chosenBottom - currentTop,
        isGutterCut: isSafeGutter,
      });

      currentTop = chosenBottom;
    }

    const cutCount = Math.max(0, slices.length - 1);
    const safeRate = cutCount === 0 ? 100 : Number(((safeCutCount / cutCount) * 100).toFixed(1));

    return {
      totalHeightPx: totalHeight,
      // 보정된 실제 사용값을 돌려준다 — 요청값을 그대로 되비추면 왜 컷이 그 크기로 나왔는지
      // 호출자가 알 수 없다.
      targetSliceHeightPx: step,
      slices,
      sliceCount: slices.length,
      safeSplitSuccessRate: safeRate,
    };
  }
}

function formatMb(bytes: number): string {
  return `${(bytes / MB).toFixed(1)}MB`;
}

function formatKb(bytes: number): string {
  return `${Math.round(bytes / KB)}KB`;
}
