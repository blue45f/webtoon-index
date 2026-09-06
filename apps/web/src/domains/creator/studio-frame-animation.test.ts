import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_FRAME_ANIMATION_EXPORT_OPTIONS,
  frameAnimationExportFileName,
  isMotionExportCancelled,
  planFrameAnimationExport,
  startFrameAnimationExport,
  type FrameAnimationExportPlan,
  type MotionCutImage,
} from "./export/studio-frame-animation-export";
import {
  DEFAULT_FRAME_FPS,
  DEFAULT_ONION_SKIN,
  MAX_ANIM_FRAMES,
  clampFrameIndex,
  createAnimFrame,
  duplicateFrame,
  frameDurationMs,
  frameDurationsMs,
  frameIndexAtElapsed,
  frameIndexOf,
  insertFrame,
  normalizeFrameFps,
  normalizeOnionSkinSettings,
  onionSkinLayers,
  removeFrame,
  reorderFrame,
  setFrameDuration,
  type OnionSkinSettings,
  type StudioAnimFrame,
} from "./studio-frame-animation";

import type { MotionExportDeps } from "./export/studio-motion-export";

function frame(id: string, durationMs?: number): StudioAnimFrame {
  return durationMs === undefined ? { id, src: `data:${id}` } : { id, src: `data:${id}`, durationMs };
}

// ── 프레임 모델 ──────────────────────────────────────────────────────

describe("normalizeFrameFps", () => {
  it("범위를 벗어나면 클램프하고 미지정이면 기본값", () => {
    expect(normalizeFrameFps(undefined)).toBe(DEFAULT_FRAME_FPS);
    expect(normalizeFrameFps(0)).toBe(1);
    expect(normalizeFrameFps(999)).toBe(30);
    expect(normalizeFrameFps(24)).toBe(24);
  });
});

describe("frameDurationMs / frameDurationsMs", () => {
  it("durationMs가 없으면 fps 기반 균등 시간", () => {
    expect(frameDurationMs(frame("a"), 10)).toBe(100);
  });

  it("유효한 durationMs가 있으면 그 값을 쓴다", () => {
    expect(frameDurationMs(frame("a", 250), 10)).toBe(250);
  });

  it("0 이하 durationMs는 무시하고 fps로 폴백", () => {
    expect(frameDurationMs(frame("a", 0), 10)).toBe(100);
    expect(frameDurationMs(frame("a", -5), 10)).toBe(100);
  });

  it("frameDurationsMs는 frames와 같은 순서/길이", () => {
    const frames = [frame("a"), frame("b", 500), frame("c")];
    expect(frameDurationsMs(frames, 10)).toEqual([100, 500, 100]);
  });
});

describe("createAnimFrame", () => {
  it("id·src만 있는 프레임을 만든다", () => {
    expect(createAnimFrame("data:x", "f1")).toEqual({ id: "f1", src: "data:x" });
  });
});

// ── 프레임 배열 조작(불변, CRUD 불변식) ────────────────────────────

describe("insertFrame", () => {
  it("afterId 미지정이면 맨 끝에 추가", () => {
    const frames = [frame("a"), frame("b")];
    const next = insertFrame(frames, frame("c"), null);
    expect(next.map((f) => f.id)).toEqual(["a", "b", "c"]);
    expect(frames.map((f) => f.id)).toEqual(["a", "b"]); // 원본 불변
  });

  it("afterId 바로 뒤에 삽입", () => {
    const frames = [frame("a"), frame("b"), frame("c")];
    const next = insertFrame(frames, frame("x"), "a");
    expect(next.map((f) => f.id)).toEqual(["a", "x", "b", "c"]);
  });

  it("afterId가 존재하지 않으면 맨 끝에 추가", () => {
    const frames = [frame("a")];
    const next = insertFrame(frames, frame("x"), "missing");
    expect(next.map((f) => f.id)).toEqual(["a", "x"]);
  });

  it("MAX_ANIM_FRAMES 상한에서 무추가(원본 그대로 반환)", () => {
    const frames = Array.from({ length: MAX_ANIM_FRAMES }, (_, i) => frame(`f${i}`));
    const next = insertFrame(frames, frame("overflow"), null);
    expect(next).toBe(frames); // 동일 참조 — 새 배열도 만들지 않는다
    expect(next).toHaveLength(MAX_ANIM_FRAMES);
  });
});

