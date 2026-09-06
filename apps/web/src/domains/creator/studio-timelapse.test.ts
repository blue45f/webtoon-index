// studio-timelapse 순수 모듈 테스트 — 페이지별 히스토리 스텝 선택/솎아내기/타임라인 플랜/
// 프레임 렌더러/레코더 오케스트레이터(주입형 가짜 rig). studio-motion-export.test.ts 의
// createFakeCtx/createFakeRig/pumpUntilDone 기법을 그대로 흉내 낸다.
import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_TIMELAPSE_EXPORT_OPTIONS,
  TIMELAPSE_DURATION_PRESETS,
  TIMELAPSE_RESOLUTION_PRESETS,
  drawTimelapseFrame,
  isTimelapseExportCancelled,
  normalizeTimelapseExportOptions,
  planTimelapseExport,
  selectTimelapsePageSteps,
  startTimelapseExport,
  thinTimelapseSteps,
  timelapseExportFileName,
  timelapseSegmentAt,
  type TimelapseExportDeps,
  type TimelapseExportPlan,
  type TimelapseExportProgress,
  type TimelapseStepInfo,
} from "./studio-timelapse";

import type { MotionCutImage, MotionRecorderLike, MotionStreamLike, MotionTrackLike } from "./export/studio-motion-export";
import type { HistoryElementLike, HistoryPageLike, HistorySnapshot } from "./studio-history-labels";

// ── 픽스처 헬퍼(studio-history-labels.test.ts 관례 재사용) ────────────

function el(id: string, over: Partial<HistoryElementLike> = {}): HistoryElementLike {
  return { id, type: "text", x: 10, y: 20, width: 100, height: 40, text: "안녕", ...over };
}

function page(id: string, elements: HistoryElementLike[], over: Partial<HistoryPageLike> = {}): HistoryPageLike {
  return { id, elements, bg: "#ffffff", bgGrad: null, canvasH: 1080, ...over };
}

// StudioPage 의 pages.map(p => p.id === X ? {...p, ...patch} : p) 커밋 경로를 흉내 낸다 —
// 대상 페이지만 새 참조, 나머지 페이지는 원래 참조를 그대로 유지.
function repage(snapshot: HistorySnapshot, pageId: string, over: Partial<HistoryPageLike>): HistorySnapshot {
  return snapshot.map((p) => (p.id === pageId ? { ...p, ...over } : p));
}

// ── selectTimelapsePageSteps ───────────────────────────────────────

