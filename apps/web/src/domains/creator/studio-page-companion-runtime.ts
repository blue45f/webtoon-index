import { useCallback, useEffect, useRef, type MutableRefObject } from "react";

import {
  resolveStudioCompanionTool,
  type StudioCompanionToolSource,
} from "./studio-menu-session-model";
import {
  loadStudioCompanionReferenceCaptureRuntime,
  startStudioToolsCompanionPrimaryRuntime,
  type StudioCompanionReferenceCaptureRuntime,
  type StudioToolsCompanionPrimaryRuntime,
  type StudioToolsCompanionReviewProjectionInput,
  type StudioToolsCompanionRuntimeInput,
} from "./studio-tools-companion-runtime";

import type { StudioCompanionReviewControl } from "./studio-companion-review-projection";
import type { StudioCompanionCommandName } from "./studio-tools-companion";
import type { StudioUiDensityMode } from "./studio-ui-density";

type StudioCompanionReferenceCaptureRuntimeModule =
  Awaited<ReturnType<typeof loadStudioCompanionReferenceCaptureRuntime>>;
type StudioCompanionReferenceCaptureRuntimeCallbacks = Parameters<
  StudioCompanionReferenceCaptureRuntimeModule["createStudioCompanionReferenceCaptureRuntime"]
>[0];
type StudioCompanionReferenceProjectionResult = ReturnType<
  NonNullable<StudioToolsCompanionRuntimeInput["getReferenceProjection"]>
>;

/** 컴패니언 스냅샷/미러가 읽는 편집기 UI 상태 조각 — 페이지가 렌더마다 값으로 넘긴다. */
export interface StudioCompanionUiSnapshot extends StudioCompanionToolSource {
  readonly uiDensityMode: StudioUiDensityMode;
  readonly canvasOnlyMode: boolean;
  readonly title: string;
}

/**
 * 투영 입력 콜백 계약 — 훅은 StudioPage 상태를 직접 읽지 않는다. 캡처 차단·스테이지 캡처·
 * 레퍼런스 보드 스냅샷 같은 페이지 소유 읽기는 전부 이 콜백들로 흘러 들어오고, 훅은 최신
 * 콜백을 ref 로 보관해 채널 런타임의 비동기 호출 시점에 그대로 위임한다.
 */
export interface StudioCompanionRuntimeParams {
  readonly ui: StudioCompanionUiSnapshot;
  /** 진행 중 획/포인터 세션 등 캡처를 막아야 하는 편집기 상태 판정. */
  readonly isCaptureBlocked: () => boolean;
  /** 내비게이터 축소판 캡처 — 문서 뷰 초크 포인트를 지나는 페이지 소유 스테이지 읽기. */
  readonly captureNavigatorCanvas: NonNullable<
    StudioToolsCompanionRuntimeInput["captureNavigatorCanvas"]
  >;
  /** 캡처 런타임이 아직 없을 때의 부트스트랩 레퍼런스 투영(항상 문서 스냅샷 기반). */
  readonly getReferenceProjection: (
    surfaceGeneration: number
  ) => NonNullable<StudioCompanionReferenceProjectionResult>;
  readonly reference: {
    /** 커밋된 레퍼런스 보드 스냅샷 — 원자적 커밋 경계(committed snapshot ref)만 읽는다. */
    readonly getSnapshot: StudioCompanionReferenceCaptureRuntimeCallbacks["getSnapshot"];
  };
  /** 컴패니언 색 추출 결과를 편집기 브러시 색으로 반영. */
  readonly applySampledReferenceColor: (nextColor: string) => void;
}

export interface StudioCompanionRuntimeHandle {
  readonly companionRuntimeRef: MutableRefObject<StudioToolsCompanionPrimaryRuntime | null>;
  readonly companionWindowRef: MutableRefObject<Window | null>;
  readonly companionPendingTextTimerRef: MutableRefObject<
    ReturnType<typeof globalThis.setTimeout> | null
  >;
  readonly companionUiRef: MutableRefObject<StudioCompanionUiSnapshot>;
  readonly companionReviewProjectionInputRef: MutableRefObject<
    (() => StudioToolsCompanionReviewProjectionInput) | null
  >;
  readonly companionControlHandlerRef: MutableRefObject<
    (control: StudioCompanionReviewControl) => void
  >;
  readonly companionHistoryHandlerRef: MutableRefObject<(action: "undo" | "redo") => void>;
  readonly companionCommandHandlerRef: MutableRefObject<
    (command: StudioCompanionCommandName) => void
  >;
  readonly ensureStudioToolsCompanionRuntime: () => Promise<
    StudioToolsCompanionPrimaryRuntime | null
  >;
  /** 도구 미러가 최신일 때만 리뷰 투영을 재발행 — StudioPage 미러 이펙트의 본체. */
  readonly publishCompanionUiMirror: (current: StudioCompanionToolSource) => void;
}