describe("removeFrame", () => {
  it("존재하는 프레임을 제거", () => {
    const frames = [frame("a"), frame("b")];
    expect(removeFrame(frames, "a").map((f) => f.id)).toEqual(["b"]);
  });

  it("마지막 1장은 삭제를 거부(원본 그대로 반환)", () => {
    const frames = [frame("only")];
    const next = removeFrame(frames, "only");
    expect(next).toBe(frames);
    expect(next).toHaveLength(1);
  });

  it("존재하지 않는 id는 원본과 동일한 배열을 반환", () => {
    const frames = [frame("a"), frame("b")];
    const next = removeFrame(frames, "missing");
    expect(next).toEqual(frames);
  });
});

describe("duplicateFrame", () => {
  it("원본 바로 뒤에 새 id로 복제(내용 동일)", () => {
    const frames = [frame("a", 200), frame("b")];
    const next = duplicateFrame(frames, "a", "a-copy");
    expect(next.map((f) => f.id)).toEqual(["a", "a-copy", "b"]);
    expect(next[1]).toEqual({ id: "a-copy", src: "data:a", durationMs: 200 });
  });

  it("존재하지 않는 id는 무변화", () => {
    const frames = [frame("a")];
    expect(duplicateFrame(frames, "missing", "x")).toBe(frames);
  });

  it("MAX_ANIM_FRAMES 상한에서 무추가", () => {
    const frames = Array.from({ length: MAX_ANIM_FRAMES }, (_, i) => frame(`f${i}`));
    expect(duplicateFrame(frames, "f0", "copy")).toBe(frames);
  });
});

describe("reorderFrame", () => {
  it("지정한 인덱스로 이동", () => {
    const frames = [frame("a"), frame("b"), frame("c")];
    expect(reorderFrame(frames, "a", 2).map((f) => f.id)).toEqual(["b", "c", "a"]);
    expect(reorderFrame(frames, "c", 0).map((f) => f.id)).toEqual(["c", "a", "b"]);
  });

  it("범위를 벗어난 인덱스는 클램프", () => {
    const frames = [frame("a"), frame("b"), frame("c")];
    expect(reorderFrame(frames, "a", 999).map((f) => f.id)).toEqual(["b", "c", "a"]);
    expect(reorderFrame(frames, "c", -99).map((f) => f.id)).toEqual(["c", "a", "b"]);
  });

  it("존재하지 않는 id는 무변화, 제자리 이동도 무변화", () => {
    const frames = [frame("a"), frame("b")];
    expect(reorderFrame(frames, "missing", 1)).toBe(frames);
    expect(reorderFrame(frames, "a", 0)).toBe(frames);
  });
});

describe("setFrameDuration", () => {
  it("유효 범위로 클램프해 설정", () => {
    const frames = [frame("a")];
    expect(setFrameDuration(frames, "a", 300)[0].durationMs).toBe(300);
    expect(setFrameDuration(frames, "a", 1)[0].durationMs).toBe(16); // 최소 클램프
    expect(setFrameDuration(frames, "a", 999_999)[0].durationMs).toBe(60_000); // 최대 클램프
  });

  it("null이면 개별 시간을 해제(undefined)", () => {
    const frames = [frame("a", 500)];
    expect(setFrameDuration(frames, "a", null)[0].durationMs).toBeUndefined();
  });

  it("다른 프레임은 건드리지 않는다", () => {
    const frames = [frame("a"), frame("b")];
    const next = setFrameDuration(frames, "a", 300);
    expect(next[1]).toBe(frames[1]); // 동일 참조 유지
  });
});

describe("frameIndexOf / clampFrameIndex", () => {
  it("존재하면 인덱스, 없거나 null/undefined면 -1", () => {
    const frames = [frame("a"), frame("b")];
    expect(frameIndexOf(frames, "b")).toBe(1);
    expect(frameIndexOf(frames, "missing")).toBe(-1);
    expect(frameIndexOf(frames, null)).toBe(-1);
    expect(frameIndexOf(frames, undefined)).toBe(-1);
  });

  it("범위를 [0,len-1]로 클램프, 빈 배열이면 0", () => {
    const frames = [frame("a"), frame("b"), frame("c")];
    expect(clampFrameIndex(frames, -5)).toBe(0);
    expect(clampFrameIndex(frames, 5)).toBe(2);
    expect(clampFrameIndex(frames, 1)).toBe(1);
    expect(clampFrameIndex([], 3)).toBe(0);
  });
});