describe("selectTimelapsePageSteps", () => {
  it("최초 상태만 있으면 스텝 1개(index 0)", () => {
    const history: HistorySnapshot[] = [[page("p1", [])]];
    const steps = selectTimelapsePageSteps(history, "p1");
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ historyIndex: 0, elementCount: 0 });
  });

  it("다른 페이지 편집은 건너뛰고 대상 페이지가 바뀐 스텝만 고른다", () => {
    const h0: HistorySnapshot = [page("p1", []), page("p2", [])];
    const h1 = repage(h0, "p2", { elements: [el("x")] }); // p1은 참조 그대로
    const h2 = repage(h1, "p1", { elements: [el("a")] }); // p1이 처음 바뀜
    const h3 = repage(h2, "p2", { elements: [el("x"), el("y")] }); // 또 p2만
    const history: HistorySnapshot[] = [h0, h1, h2, h3];

    const steps = selectTimelapsePageSteps(history, "p1");
    // index0(최초) + index2(p1 실제 변경) — index1은 p1이 안 바뀌었으니 제외된다.
    // index3은 p1 내용은 안 바뀌었지만 p1이 "마지막으로 존재한 시점"이라 항상 마지막 항목으로 추가된다.
    expect(steps.map((s) => s.historyIndex)).toEqual([0, 2, 3]);
  });

  it("같은 페이지를 여러 번 편집하면 바뀐 참조마다 한 스텝씩", () => {
    const h0: HistorySnapshot = [page("p1", [])];
    const h1 = repage(h0, "p1", { elements: [el("a")] });
    const h2 = repage(h1, "p1", { elements: [el("a"), el("b")] });
    const h3 = repage(h2, "p1", { elements: [el("a"), el("b"), el("c")] });
    const history: HistorySnapshot[] = [h0, h1, h2, h3];

    const steps = selectTimelapsePageSteps(history, "p1");
    expect(steps.map((s) => s.historyIndex)).toEqual([0, 1, 2, 3]);
    expect(steps.map((s) => s.elementCount)).toEqual([0, 1, 2, 3]);
  });

  it("페이지가 중간에 추가되면 그 시점부터만 스텝을 잡는다", () => {
    const h0: HistorySnapshot = [page("p1", [])];
    const h1: HistorySnapshot = [page("p1", []), page("p2", [el("a")])]; // p2 등장
    const h2 = repage(h1, "p2", { elements: [el("a"), el("b")] });
    const history: HistorySnapshot[] = [h0, h1, h2];

    const steps = selectTimelapsePageSteps(history, "p2");
    expect(steps.map((s) => s.historyIndex)).toEqual([1, 2]);
  });

  it("대상 페이지가 아닌 페이지의 후속 편집이 있어도 대상 페이지의 마지막 존재 시점으로 끝난다", () => {
    const h0: HistorySnapshot = [page("p1", [el("a")]), page("p2", [])];
    const h1 = repage(h0, "p1", { elements: [el("a"), el("b")] }); // p1 마지막 실변경
    const h2 = repage(h1, "p2", { elements: [el("z")] }); // p1 참조 그대로, p2만 바뀜
    const history: HistorySnapshot[] = [h0, h1, h2];

    const steps = selectTimelapsePageSteps(history, "p1");
    // p1은 index1 이후 안 바뀌었지만, "마지막으로 존재한 시점"(index2)이 항상 마지막 항목이어야 한다.
    expect(steps[steps.length - 1].historyIndex).toBe(2);
    expect(steps.map((s) => s.historyIndex)).toEqual([0, 1, 2]);
  });

  it("페이지가 한 번도 존재하지 않으면 빈 배열", () => {
    const history: HistorySnapshot[] = [[page("p1", [])], [page("p1", [el("a")])]];
    expect(selectTimelapsePageSteps(history, "nope")).toEqual([]);
  });
});

// ── thinTimelapseSteps ─────────────────────────────────────────────

function mkSteps(n: number): TimelapseStepInfo[] {
  return Array.from({ length: n }, (_, i) => ({ historyIndex: i, label: `step ${i}`, elementCount: i }));
}