/**
 * 멀티 디스플레이 도구 컴패니언의 주(primary) 탭 런타임 — 문서/undo 는 편집기 탭이 소유하고
 * 도구 의도만 BroadcastChannel 로 오간다. StudioPage.tsx 에서 추출(2026-08, B-04): 채널
 * 수명주기(세대 가드·dispose)·레퍼런스 캡처 런타임 소유권을 훅이 갖고, 페이지는 투영 입력과
 * 명령/컨트롤/히스토리 핸들러를 반환된 ref 에 대입하는 얇은 지점만 유지한다.
 */
export function useStudioCompanionRuntime(
  params: StudioCompanionRuntimeParams
): StudioCompanionRuntimeHandle {
  const { tool, drawMode, menu, uiDensityMode, canvasOnlyMode, title } = params.ui;
  const paramsRef = useRef(params);
  // 채널 콜백은 빈 deps 콜백에 갇혀 있어 렌더마다 새로 오는 페이지 콜백을 직접 캡처하면
  // stale closure 가 된다 — 핸들러 ref 대입과 같은 방식으로 최신 계약을 ref 로 흘린다.
  paramsRef.current = params;

  const companionRuntimeRef = useRef<StudioToolsCompanionPrimaryRuntime | null>(null);
  const companionRuntimePromiseRef = useRef<Promise<StudioToolsCompanionPrimaryRuntime | null> | null>(null);
  const companionRuntimeGenerationRef = useRef(0);
  const companionWindowRef = useRef<Window | null>(null);
  const companionPendingTextTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const companionReferenceCaptureRuntimeRef =
    useRef<StudioCompanionReferenceCaptureRuntime | null>(null);
  const companionReferenceCaptureRuntimePromiseRef =
    useRef<Promise<StudioCompanionReferenceCaptureRuntime | null> | null>(null);
  const companionReferenceCaptureGenerationRef = useRef(0);
  const companionReferenceDemandActiveRef = useRef(false);
  const companionReviewProjectionInputRef = useRef<
    (() => StudioToolsCompanionReviewProjectionInput) | null
  >(null);
  const companionControlHandlerRef = useRef<(control: StudioCompanionReviewControl) => void>(
    () => undefined
  );
  const companionHistoryHandlerRef = useRef<(action: "undo" | "redo") => void>(
    () => undefined
  );
  const companionCommandHandlerRef = useRef<(command: StudioCompanionCommandName) => void>(() => undefined);
  const companionUiRef = useRef<StudioCompanionUiSnapshot>({
    tool,
    drawMode,
    menu,
    uiDensityMode,
    canvasOnlyMode,
    title,
  });

  useEffect(() => {
    companionUiRef.current = { tool, drawMode, menu, uiDensityMode, canvasOnlyMode, title };
  }, [tool, drawMode, menu, uiDensityMode, canvasOnlyMode, title]);

  const ensureStudioCompanionReferenceCaptureRuntime = useCallback(() => {
    const existingRuntime = companionReferenceCaptureRuntimeRef.current;
    if (existingRuntime) return Promise.resolve(existingRuntime);
    const existingPromise = companionReferenceCaptureRuntimePromiseRef.current;
    if (existingPromise) return existingPromise;
    const generation = companionReferenceCaptureGenerationRef.current;
    const promise = loadStudioCompanionReferenceCaptureRuntime().then((module) => {
      if (generation !== companionReferenceCaptureGenerationRef.current) return null;
      const runtime = module.createStudioCompanionReferenceCaptureRuntime({
        getSnapshot: () => paramsRef.current.reference.getSnapshot(),
        isCaptureBlocked: () => paramsRef.current.isCaptureBlocked(),
        onProjectionChanged: () => companionRuntimeRef.current?.schedulePublish(),
      });
      if (generation !== companionReferenceCaptureGenerationRef.current) {
        runtime.release();
        return null;
      }
      companionReferenceCaptureRuntimeRef.current = runtime;
      return runtime;
    }).catch(() => null);
    companionReferenceCaptureRuntimePromiseRef.current = promise;
    void promise.then((runtime) => {
      if (!runtime && companionReferenceCaptureRuntimePromiseRef.current === promise) {
        companionReferenceCaptureRuntimePromiseRef.current = null;
      }
    });
    return promise;
  }, []);

  const ensureStudioToolsCompanionRuntime = useCallback(() => {
    const existing = companionRuntimePromiseRef.current;
    if (existing) return existing;
    const generation = companionRuntimeGenerationRef.current + 1;
    companionRuntimeGenerationRef.current = generation;
    const promise = startStudioToolsCompanionPrimaryRuntime({
      search: typeof window !== "undefined" ? window.location.search : "",
      getSnapshot: () => {
        const s = companionUiRef.current;
        return {
          tool: resolveStudioCompanionTool(s),
          density: s.uiDensityMode,
          canvasOnly: s.canvasOnlyMode,
          title: s.title,
        };
      },
      getReviewProjectionInput: () => {
        const create = companionReviewProjectionInputRef.current;
        if (!create) throw new Error("Studio companion projection is unavailable");
        return create();
      },
      isNavigatorCaptureBlocked: () => paramsRef.current.isCaptureBlocked(),
      captureNavigatorCanvas: (maximumLongestEdge) =>
        paramsRef.current.captureNavigatorCanvas(maximumLongestEdge),
      getReferenceProjection: (surfaceGeneration) => {
        const ready = companionReferenceCaptureRuntimeRef.current?.getProjection(surfaceGeneration);
        if (ready) return ready;
        return paramsRef.current.getReferenceProjection(surfaceGeneration);
      },
      captureReferenceFrame: async (request) => {
        if (!companionReferenceDemandActiveRef.current) return null;
        const runtime = await ensureStudioCompanionReferenceCaptureRuntime();
        if (!runtime || request.signal.aborted || !companionReferenceDemandActiveRef.current) {
          return null;
        }
        await runtime.setDemand(true);
        if (request.signal.aborted || !companionReferenceDemandActiveRef.current) return null;
        return runtime.captureFrame(request);
      },
      sampleReferenceColor: async ({ current, point, sequence, signal }) => {
        if (signal.aborted || paramsRef.current.isCaptureBlocked()) return null;
        const runtime = companionReferenceCaptureRuntimeRef.current;
        if (!runtime || !companionReferenceDemandActiveRef.current) return null;
        const sampled = await runtime.sampleColor({ current, point, sequence, signal });
        if (!sampled || signal.aborted || paramsRef.current.isCaptureBlocked()) return null;
        const nextColor = sampled.toLowerCase();
        paramsRef.current.applySampledReferenceColor(nextColor);
        return nextColor;
      },
      onReferenceDemandChange: (active) => {
        companionReferenceDemandActiveRef.current = active;
        if (!active) {
          void companionReferenceCaptureRuntimeRef.current?.setDemand(false);
          return;
        }
        void ensureStudioCompanionReferenceCaptureRuntime().then(async (runtime) => {
          if (!runtime || !companionReferenceDemandActiveRef.current) return;
          const ready = await runtime.setDemand(true);
          if (ready && companionReferenceDemandActiveRef.current) {
            companionRuntimeRef.current?.schedulePublish();
          }
        });
      },
      onCommand: (command) => companionCommandHandlerRef.current(command),
      onControl: (control) => companionControlHandlerRef.current(control),
    }).then((runtime) => {
      if (generation !== companionRuntimeGenerationRef.current) {
        runtime?.dispose();
        return null;
      }
      companionRuntimeRef.current = runtime;
      return runtime;
    }).catch(() => null);
    companionRuntimePromiseRef.current = promise;
    void promise.then((runtime) => {
      if (!runtime && companionRuntimePromiseRef.current === promise) {
        companionRuntimePromiseRef.current = null;
      }
    });
    return promise;
  }, [ensureStudioCompanionReferenceCaptureRuntime]);

  useEffect(() => {
    try {
      if (new URLSearchParams(window.location.search).has("session")) {
        void ensureStudioToolsCompanionRuntime();
      }
    } catch {
      // A malformed query simply waits for an explicit tools-window request.
    }
    return () => {
      companionRuntimeGenerationRef.current += 1;
      companionReferenceCaptureGenerationRef.current += 1;
      companionReferenceDemandActiveRef.current = false;
      const runtime = companionRuntimeRef.current;
      companionRuntimeRef.current = null;
      companionRuntimePromiseRef.current = null;
      runtime?.dispose();
      const referenceRuntime = companionReferenceCaptureRuntimeRef.current;
      companionReferenceCaptureRuntimeRef.current = null;
      companionReferenceCaptureRuntimePromiseRef.current = null;
      referenceRuntime?.release();
      if (companionPendingTextTimerRef.current !== null) {
        globalThis.clearTimeout(companionPendingTextTimerRef.current);
        companionPendingTextTimerRef.current = null;
      }
    };
  }, [ensureStudioToolsCompanionRuntime]);

  const publishCompanionUiMirror = useCallback((current: StudioCompanionToolSource) => {
    if (
      resolveStudioCompanionTool(current)
      !== resolveStudioCompanionTool(companionUiRef.current)
    ) return;
    companionRuntimeRef.current?.schedulePublish();
  }, []);

  return {
    companionRuntimeRef,
    companionWindowRef,
    companionPendingTextTimerRef,
    companionUiRef,
    companionReviewProjectionInputRef,
    companionControlHandlerRef,
    companionHistoryHandlerRef,
    companionCommandHandlerRef,
    ensureStudioToolsCompanionRuntime,
    publishCompanionUiMirror,
  };
}