// ── 어니언스키닝 ─────────────────────────────────────────────────────

describe("normalizeOnionSkinSettings", () => {
  it("부분 입력을 기본값과 병합하고 범위를 클램프", () => {
    const normalized = normalizeOnionSkinSettings({ prevCount: 99, nextCount: -1, opacity: 2 });
    expect(normalized).toEqual({ enabled: true, prevCount: 3, nextCount: 0, opacity: 1, tint: true });
  });

  it("undefined면 기본값", () => {
    expect(normalizeOnionSkinSettings(undefined)).toEqual(DEFAULT_ONION_SKIN);
  });
});

describe("onionSkinLayers", () => {
  const frames = [frame("a"), frame("b"), frame("c"), frame("d"), frame("e")];
  const settings: OnionSkinSettings = { enabled: true, prevCount: 2, nextCount: 2, opacity: 0.4, tint: true };

  it("disabled면 빈 배열", () => {
    expect(onionSkinLayers(frames, 2, { ...settings, enabled: false })).toEqual([]);
  });

  it("프레임이 2장 미만이면 빈 배열", () => {
    expect(onionSkinLayers([frame("a")], 0, settings)).toEqual([]);
  });

  it("가운데 인덱스에서 이전(가까운 순) → 다음(가까운 순) 순서로 조화 감쇠 불투명도", () => {
    const layers = onionSkinLayers(frames, 2, settings); // 활성 = c
    expect(layers.map((l) => [l.frame.id, l.offset, l.tint])).toEqual([
      ["b", -1, "prev"],
      ["a", -2, "prev"],
      ["d", 1, "next"],
      ["e", 2, "next"],
    ]);
    expect(layers[0].opacity).toBeCloseTo(0.4, 9); // offset 1
    expect(layers[1].opacity).toBeCloseTo(0.2, 9); // offset 2 → 절반
    expect(layers[2].opacity).toBeCloseTo(0.4, 9);
    expect(layers[3].opacity).toBeCloseTo(0.2, 9);
  });

  it("시퀀스 시작 경계를 넘으면 래핑 없이 멈춘다", () => {
    const layers = onionSkinLayers(frames, 0, settings); // 활성 = a(맨 앞)
    expect(layers.every((l) => l.offset > 0)).toBe(true); // prev 레이어 없음(반대편 끝 유령 금지)
    expect(layers.map((l) => l.frame.id)).toEqual(["b", "c"]);
  });

  it("시퀀스 끝 경계를 넘으면 래핑 없이 멈춘다", () => {
    const layers = onionSkinLayers(frames, 4, settings); // 활성 = e(맨 뒤)
    expect(layers.every((l) => l.offset < 0)).toBe(true);
    expect(layers.map((l) => l.frame.id)).toEqual(["d", "c"]);
  });

  it("tint=false면 모든 레이어가 none", () => {
    const layers = onionSkinLayers(frames, 2, { ...settings, tint: false });
    expect(layers.every((l) => l.tint === "none")).toBe(true);
  });

  it("prevCount/nextCount 0이면 해당 방향 레이어 없음", () => {
    const layers = onionSkinLayers(frames, 2, { ...settings, prevCount: 0, nextCount: 1 });
    expect(layers.map((l) => l.offset)).toEqual([1]);
  });
});

// ── 재생 타이밍 ──────────────────────────────────────────────────────