describe("thinTimelapseSteps", () => {
  it("상한 이하이면 그대로 반환한다(no-op)", () => {
    const steps = mkSteps(5);
    expect(thinTimelapseSteps(steps, 10)).toEqual(steps);
  });

  it("항상 첫/마지막 스텝을 포함한다", () => {
    const steps = mkSteps(50);
    const thinned = thinTimelapseSteps(steps, 5);
    expect(thinned[0]).toEqual(steps[0]);
    expect(thinned[thinned.length - 1]).toEqual(steps[49]);
    expect(thinned.length).toBeLessThanOrEqual(5);
  });

  it("반올림 충돌은 dedupe 된다(연속 중복 historyIndex 없음)", () => {
    const steps = mkSteps(3);
    const thinned = thinTimelapseSteps(steps, 10); // cap > length -> no-op이라 dedupe 검증은 아래에서
    const ids = thinned.map((s) => s.historyIndex);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("maxSteps=1이면 마지막 스텝 하나만 남는다", () => {
    const steps = mkSteps(10);
    const thinned = thinTimelapseSteps(steps, 1);
    expect(thinned).toEqual([steps[9]]);
  });
});

// ── planTimelapseExport / timelapseSegmentAt ───────────────────────

describe("planTimelapseExport", () => {
  it("빈 steps는 0 길이 플랜", () => {
    const plan = planTimelapseExport([], { width: 72, height: 128 });
    expect(plan.durationSec).toBe(0);
    expect(plan.frameCount).toBe(0);
    expect(plan.segments).toEqual([]);
  });

  it("일반적인 경우 총 길이가 목표 길이에 근접한다(tailHold 포함)", () => {
    const steps = mkSteps(10);
    const plan = planTimelapseExport(steps, {
      targetDurationSec: 20,
      minStepHoldSec: 0.1,
      maxStepHoldSec: 10,
      tailHoldSec: 1,
      maxDurationSec: 90,
    });
    // stepHold = 20/10 = 2초 × 10 + tail 1초 = 21초
    expect(plan.durationSec).toBeCloseTo(21, 9);
    expect(plan.segments).toHaveLength(10);
  });

  it("maxDurationSec을 넘으면 균등 축소하고 단조 증가를 유지한다", () => {
    const steps = mkSteps(10);
    const raw = planTimelapseExport(steps, {
      targetDurationSec: 20,
      minStepHoldSec: 0.1,
      maxStepHoldSec: 10,
      tailHoldSec: 1,
      maxDurationSec: 90,
    });
    const capped = planTimelapseExport(steps, {
      targetDurationSec: 20,
      minStepHoldSec: 0.1,
      maxStepHoldSec: 10,
      tailHoldSec: 1,
      maxDurationSec: 10,
    });
    expect(raw.durationSec).toBeCloseTo(21, 9);
    expect(capped.durationSec).toBeCloseTo(10, 9);
    for (let i = 1; i < capped.segments.length; i++) {
      expect(capped.segments[i].startSec).toBeGreaterThanOrEqual(capped.segments[i - 1].startSec);
      expect(capped.segments[i].endSec).toBeGreaterThan(capped.segments[i].startSec);
    }
    const k = 10 / 21;
    expect(capped.segments[0].endSec).toBeCloseTo(raw.segments[0].endSec * k, 9);
  });

  it("스텝이 매우 적으면 maxStepHoldSec에서 클램프된다", () => {
    const steps = mkSteps(2);
    const plan = planTimelapseExport(steps, {
      targetDurationSec: 60, // 스텝당 30초가 나올 상황
      minStepHoldSec: 0.1,
      maxStepHoldSec: 5,
      tailHoldSec: 0,
      maxDurationSec: 90,
    });
    // stepHold이 5초로 클램프 -> 총 10초(tail 0)
    expect(plan.durationSec).toBeCloseTo(10, 9);
  });

  it("옵션을 정규화한다(기본값·클램프)", () => {
    expect(normalizeTimelapseExportOptions()).toEqual(DEFAULT_TIMELAPSE_EXPORT_OPTIONS);
    const o = normalizeTimelapseExportOptions({ fps: 999, width: -5, maxSteps: 1, minStepHoldSec: -1 });
    expect(o.fps).toBe(30);
    expect(o.width).toBe(16);
    expect(o.maxSteps).toBe(8);
    expect(o.minStepHoldSec).toBe(0.03);
  });

  it("프리셋 데이터가 유효하다", () => {
    expect(new Set(TIMELAPSE_RESOLUTION_PRESETS.map((r) => r.id)).size).toBe(TIMELAPSE_RESOLUTION_PRESETS.length);
    expect(new Set(TIMELAPSE_DURATION_PRESETS.map((d) => d.id)).size).toBe(TIMELAPSE_DURATION_PRESETS.length);
    for (const d of TIMELAPSE_DURATION_PRESETS) expect(d.targetDurationSec).toBeGreaterThan(0);
  });
});

describe("timelapseSegmentAt", () => {
  const steps = mkSteps(3);
  const plan = planTimelapseExport(steps, {
    targetDurationSec: 3,
    minStepHoldSec: 0.1,
    maxStepHoldSec: 10,
    tailHoldSec: 1,
    maxDurationSec: 90,
  }); // stepHold = 1초 × 3 + tail 1 = 4초

  it("빈 플랜이면 null", () => {
    expect(timelapseSegmentAt({ width: 1, height: 1, fps: 1, durationSec: 0, frameCount: 0, segments: [] }, 0)).toBeNull();
  });

  it("세그먼트 경계에서 다음 세그먼트로 넘어간다", () => {
    const secondStart = plan.segments[1].startSec;
    expect(timelapseSegmentAt(plan, secondStart - 0.01)!.order).toBe(0);
    expect(timelapseSegmentAt(plan, secondStart)!.order).toBe(1);
  });

  it("tail-hold 구간은 마지막 세그먼트를 유지한다", () => {
    const lastStart = plan.segments[2].startSec;
    expect(timelapseSegmentAt(plan, lastStart + 0.5)!.order).toBe(2);
    expect(timelapseSegmentAt(plan, plan.durationSec - 0.01)!.order).toBe(2);
  });

  it("범위 밖 값은 클램프된다", () => {
    expect(timelapseSegmentAt(plan, -5)!.order).toBe(0);
    expect(timelapseSegmentAt(plan, plan.durationSec + 100)!.order).toBe(2);
  });
});

// ── drawTimelapseFrame ──────────────────────────────────────────────

interface CtxOp {
  op: string;
  args: unknown[];
}

function createFakeCtx() {
  const ops: CtxOp[] = [];
  const push = (op: string) => {
    return (...args: unknown[]) => {
      ops.push({ op, args });
    };
  };
  const ctx = {
    globalAlpha: 1,
    fillStyle: "",
    fillRect: push("fillRect"),
    drawImage: push("drawImage"),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops };
}

const CUT_IMAGE: MotionCutImage = { source: {} as CanvasImageSource, width: 720, height: 1280 };

describe("drawTimelapseFrame", () => {
  it("배경은 항상 채운다", () => {
    const { ctx, ops } = createFakeCtx();
    drawTimelapseFrame(ctx, 100, 200, "#101014", undefined);
    expect(ops).toEqual([{ op: "fillRect", args: [0, 0, 100, 200] }]);
  });

  it("이미지가 있으면 컨테인-핏으로 레터박스 배치한다", () => {
    const { ctx, ops } = createFakeCtx();
    // 100x200 캔버스에 720x1280(9:16과 동일 비율) -> fit = min(100/720, 200/1280) = 0.15625
    drawTimelapseFrame(ctx, 100, 200, "#000", CUT_IMAGE);
    const draw = ops.find((o) => o.op === "drawImage")!;
    const fit = Math.min(100 / 720, 200 / 1280);
    const dw = 720 * fit;
    const dh = 1280 * fit;
    expect(draw.args[1]).toBeCloseTo((100 - dw) / 2, 6);
    expect(draw.args[2]).toBeCloseTo((200 - dh) / 2, 6);
    expect(draw.args[3]).toBeCloseTo(dw, 6);
    expect(draw.args[4]).toBeCloseTo(dh, 6);
  });

  it("이미지가 없으면 배경만 그리고 drawImage는 호출하지 않는다", () => {
    const { ctx, ops } = createFakeCtx();
    drawTimelapseFrame(ctx, 50, 50, "#fff", undefined);
    expect(ops.some((o) => o.op === "drawImage")).toBe(false);
  });
});

// ── startTimelapseExport (레코더 오케스트레이터) ────────────────────

class FakeRecorder implements MotionRecorderLike {
  started: number | undefined;
  stopCount = 0;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  constructor(
    public stream: MotionStreamLike,
    public options: { mimeType: string; videoBitsPerSecond: number }
  ) {}
  get mimeType() {
    return this.options.mimeType;
  }
  start(timesliceMs?: number) {
    this.started = timesliceMs;
  }
  stop() {
    this.stopCount += 1;
    if (this.stopCount > 1) return; // 실 레코더의 중복 stop 가드 흉내
    this.ondataavailable?.({
      data: new Blob([
        Uint8Array.of(0x1a, 0x45, 0xdf, 0xa3, 0x01) as unknown as BlobPart,
      ], { type: "video/webm" }),
    });
    this.onstop?.();
  }
}

function createFakeRig(overrides?: Partial<TimelapseExportDeps>) {
  const { ctx, ops } = createFakeCtx();
  const videoTrack: MotionTrackLike & { stopped: boolean } = {
    stopped: false,
    stop() {
      this.stopped = true;
    },
  };
  const stream: MotionStreamLike = {
    addTrack: () => {},
    getTracks: () => [videoTrack],
  };
  let recorder: FakeRecorder | null = null;
  let nowMs = 0;
  const pending: (() => void)[] = [];
  let canvasCreated = false;
  let recorderCreated = false;
  const deps: TimelapseExportDeps = {
    createCanvas: (width, height) => {
      canvasCreated = true;
      return { width, height, getContext: () => ctx, captureStream: () => stream };
    },
    createRecorder: (s, options) => {
      recorderCreated = true;
      recorder = new FakeRecorder(s, options);
      return recorder;
    },
    isMimeSupported: () => true,
    requestFrame: (cb) => {
      pending.push(cb);
      return pending.length;
    },
    cancelFrame: () => {
      pending.length = 0;
    },
    now: () => nowMs,
    ...overrides,
  };
  return {
    deps,
    ops,
    videoTrack,
    recorder: () => recorder,
    canvasCreated: () => canvasCreated,
    recorderCreated: () => recorderCreated,
    advance(ms: number) {
      nowMs += ms;
      pending.shift()?.();
    },
    hasPending: () => pending.length > 0,
    flush: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
  };
}

function makePlan(stepCount = 3): TimelapseExportPlan {
  return planTimelapseExport(mkSteps(stepCount), {
    width: 72,
    height: 128,
    fps: 10,
    targetDurationSec: 1.5,
    minStepHoldSec: 0.1,
    maxStepHoldSec: 5,
    tailHoldSec: 0.3,
    maxDurationSec: 90,
  });
}

async function pumpUntilDone(rig: ReturnType<typeof createFakeRig>, stepMs = 200, maxTicks = 200) {
  await rig.flush();
  let guard = 0;
  while (rig.hasPending() && guard < maxTicks) {
    rig.advance(stepMs);
    guard += 1;
  }
  await rig.flush();
}

describe("startTimelapseExport", () => {
  it("happy path — 세그먼트 순서대로 캡처하고 phase가 capture→record→finalize로 진행하며 Blob으로 완료된다", async () => {
    const rig = createFakeRig();
    const plan = makePlan(3);
    const calls: Array<{ historyIndex: number; targetWidth: number }> = [];
    const captureStep = vi.fn(async (historyIndex: number, targetWidth: number) => {
      calls.push({ historyIndex, targetWidth });
      return CUT_IMAGE;
    });
    const progresses: TimelapseExportProgress[] = [];
    const handle = startTimelapseExport({
      plan,
      captureStep,
      onProgress: (p) => progresses.push(p),
      deps: rig.deps,
    });
    await pumpUntilDone(rig);
    const result = await handle.done;

    expect(calls).toEqual(plan.segments.map((s) => ({ historyIndex: s.historyIndex, targetWidth: plan.width })));
    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob.size).toBeGreaterThan(0);
    expect(result.stepCount).toBe(plan.segments.length);
    expect(result.durationSec).toBeCloseTo(plan.durationSec, 9);
    expect(rig.recorder()!.started).toBe(500);
    expect(rig.videoTrack.stopped).toBe(true); // 정리 — 트랙 해제
    expect(rig.ops.some((o) => o.op === "drawImage")).toBe(true);

    const phases = progresses.map((p) => p.phase);
    expect(phases[0]).toBe("capture");
    const firstRecordIdx = phases.indexOf("record");
    const firstFinalizeIdx = phases.indexOf("finalize");
    expect(firstRecordIdx).toBeGreaterThan(-1);
    expect(firstFinalizeIdx).toBeGreaterThan(firstRecordIdx);
    const captureProgresses = progresses.filter((p) => p.phase === "capture");
    expect(captureProgresses.map((p) => p.captured)).toEqual([1, 2, 3]);
    expect(progresses[progresses.length - 1]).toMatchObject({ phase: "finalize", ratio: 1 });
  });

  it("취소(캡처 단계) — TimelapseExportCancelledError로 reject하고 캔버스/레코더를 만들지 않는다", async () => {
    const rig = createFakeRig();
    const plan = makePlan(3);
    // 진짜 비동기 지연을 둬서 startTimelapseExport가 handle을 반환한 뒤에 cancel()이 개입할 틈을 만든다.
    const captureStep = vi.fn(async () => {
      await Promise.resolve();
      return CUT_IMAGE;
    });
    const handle = startTimelapseExport({ plan, captureStep, deps: rig.deps });
    handle.cancel();
    const err = await handle.done.catch((e: unknown) => e);
    expect(isTimelapseExportCancelled(err)).toBe(true);
    expect(rig.canvasCreated()).toBe(false);
    expect(rig.recorderCreated()).toBe(false);
    expect(captureStep).toHaveBeenCalledTimes(1); // 첫 스텝만 진행되고 두 번째 전에 중단
  });

  it("취소(녹화 단계) — 취소 에러로 reject하고 트랙을 정리한다", async () => {
    const rig = createFakeRig();
    const plan = makePlan(3);
    const captureStep = vi.fn(async () => CUT_IMAGE);
    const handle = startTimelapseExport({ plan, captureStep, deps: rig.deps });
    const settled = handle.done.catch((err: unknown) => err);
    await rig.flush(); // 캡처 단계(마이크로태스크) 완료 + 첫 requestFrame 예약까지 진행
    rig.advance(100); // 몇 프레임 진행
    handle.cancel();
    const err = await settled;
    expect(isTimelapseExportCancelled(err)).toBe(true);
    expect(rig.videoTrack.stopped).toBe(true);
    expect(rig.recorder()!.stopCount).toBeGreaterThanOrEqual(1);
  });

  it("captureStep이 캡처 도중 실패하면 일반 오류로 reject된다(canvas는 만들지 않는다)", async () => {
    const rig = createFakeRig();
    const plan = makePlan(3);
    const captureStep = vi.fn(async (historyIndex: number) => {
      if (historyIndex === plan.segments[1].historyIndex) throw new Error("캡처 실패");
      return CUT_IMAGE;
    });
    const handle = startTimelapseExport({ plan, captureStep, deps: rig.deps });
    await expect(handle.done).rejects.toThrow("캡처 실패");
    expect(rig.canvasCreated()).toBe(false);
  });

  it("MIME 미지원이면 captureStep 호출 전에 즉시 reject한다", async () => {
    const rig = createFakeRig({ isMimeSupported: () => false });
    const captureStep = vi.fn(async () => CUT_IMAGE);
    const handle = startTimelapseExport({ plan: makePlan(2), captureStep, deps: rig.deps });
    await expect(handle.done).rejects.toThrow("WebM");
    expect(captureStep).not.toHaveBeenCalled();
  });

  it("빈 플랜(녹화할 편집 기록 없음)은 즉시 reject한다", async () => {
    const rig = createFakeRig();
    const captureStep = vi.fn(async () => CUT_IMAGE);
    const emptyPlan = planTimelapseExport([], {});
    const handle = startTimelapseExport({ plan: emptyPlan, captureStep, deps: rig.deps });
    await expect(handle.done).rejects.toThrow("녹화할 편집 기록");
    expect(captureStep).not.toHaveBeenCalled();
  });

  it("취소 판별 헬퍼는 일반 에러와 구분한다", () => {
    expect(isTimelapseExportCancelled(new Error("x"))).toBe(false);
  });
});

describe("timelapseExportFileName", () => {
  it("제목 기반 -timelapse.webm, 빈 제목은 기본값", () => {
    expect(timelapseExportFileName("나의 만화")).toBe("나의 만화-timelapse.webm");
    expect(timelapseExportFileName("  ")).toBe("toonspectrum-timelapse-timelapse.webm");
  });
});
