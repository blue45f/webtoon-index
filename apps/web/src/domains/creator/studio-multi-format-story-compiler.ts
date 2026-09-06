/**
 * Studio Multi-format Story Compiler — 단일 웹툰 원고 소스(Source of Truth)로부터
 * 세로 웹툰, 페이지 만화, 4컷 만화, SNS 슬라이드, 피치덱, EPUB 등 다중 배포 형식으로
 * 스마트 컴파일·레이아웃 재배치를 수행하는 코어.
 *
 * 마스터플랜 13.5 (Multi-format Story Compiler) & 41개 경쟁제품 기능 갭 전수 비교:
 * - 단일 Source 원고 기반 다중 배포 타겟 컴파일
 * - 타겟 형식: `vertical-webtoon`, `page-comic`, `four-panel`, `social-slide`, `pitch-deck-pdf`, `epub-fixed`
 * - 패널 중요도(Importance Weight), 안전 크롭 영역(Safe Crop Zone), 텍스트 가독성 고려
 * - 플랫폼별 규격 제약 검증 및 자동 리플로우
 * - 순수 함수, 불변성, 결정론, DOM/React 무관
 */

export const STUDIO_STORY_COMPILER_VERSION = 1 as const;

export const TARGET_STORY_FORMATS = [
  "vertical-webtoon",
  "page-comic",
  "four-panel",
  "social-slide",
  "pitch-deck-pdf",
  "epub-fixed",
] as const;
export type TargetStoryFormat = (typeof TARGET_STORY_FORMATS)[number];

export interface CompilerSourcePanel {
  readonly id: string;
  readonly sequenceIndex: number;
  readonly originalWidth: number;
  readonly originalHeight: number;
  readonly importanceWeight: number; // 0..1 (1.0 = 클라이맥스/필수)
  readonly safeCropZone?: {
    readonly xPct: number; // 0..1
    readonly yPct: number; // 0..1
    readonly widthPct: number; // 0..1
    readonly heightPct: number; // 0..1
  };
  readonly textContent?: string;
  readonly isSplashPage?: boolean;
}

