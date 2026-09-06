/**
 * webtoon-scroll-pacing-simulator.ts
 *
 * Mobile Webtoon Scroll Rhythm & Narrative Pacing Simulator.
 *
 * - Analyzes vertical gutters between sequential panels to detect narrative pacing beats.
 * - Simulates mobile reader vertical scrolling speeds (casual, skimmer, immersive).
 * - Computes panel dwell times and alerts when scenes feel too rushed or dragged out.
 *
 * WHERE THE BAND EDGES COME FROM (2026-09-03)
 * -------------------------------------------
 * The band edges used to be five unsourced round numbers (50/180/380/650/1200). Two of them
 * contradicted the only primary source we have. WEBTOON CANVAS's own creator guidance states:
 *   • a panel gutter of at least 200px,
 *   • 600~1000px for a scene or time transition,
 *   • at most 2 panels visible on one screen.
 * (WEBTOON CANVAS 공식 크리에이터 가이드 — same document cited by
 *  webtoon-platform-spec-validator.ts's CANVAS_CRAFT_GUIDANCE.)
 *
 * Reconciled against that:
 *   • `action-rush` now ends at 200 rather than 180, so the band boundary IS the platform's stated
 *     minimum gutter. Its guidance no longer calls sub-minimum spacing simply "적합" — a deliberate
 *     rapid-fire beat is legitimate, but the reader is told it sits under the published minimum.
 *   • `scene-transition` is now exactly 600~1000. The old 380~650 named a range the source does not
 *     consider a transition at all, and stopped 350px short of where the source's band ends.
 *   • `dialogue-beat` fills 200~600 — from the sourced minimum up to the start of the sourced
 *     transition band.
 *   • `suspense-cliffhanger` (1000~1200) and `excessive-void` (>1200) are NOT sourced. 1200 was
 *     already here and no primary source contradicts it, so it is kept rather than replaced with an
 *     invented number — but both are marked as heuristics in `PACING_BAND_SOURCES` so nobody
 *     mistakes them for platform guidance.
 *
 * `SCROLL_SPEEDS_PX_PER_SEC` and the dwell-time bonus are likewise unsourced estimates; they are
 * left at their existing values and labelled, not silently dressed up.
 */

export type PacingBeatType =
  | "action-rush" // <200px: below the CANVAS minimum gutter — deliberate rapid-fire / shock beats
  | "dialogue-beat" // 200~600px: conversational tempo & emotional reactions
  | "scene-transition" // 600~1000px: time lapse or location shift (CANVAS guidance)
  | "suspense-cliffhanger" // 1000~1200px: cliffhanger, dramatic silence (heuristic)
  | "excessive-void"; // >1200px: potential reader dropout / blank screen hazard (heuristic)

/** WEBTOON CANVAS 공식 크리에이터 가이드가 명시한 컷 간격 최소값(px). */
export const CANVAS_MIN_GUTTER_PX = 200;
/** 같은 가이드가 장면·시간 전환 여백으로 제시한 구간(px). */
export const CANVAS_SCENE_TRANSITION_PX = { min: 600, max: 1000 } as const;
/** 같은 가이드가 제시한 한 화면당 최대 컷 수. */
export const CANVAS_MAX_PANELS_PER_SCREEN = 2;
/** 출처 없는 휴리스틱 임계값 — 이 위로는 빈 화면 오인 경고를 낸다. */
const EXCESSIVE_VOID_PX = 1200;

/** 각 구간 경계가 어디서 왔는지. 공식 수치와 휴리스틱을 UI가 구분해 보여줄 수 있게 한다. */
export const PACING_BAND_SOURCES: Readonly<
  Record<PacingBeatType, { readonly sourced: boolean; readonly basis: string }>
> = {
  "action-rush": {
    sourced: true,
    basis: "WEBTOON CANVAS 공식 크리에이터 가이드의 최소 컷 간격 200px 미만 구간",
  },
  "dialogue-beat": {
    sourced: true,
    basis: "최소 간격 200px부터 공식 장면 전환 구간 시작(600px) 직전까지",
  },
  "scene-transition": {
    sourced: true,
    basis: "WEBTOON CANVAS 공식 크리에이터 가이드의 장면·시간 전환 여백 600~1000px",
  },
  "suspense-cliffhanger": {
    sourced: false,
    basis: "출처 없음 — 공식 전환 구간(1000px)과 기존 공백 경고선(1200px) 사이의 휴리스틱",
  },
  "excessive-void": {
    sourced: false,
    basis: "출처 없음 — 이 저장소에 먼저 있던 1200px 경고선을 유지",
  },
};

export type ReaderScrollSpeedProfile = "casual" | "skimmer" | "immersive";

export interface PanelVerticalSpan {
  readonly id: string;
  readonly topY: number;
  readonly bottomY: number;
  readonly heightPx: number;
  readonly dialogueCount?: number;
}