describe("frameIndexAtElapsed", () => {
  const durations = [100, 200, 300]; // 총 600ms

  it("경과 시간에 맞는 인덱스를 찾는다", () => {
    expect(frameIndexAtElapsed(durations, 0, true)).toBe(0);
    expect(frameIndexAtElapsed(durations, 50, true)).toBe(0);
    expect(frameIndexAtElapsed(durations, 100, true)).toBe(1);
    expect(frameIndexAtElapsed(durations, 250, true)).toBe(1);
    expect(frameIndexAtElapsed(durations, 300, true)).toBe(2);
    expect(frameIndexAtElapsed(durations, 599, true)).toBe(2);
  });

  it("loop=true면 총합을 넘으면 래핑", () => {
    expect(frameIndexAtElapsed(durations, 600, true)).toBe(0); // 정확히 한 바퀴
    expect(frameIndexAtElapsed(durations, 650, true)).toBe(0);
    expect(frameIndexAtElapsed(durations, 700, true)).toBe(1);
    expect(frameIndexAtElapsed(durations, 600 * 3 + 250, true)).toBe(1); // 여러 바퀴 후
  });

  it("loop=false면 마지막 프레임에서 클램프", () => {
    expect(frameIndexAtElapsed(durations, 600, false)).toBe(2);
    expect(frameIndexAtElapsed(durations, 100_000, false)).toBe(2);
  });

  it("빈 배열/합이 0이면 인덱스 0", () => {
    expect(frameIndexAtElapsed([], 100, true)).toBe(0);
    expect(frameIndexAtElapsed([0, 0], 100, true)).toBe(0);
  });
});

// ── 내보내기 플래너 ──────────────────────────────────────────────────

describe("planFrameAnimationExport", () => {
  it("픽셀레이트로 크기를 스케일하고 loopDurationMs·durationSec을 계산", () => {
    const frames = [frame("a", 100), frame("b", 200)];
    const plan = planFrameAnimationExport(300, 200, frames, 10, { pixelRatio: 2, loopCount: 3 });
    expect(plan.width).toBe(600);
    expect(plan.height).toBe(400);
    expect(plan.frameDurations).toEqual([100, 200]);
    expect(plan.loopDurationMs).toBe(300);
    expect(plan.durationSec).toBeCloseTo(0.9, 9); // 300ms * 3 / 1000
    expect(plan.captureFps).toBe(30);
  });

  it("옵션 미지정 시 기본값(2x·3회 반복) 적용", () => {
    const frames = [frame("a")];
    const plan = planFrameAnimationExport(100, 100, frames, DEFAULT_FRAME_FPS);
    expect(plan.width).toBe(DEFAULT_FRAME_ANIMATION_EXPORT_OPTIONS.pixelRatio * 100);
    expect(plan.loopCount).toBe(DEFAULT_FRAME_ANIMATION_EXPORT_OPTIONS.loopCount);
  });

  it("frames가 비어 있으면 durationSec 0", () => {
    const plan = planFrameAnimationExport(100, 100, [], DEFAULT_FRAME_FPS);
    expect(plan.frameDurations).toEqual([]);
    expect(plan.loopDurationMs).toBe(0);
    expect(plan.durationSec).toBe(0);
  });

  it("loopCount/pixelRatio를 안전 범위로 클램프", () => {
    const frames = [frame("a", 100)];
    const plan = planFrameAnimationExport(100, 100, frames, 10, { loopCount: 999, pixelRatio: 999 });
    expect(plan.loopCount).toBe(20);
    expect(plan.width).toBe(400); // pixelRatio 클램프 4
  });
});

describe("frameAnimationExportFileName", () => {
  it("제목 기반 파일명, 빈 제목이면 기본값", () => {
    expect(frameAnimationExportFileName("내 작품")).toBe("내 작품-frames.webm");
    expect(frameAnimationExportFileName("  ")).toBe("toonspectrum-frame-anim-frames.webm");
  });
});

// ── 내보내기 실행(주입형 fake deps) — studio-motion-export.test.ts의 하네스를 미러링 ──

interface CtxOp {
  op: string;
  args: unknown[];
}

function createFakeCtx() {
  const ops: CtxOp[] = [];
  const push = (op: string) => (...args: unknown[]) => ops.push({ op, args });
  const ctx = {
    globalAlpha: 1,
    fillStyle: "",
    fillRect: push("fillRect"),
    drawImage: push("drawImage"),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops };
}

interface TrackLike {
  stopped: boolean;
  stop(): void;
}

class FakeRecorder {
  started: number | undefined;
  stopCount = 0;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  start(timesliceMs?: number) {
    this.started = timesliceMs;
  }
  stop() {
    this.stopCount += 1;
    if (this.stopCount > 1) return;
    this.ondataavailable?.({ data: new Blob(["chunk"], { type: "video/webm" }) });
    this.onstop?.();
  }
}