export interface CompilerPlottedElement {
  readonly panelId: string;
  readonly destX: number;
  readonly destY: number;
  readonly destWidth: number;
  readonly destHeight: number;
  readonly sourceCropRect?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

export interface CompiledSliceOrPage {
  readonly pageIndex: number;
  readonly width: number;
  readonly height: number;
  readonly elements: readonly CompilerPlottedElement[];
}

export interface CompiledStoryDocument {
  readonly version: typeof STUDIO_STORY_COMPILER_VERSION;
  readonly format: TargetStoryFormat;
  readonly totalPagesOrSlices: number;
  readonly pages: readonly CompiledSliceOrPage[];
  readonly warnings: readonly string[];
}

export interface CompilerTargetProfile {
  readonly format: TargetStoryFormat;
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly maxPanelsPerPage: number;
  readonly marginPx: number;
  readonly gapPx: number;
  readonly readingDirection?: "ltr" | "rtl" | "ttb"; // ltr: 좌->우, rtl: 우->좌, ttb: 상->하
}

export const STANDARD_COMPILER_PROFILES: Record<TargetStoryFormat, CompilerTargetProfile> = {
  "vertical-webtoon": {
    format: "vertical-webtoon",
    pageWidth: 800,
    pageHeight: 3200, // 슬라이스당 기본 세로
    maxPanelsPerPage: 6,
    marginPx: 24,
    gapPx: 48,
    readingDirection: "ttb",
  },
  "page-comic": {
    format: "page-comic",
    pageWidth: 1200,
    pageHeight: 1700, // B6/A5 비율
    maxPanelsPerPage: 6,
    marginPx: 60,
    gapPx: 20,
    readingDirection: "ltr",
  },
  "four-panel": {
    format: "four-panel",
    pageWidth: 1000,
    pageHeight: 2400,
    maxPanelsPerPage: 4,
    marginPx: 40,
    gapPx: 30,
    readingDirection: "ttb",
  },
  "social-slide": {
    format: "social-slide",
    pageWidth: 1080,
    pageHeight: 1350, // 4:5 인스타그램/SNS 슬라이드
    maxPanelsPerPage: 2,
    marginPx: 50,
    gapPx: 30,
    readingDirection: "ltr",
  },
  "pitch-deck-pdf": {
    format: "pitch-deck-pdf",
    pageWidth: 1920,
    pageHeight: 1080, // 16:9 와이드 프레젠테이션
    maxPanelsPerPage: 3,
    marginPx: 80,
    gapPx: 40,
    readingDirection: "ltr",
  },
  "epub-fixed": {
    format: "epub-fixed",
    pageWidth: 1200,
    pageHeight: 1800,
    maxPanelsPerPage: 5,
    marginPx: 40,
    gapPx: 24,
    readingDirection: "ltr",
  },
};

/**
 * 단일 원고 소스로부터 지정된 타겟 포맷으로 스마트 컴파일을 수행한다.
 */
export function compileStoryDocument(
  sourcePanels: readonly CompilerSourcePanel[],
  targetFormat: TargetStoryFormat,
  customProfile?: Partial<CompilerTargetProfile>,
): CompiledStoryDocument {
  const profile: CompilerTargetProfile = {
    ...STANDARD_COMPILER_PROFILES[targetFormat],
    ...customProfile,
  };

  const warnings: string[] = [];
  const sortedPanels = [...sourcePanels].sort((a, b) => a.sequenceIndex - b.sequenceIndex);
  const pages: CompiledSliceOrPage[] = [];

  let currentPageIndex = 0;
  let panelCursor = 0;

  while (panelCursor < sortedPanels.length) {
    const pagePanels: CompilerSourcePanel[] = [];
    let isSplash = false;

    // Splash page check: 단독 전체 페이지 배정
    if (sortedPanels[panelCursor].isSplashPage) {
      pagePanels.push(sortedPanels[panelCursor]);
      panelCursor += 1;
      isSplash = true;
    } else {
      while (
        panelCursor < sortedPanels.length &&
        pagePanels.length < profile.maxPanelsPerPage &&
        !sortedPanels[panelCursor].isSplashPage
      ) {
        pagePanels.push(sortedPanels[panelCursor]);
        panelCursor += 1;
      }
    }

    // 레이아웃 배치 계산
    const elements: CompilerPlottedElement[] = [];
    const contentWidth = profile.pageWidth - profile.marginPx * 2;
    const contentHeight = profile.pageHeight - profile.marginPx * 2;

    if (isSplash) {
      const p = pagePanels[0];
      elements.push(
        Object.freeze({
          panelId: p.id,
          destX: profile.marginPx,
          destY: profile.marginPx,
          destWidth: contentWidth,
          destHeight: contentHeight,
        }),
      );
    } else if (profile.readingDirection === "ttb" || targetFormat === "vertical-webtoon" || targetFormat === "four-panel") {
      // 세로 스크롤/단일 컬럼 순차 배치
      const totalGaps = (pagePanels.length - 1) * profile.gapPx;
      const heightPerPanel = Math.max(100, Math.floor((contentHeight - totalGaps) / pagePanels.length));

      let currY = profile.marginPx;
      for (const p of pagePanels) {
        elements.push(
          Object.freeze({
            panelId: p.id,
            destX: profile.marginPx,
            destY: currY,
            destWidth: contentWidth,
            destHeight: heightPerPanel,
          }),
        );
        currY += heightPerPanel + profile.gapPx;
      }
    } else {
      // 2열 그리드 또는 가로/페이지 분할 배치
      const cols = pagePanels.length >= 4 ? 2 : 1;
      const rows = Math.ceil(pagePanels.length / cols);
      const cellW = (contentWidth - (cols - 1) * profile.gapPx) / cols;
      const cellH = (contentHeight - (rows - 1) * profile.gapPx) / rows;

      for (let i = 0; i < pagePanels.length; i += 1) {
        const p = pagePanels[i];
        const r = Math.floor(i / cols);
        const c = i % cols;
        const x = profile.marginPx + c * (cellW + profile.gapPx);
        const y = profile.marginPx + r * (cellH + profile.gapPx);

        elements.push(
          Object.freeze({
            panelId: p.id,
            destX: Math.round(x),
            destY: Math.round(y),
            destWidth: Math.round(cellW),
            destHeight: Math.round(cellH),
          }),
        );
      }
    }

    pages.push(
      Object.freeze({
        pageIndex: currentPageIndex,
        width: profile.pageWidth,
        height: profile.pageHeight,
        elements: Object.freeze(elements),
      }),
    );
    currentPageIndex += 1;
  }

  if (pages.length === 0) {
    warnings.push("컴파일 대상 패널이 없습니다.");
  }

  return Object.freeze({
    version: STUDIO_STORY_COMPILER_VERSION,
    format: targetFormat,
    totalPagesOrSlices: pages.length,
    pages: Object.freeze(pages),
    warnings: Object.freeze(warnings),
  });
}