export interface PacingBeatAnalysis {
  readonly fromPanelIndex: number;
  readonly toPanelIndex: number;
  readonly gutterDistancePx: number;
  readonly beatType: PacingBeatType;
  readonly label: string;
  readonly guidance: string;
}

export interface PacingSimulationOptions {
  /**
   * 독자 화면 세로 크기(px). 주면 "한 화면에 컷 2개 이하"(CANVAS 공식 가이드)를 함께 점검한다.
   *
   * 기본값을 두지 않는 이유: 화면 높이는 기기마다 다르고, 이 저장소에는 그 값의 1차 출처가
   * 없다. 임의의 숫자를 기본값으로 박으면 근거 없는 경고가 생기므로, 호출자가 실제 프리뷰
   * 뷰포트 높이를 넘겨줄 때만 검사한다.
   */
  readonly readerViewportHeightPx?: number;
}

export interface PacingSimulationResult {
  readonly totalCanvasHeightPx: number;
  readonly panelCount: number;
  readonly averageGutterPx: number;
  readonly beats: readonly PacingBeatAnalysis[];
  readonly estimatedReadingSeconds: {
    readonly casual: number; // ~350 px/sec
    readonly skimmer: number; // ~700 px/sec
    readonly immersive: number; // ~180 px/sec
  };
  readonly pacingHealthScore: number; // 0..100
  /**
   * `readerViewportHeightPx` 를 준 경우, 한 화면에 동시에 보이는 최대 컷 수.
   * 주지 않았으면 undefined — 검사하지 않았다는 뜻이며 0 과 구분된다.
   */
  readonly maxPanelsPerScreen?: number;
  readonly warnings: readonly string[];
  readonly summary: string;
}

/**
 * 독자 스크롤 속도 추정치(px/s).
 *
 * 출처 없는 추정값이다. 1차 출처를 확보하지 못해 기존 값을 그대로 두었고, 임의로 바꾸지도
 * 않았다. 완독 시간은 어디까지나 상대 비교용으로 읽어야 한다.
 */
export const SCROLL_SPEEDS_PX_PER_SEC: Record<ReaderScrollSpeedProfile, number> = {
  casual: 350,
  skimmer: 700,
  immersive: 180,
};

export class WebtoonScrollPacingSimulator {
  /**
   * Evaluates sequential panel layouts to compute pacing beats and mobile reading duration.
   */
  public analyze(
    panels: readonly PanelVerticalSpan[],
    canvasHeight: number,
    options: PacingSimulationOptions = {},
  ): PacingSimulationResult {
    if (panels.length === 0) {
      return {
        totalCanvasHeightPx: canvasHeight,
        panelCount: 0,
        averageGutterPx: 0,
        beats: [],
        estimatedReadingSeconds: { casual: 0, skimmer: 0, immersive: 0 },
        pacingHealthScore: 100,
        warnings: [],
        summary: "패널이 없습니다.",
      };
    }

    // Sort panels vertically top-to-bottom
    const sorted = [...panels].sort((a, b) => a.topY - b.topY);
    const beats: PacingBeatAnalysis[] = [];
    const warnings: string[] = [];
    let totalGutter = 0;

    for (let i = 0; i < sorted.length - 1; i++) {
      const current = sorted[i];
      const next = sorted[i + 1];
      const gutter = Math.max(0, next.topY - current.bottomY);
      totalGutter += gutter;

      const beat = this.classifyGutter(gutter, i + 1, i + 2);
      beats.push(beat);

      if (beat.beatType === "excessive-void") {
        warnings.push(
          `${i + 1}번~${i + 2}번 컷 사이 여백(${gutter}px)이 너무 길어 독자 이탈 위험이 있습니다.`,
        );
      }
    }

    // Check consecutive rapid action beats
    let consecutiveRush = 0;
    for (const b of beats) {
      if (b.beatType === "action-rush") {
        consecutiveRush++;
        if (consecutiveRush >= 5) {
          warnings.push("연속 5컷 이상 급박한 컷 간격이 이어져 가독성 피로가 유발될 수 있습니다.");
          break;
        }
      } else {
        consecutiveRush = 0;
      }
    }

    // 한 화면에 컷 2개 이하 (WEBTOON CANVAS 공식 크리에이터 가이드).
    // 화면 높이를 받은 경우에만 검사한다 — 기본값을 지어내지 않는다.
    let maxPanelsPerScreen: number | undefined;
    const viewport = options.readerViewportHeightPx;
    if (viewport !== undefined && viewport > 0) {
      maxPanelsPerScreen = 0;
      for (const anchor of sorted) {
        const windowEnd = anchor.topY + viewport;
        const visible = sorted.filter((p) => p.topY < windowEnd && p.bottomY > anchor.topY).length;
        if (visible > maxPanelsPerScreen) maxPanelsPerScreen = visible;
      }
      if (maxPanelsPerScreen > CANVAS_MAX_PANELS_PER_SCREEN) {
        warnings.push(
          `한 화면(${viewport}px)에 컷이 최대 ${maxPanelsPerScreen}개까지 동시에 보입니다. ` +
            `WEBTOON CANVAS 공식 가이드는 화면당 ${CANVAS_MAX_PANELS_PER_SCREEN}컷 이하를 권장합니다.`,
        );
      }
    }

    const avgGutter = beats.length > 0 ? Math.round(totalGutter / beats.length) : 0;

    // Estimate reading times including dwell time for dialogue
    let totalReadingSecCasual = canvasHeight / SCROLL_SPEEDS_PX_PER_SEC.casual;
    let totalReadingSecSkimmer = canvasHeight / SCROLL_SPEEDS_PX_PER_SEC.skimmer;
    let totalReadingSecImmersive = canvasHeight / SCROLL_SPEEDS_PX_PER_SEC.immersive;

    for (const p of sorted) {
      const dialogues = p.dialogueCount ?? 1;
      const readingBonus = dialogues * 0.8; // +0.8s per speech bubble
      totalReadingSecCasual += readingBonus;
      totalReadingSecSkimmer += readingBonus * 0.5;
      totalReadingSecImmersive += readingBonus * 1.5;
    }

    // Health score calculation (penalty for warnings and severe imbalances).
    // 임계값도 구간 경계와 같은 출처를 쓴다 — 종전 penalty 는 80px / 600px 였는데, 600px 는
    // 공식 가이드가 정상 장면 전환이라고 말하는 구간을 그대로 감점하고 있었다.
    let score = 100;
    score -= warnings.length * 15;
    if (avgGutter < CANVAS_MIN_GUTTER_PX) score -= 10;
    if (avgGutter > CANVAS_SCENE_TRANSITION_PX.max) score -= 10;
    score = Math.max(20, Math.min(100, score));

    const summary = `${sorted.length}개 컷 분석 완료 (평균 간격 ${avgGutter}px, 예상 완독 시간 ${Math.round(
      totalReadingSecCasual,
    )}초, 페이싱 점수 ${score}점)`;

    return {
      totalCanvasHeightPx: canvasHeight,
      panelCount: sorted.length,
      averageGutterPx: avgGutter,
      beats,
      estimatedReadingSeconds: {
        casual: Math.round(totalReadingSecCasual),
        skimmer: Math.round(totalReadingSecSkimmer),
        immersive: Math.round(totalReadingSecImmersive),
      },
      pacingHealthScore: score,
      maxPanelsPerScreen,
      warnings,
      summary,
    };
  }