function createFakeRig(overrides?: Partial<MotionExportDeps>) {
  const { ctx, ops } = createFakeCtx();
  const videoTrack: TrackLike = {
    stopped: false,
    stop() {
      this.stopped = true;
    },
  };
  let recorder: FakeRecorder | null = null;
  let nowMs = 0;
  const pending: (() => void)[] = [];
  const deps: MotionExportDeps = {
    createCanvas: (width, height) => ({
      width,
      height,
      getContext: () => ctx,
      captureStream: () => ({ addTrack: () => {}, getTracks: () => [videoTrack] }),
    }),
    createRecorder: (_stream, _options) => {
      recorder = new FakeRecorder();
      return recorder;
    },
    isMimeSupported: () => true,
    createAudio: vi.fn(async () => null),
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
    advance(ms: number) {
      nowMs += ms;
      pending.shift()?.();
    },
    hasPending: () => pending.length > 0,
    flush: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
  };
}

const CUT_IMAGE: MotionCutImage = { source: {} as CanvasImageSource, width: 100, height: 100 };

function makePlan(frames: StudioAnimFrame[] = [frame("a", 100), frame("b", 100)]): FrameAnimationExportPlan {
  return planFrameAnimationExport(100, 100, frames, 10, { loopCount: 1 });
}

async function pumpUntilDone(rig: ReturnType<typeof createFakeRig>, stepMs = 100, maxTicks = 200) {
  await rig.flush();
  let guard = 0;
  while (rig.hasPending() && guard < maxTicks) {
    rig.advance(stepMs);
    guard += 1;
  }
  await rig.flush();
}

describe("startFrameAnimationExport", () => {
  it("타임라인을 리플레이해 WebM blob으로 완료한다(진행률 단조 증가, audio=none)", async () => {
    const rig = createFakeRig();
    const progresses: { phase: string; ratio: number }[] = [];
    const handle = startFrameAnimationExport({
      plan: makePlan(),
      images: [CUT_IMAGE, CUT_IMAGE],
      onProgress: (p) => progresses.push(p),
      deps: rig.deps,
    });
    await pumpUntilDone(rig);
    const result = await handle.done;

    expect(result.audio).toBe("none");
    expect(result.blob.size).toBeGreaterThan(0);
    expect(rig.recorder()!.started).toBe(500);
    expect(rig.videoTrack.stopped).toBe(true);
    expect(rig.ops.some((o) => o.op === "drawImage")).toBe(true);

    const ratios = progresses.map((p) => p.ratio);
    expect(ratios.every((r, i) => i === 0 || r >= ratios[i - 1])).toBe(true);
    expect(progresses[progresses.length - 1]).toMatchObject({ phase: "finalize", ratio: 1 });
  });

  it("cancel()하면 취소 에러로 reject하고 자원을 정리한다", async () => {
    const rig = createFakeRig();
    const handle = startFrameAnimationExport({ plan: makePlan(), images: [CUT_IMAGE, CUT_IMAGE], deps: rig.deps });
    const settled = handle.done.catch((err: unknown) => err);
    await rig.flush();
    rig.advance(50);
    handle.cancel();
    const err = await settled;
    expect(isMotionExportCancelled(err)).toBe(true);
    expect(rig.videoTrack.stopped).toBe(true);
    expect(rig.recorder()!.stopCount).toBeGreaterThanOrEqual(1);
  });

  it("프레임이 없으면 즉시 reject", async () => {
    const rig = createFakeRig();
    const handle = startFrameAnimationExport({ plan: makePlan([]), images: [], deps: rig.deps });
    await expect(handle.done).rejects.toThrow("내보낼 프레임");
  });

  it("이미지 수가 플랜과 안 맞으면 즉시 reject", async () => {
    const rig = createFakeRig();
    const handle = startFrameAnimationExport({ plan: makePlan(), images: [CUT_IMAGE], deps: rig.deps });
    await expect(handle.done).rejects.toThrow("프레임 이미지 수");
  });

  it("WebM 미지원이면 즉시 reject", async () => {
    const rig = createFakeRig({ isMimeSupported: () => false });
    const handle = startFrameAnimationExport({ plan: makePlan(), images: [CUT_IMAGE, CUT_IMAGE], deps: rig.deps });
    await expect(handle.done).rejects.toThrow("WebM");
  });
});