  private classifyGutter(gutterPx: number, fromIdx: number, toIdx: number): PacingBeatAnalysis {
    const base = { fromPanelIndex: fromIdx, toPanelIndex: toIdx, gutterDistancePx: gutterPx };

    if (gutterPx < CANVAS_MIN_GUTTER_PX) {
      return {
        ...base,
        beatType: "action-rush",
        label: "급박한 액션/타격 비트",
        guidance:
          `빠른 템포의 연속 컷이나 충격적인 순간 연출에 쓰는 간격입니다. ` +
          `다만 WEBTOON CANVAS 공식 가이드의 최소 컷 간격 ${CANVAS_MIN_GUTTER_PX}px보다 좁으므로, ` +
          `의도한 연출이 아니라면 ${CANVAS_MIN_GUTTER_PX}px 이상으로 벌리세요.`,
      };
    }
    if (gutterPx < CANVAS_SCENE_TRANSITION_PX.min) {
      return {
        ...base,
        beatType: "dialogue-beat",
        label: "표준 대화/호흡 비트",
        guidance: "인물의 리액션과 대사 교환이 자연스럽게 이어지는 표준 호흡입니다.",
      };
    }
    if (gutterPx <= CANVAS_SCENE_TRANSITION_PX.max) {
      return {
        ...base,
        beatType: "scene-transition",
        label: "장면/공간 전환 비트",
        guidance:
          `시간의 경과나 다른 장소로의 이동을 체감시키는 여백입니다. ` +
          `WEBTOON CANVAS 공식 가이드가 장면·시간 전환에 권장하는 ` +
          `${CANVAS_SCENE_TRANSITION_PX.min}~${CANVAS_SCENE_TRANSITION_PX.max}px 구간입니다.`,
      };
    }
    if (gutterPx <= EXCESSIVE_VOID_PX) {
      return {
        ...base,
        beatType: "suspense-cliffhanger",
        label: "클리프행어/서스펜스 비트",
        guidance:
          "공식 장면 전환 구간보다 긴 여백으로, 스크롤을 멈추고 긴장감이나 정적의 여운을 극대화합니다.",
      };
    }
    return {
      ...base,
      beatType: "excessive-void",
      label: "과도한 공백 (경고)",
      guidance: "독자가 빈 화면으로 오해하거나 지루함을 느낄 수 있으므로 컷 간격을 줄이세요.",
    };
  }
}
