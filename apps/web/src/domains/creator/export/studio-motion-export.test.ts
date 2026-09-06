import { describe, expect, it, vi } from "vitest";

import { findBgmMood } from "../studio-bgm";
import { DEFAULT_WORK_FX, REVEAL_PRESETS, emphasisAnimation, findAmbientPreset } from "../studio-motion-fx";

import {
  DEFAULT_MOTION_EXPORT_OPTIONS,
  MOTION_HOLD_PRESETS,
  MOTION_POSE_IDENTITY,
  MOTION_RESOLUTION_PRESETS,
  MOTION_VIDEO_MIME_CANDIDATES,
  combineMotionPose,
  drawMotionFrame,
  easeOutCubic,
  emphasisPoseAt,
  frameSpecAt,
  isMotionExportCancelled,
  loadMotionCutImages,
  materializeExactMotionWebm,
  motionExportFileName,
  motionFramePose,
  normalizeMotionExportOptions,
  pickMotionVideoMime,
  planMotionExport,
  recommendVideoBitsPerSecond,
  revealPoseAt,
  scheduleMotionBgm,
  startMotionExport,
  type MotionCutImage,
  type MotionExportDeps,
  type MotionExportPlan,
  type MotionExportProgress,
  type MotionRecorderLike,
  type MotionStreamLike,
  type MotionSynthContext,
  type MotionSynthNode,
  type MotionTrackLike,
} from "./studio-motion-export";

// ── 플래너 ───────────────────────────────────────────────────────────

const FAST = { fps: 10, revealSec: 0.5, holdSec: 1, tailSec: 0.5, width: 72, height: 128 };

describe("planMotionExport", () => {
  it("컷 수만큼 세그먼트를 만들고 등장 시점이 단조 증가한다", () => {
    const fx = { ...DEFAULT_WORK_FX, reveal: "fade-up" };
    const plan = planMotionExport(3, fx, FAST);
    expect(plan.cuts).toHaveLength(3);
    for (let i = 0; i < plan.cuts.length; i++) {
      const c = plan.cuts[i];
      expect(c.index).toBe(i);
      expect(c.revealEndSec).toBeGreaterThan(c.startSec);
      expect(c.endSec).toBeGreaterThan(c.revealEndSec);
      if (i > 0) expect(c.startSec).toBeCloseTo(plan.cuts[i - 1].endSec, 9);
    }
    // 컷당 0.5(리빌) + 1(정지) = 1.5초 × 3 + 0.5(tail)
    expect(plan.durationSec).toBeCloseTo(5, 9);
    expect(plan.frameCount).toBe(50);
  });

  it("reveal 'none'이면 리빌 구간이 없다(revealEnd === start)", () => {
    const plan = planMotionExport(1, { ...DEFAULT_WORK_FX, reveal: "none" }, FAST);
    expect(plan.cuts[0].revealEndSec).toBe(plan.cuts[0].startSec);
    expect(plan.durationSec).toBeCloseTo(1.5, 9);
  });

  it("컷별 fx(cutFx 상속/오버라이드)와 강조 길이를 반영한다", () => {
    const fx = {
      ...DEFAULT_WORK_FX,
      reveal: "fade",
      cuts: [
        { reveal: "", emphasis: "shake" }, // 상속 + 강조
        { reveal: "slide-in", emphasis: "none" }, // 오버라이드
      ],
    };
    const plan = planMotionExport(2, fx, FAST);
    expect(plan.cuts[0].reveal).toBe("fade");
    expect(plan.cuts[0].emphasis).toBe("shake");
    expect(plan.cuts[1].reveal).toBe("slide-in");
    const shakeSec = emphasisAnimation("shake")!.options.duration / 1000;
    expect(plan.cuts[0].emphasisEndSec - plan.cuts[0].revealEndSec).toBeCloseTo(shakeSec, 9);
    // 강조 없는 컷은 emphasisEnd === revealEnd
    expect(plan.cuts[1].emphasisEndSec).toBe(plan.cuts[1].revealEndSec);
  });

  it("총 길이가 상한을 넘으면 타임라인 전체를 균등 축소한다", () => {
    const fx = { ...DEFAULT_WORK_FX, reveal: "fade-up" };
    const raw = planMotionExport(10, fx, FAST); // 15.5초
    const capped = planMotionExport(10, fx, { ...FAST, maxDurationSec: 10 });
    expect(raw.durationSec).toBeCloseTo(15.5, 9);
    expect(capped.durationSec).toBeCloseTo(10, 9);
    const k = 10 / 15.5;
    expect(capped.cuts[0].endSec).toBeCloseTo(raw.cuts[0].endSec * k, 9);
    expect(capped.cuts[9].endSec).toBeLessThanOrEqual(10);
  });

  it("페이지가 없으면 빈 플랜", () => {
    const plan = planMotionExport(0, DEFAULT_WORK_FX, FAST);
    expect(plan.cuts).toEqual([]);
    expect(plan.durationSec).toBe(0);
    expect(plan.frameCount).toBe(0);
    expect(frameSpecAt(plan, 0)).toBeNull();
  });

  it("fx의 ambient·BGM 설정을 플랜에 실어 나른다", () => {
    const fx = { ...DEFAULT_WORK_FX, ambient: "snow", bgmMood: "calm", bgmVolume: 0.7 };
    const plan = planMotionExport(1, fx, FAST);
    expect(plan.ambient).toBe("snow");
    expect(plan.bgm).toEqual({ mood: "calm", url: "", volume: 0.7 });
  });

  it("옵션을 안전 범위로 정규화한다", () => {
    const o = normalizeMotionExportOptions({ fps: 999, width: -5, holdSec: 0, maxDurationSec: 1 });
    expect(o.fps).toBe(60);
    expect(o.width).toBe(16);
    expect(o.holdSec).toBe(0.3);
    expect(o.maxDurationSec).toBe(5);
    expect(normalizeMotionExportOptions()).toEqual(DEFAULT_MOTION_EXPORT_OPTIONS);
  });
});

describe("frameSpecAt", () => {
  const fx = {
    ...DEFAULT_WORK_FX,
    reveal: "fade-up",
    cuts: [
      { reveal: "", emphasis: "punch" },
      { reveal: "", emphasis: "none" },
    ],
  };
  const plan = planMotionExport(2, fx, FAST);

  it("리빌 구간에서는 진행도가 0..1로 오른다", () => {
    expect(frameSpecAt(plan, 0)!.revealProgress).toBe(0);
    expect(frameSpecAt(plan, 0.25)!.revealProgress).toBeCloseTo(0.5, 9);
    expect(frameSpecAt(plan, 0.5)!.revealProgress).toBe(1);
    expect(frameSpecAt(plan, -3)!.cutIndex).toBe(0); // 음수 t는 0으로 클램프
  });

  it("강조 창(리빌 직후)에서만 emphasisProgress가 있다", () => {
    const punchSec = emphasisAnimation("punch")!.options.duration / 1000;
    const mid = frameSpecAt(plan, 0.5 + punchSec / 2)!;
    expect(mid.emphasisProgress).toBeCloseTo(0.5, 9);
    expect(frameSpecAt(plan, 0.4)!.emphasisProgress).toBeNull(); // 리빌 중
    expect(frameSpecAt(plan, 0.5 + punchSec + 0.01)!.emphasisProgress).toBeNull(); // 재생 끝
  });

  it("컷 경계에서 다음 컷으로 넘어가고, 끝나면 마지막 컷을 유지한다", () => {
    const secondStart = plan.cuts[1].startSec;
    expect(frameSpecAt(plan, secondStart - 0.01)!.cutIndex).toBe(0);
    expect(frameSpecAt(plan, secondStart)!.cutIndex).toBe(1);
    const tail = frameSpecAt(plan, plan.durationSec + 5)!;
    expect(tail.cutIndex).toBe(1);
    expect(tail.revealProgress).toBe(1);
  });
});

// ── 포즈 보간 ────────────────────────────────────────────────────────

describe("revealPoseAt", () => {
  it("progress 1이면 모든 프리셋이 identity로 수렴한다", () => {
    for (const p of REVEAL_PRESETS) {
      expect(revealPoseAt(p.id, 1)).toEqual(MOTION_POSE_IDENTITY);
    }
  });

  it("fade-up의 시작 포즈는 아래(+32px)·투명", () => {
    const pose = revealPoseAt("fade-up", 0);
    expect(pose.opacity).toBe(0);
    expect(pose.translateY).toBe(32);
  });

  it("rotate-in은 회전+축소, blur-in은 블러에서 시작한다", () => {
    const rot = revealPoseAt("rotate-in", 0);
    expect(rot.rotateDeg).toBe(-4);
    expect(rot.scale).toBeCloseTo(0.94, 9);
    const blur = revealPoseAt("blur-in", 0);
    expect(blur.blurPx).toBe(10);
    expect(blur.opacity).toBeCloseTo(0.25, 9);
  });

  it("none은 진행도와 무관하게 identity", () => {
    expect(revealPoseAt("none", 0)).toEqual(MOTION_POSE_IDENTITY);
    expect(revealPoseAt("none", 0.3)).toEqual(MOTION_POSE_IDENTITY);
  });

  it("중간 진행도는 easeOutCubic 보간을 따른다", () => {
    const pose = revealPoseAt("fade-up", 0.5);
    const t = easeOutCubic(0.5);
    expect(pose.translateY).toBeCloseTo(32 * (1 - t), 9);
    expect(pose.opacity).toBeCloseTo(t, 9);
  });
});

describe("emphasisPoseAt", () => {
  it("none/미지정은 identity", () => {
    expect(emphasisPoseAt("none", 0.5)).toEqual(MOTION_POSE_IDENTITY);
    expect(emphasisPoseAt("xxx", 0.5)).toEqual(MOTION_POSE_IDENTITY);
  });

  it("shake는 중간에 좌우 이동, 양 끝은 제자리", () => {
    expect(emphasisPoseAt("shake", 0).translateX).toBe(0);
    expect(emphasisPoseAt("shake", 1).translateX).toBe(0);
    expect(emphasisPoseAt("shake", 0.1).translateX).toBeCloseTo(-4.5, 9); // 0↔-9 중간
  });

  it("flash는 밝기 강조(중간 1.9), pop은 명시 offset(0.6에서 scale 1.05)을 따른다", () => {
    expect(emphasisPoseAt("flash", 0.5).brightness).toBeCloseTo(1.9, 9);
    expect(emphasisPoseAt("pop", 0.6).scale).toBeCloseTo(1.05, 9);
    expect(emphasisPoseAt("pop", 1).scale).toBeCloseTo(1, 9);
  });
});

describe("포즈 합성", () => {
  it("combineMotionPose — 곱/합 규칙", () => {
    const a = { ...MOTION_POSE_IDENTITY, opacity: 0.5, translateX: 10, scale: 2 };
    const b = { ...MOTION_POSE_IDENTITY, opacity: 0.5, translateX: -4, scale: 0.5, rotateDeg: 3 };
    const c = combineMotionPose(a, b);
    expect(c.opacity).toBe(0.25);
    expect(c.translateX).toBe(6);
    expect(c.scale).toBe(1);
    expect(c.rotateDeg).toBe(3);
  });

  it("motionFramePose — 강조 미재생이면 리빌 포즈만", () => {
    const frame = {
      timeSec: 0,
      cutIndex: 0,
      reveal: "zoom-in",
      emphasis: "punch",
      revealProgress: 0,
      emphasisProgress: null,
    };
    expect(motionFramePose(frame)).toEqual(revealPoseAt("zoom-in", 0));
  });
});

// ── 인코딩 스펙 ──────────────────────────────────────────────────────

describe("pickMotionVideoMime", () => {
  it("작업 전 probe에서 첫 지원 MIME 하나를 확정한다", () => {
    expect(pickMotionVideoMime(() => true)).toBe(MOTION_VIDEO_MIME_CANDIDATES[0]);
    expect(pickMotionVideoMime((m) => !m.includes("vp9"))).toBe(MOTION_VIDEO_MIME_CANDIDATES[1]);
    expect(pickMotionVideoMime((m) => !m.includes("codecs"))).toBeNull();
    expect(pickMotionVideoMime(() => false)).toBeNull();
  });

  it("MediaRecorder codec receipt와 WebM EBML magic을 모두 exact 검증한다", async () => {
    const webm = new Blob([
      Uint8Array.of(0x1a, 0x45, 0xdf, 0xa3, 0x01) as unknown as BlobPart,
    ], { type: "video/webm" });
    await expect(materializeExactMotionWebm(
      [webm],
      "video/webm;codecs=vp9,opus",
      'video/webm; codecs="vp9, opus"',
    )).resolves.toMatchObject({ mimeType: "video/webm;codecs=vp9,opus" });
    await expect(materializeExactMotionWebm(
      [webm],
      "video/webm;codecs=vp9,opus",
      "video/webm",
    )).rejects.toMatchObject({
      name: "MotionExportCodecUnavailableError",
      reason: "codec-identity",
    });
    await expect(materializeExactMotionWebm(
      [new Blob(["not-webm"], { type: "video/webm" })],
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp9,opus",
    )).rejects.toMatchObject({
      name: "MotionExportCodecUnavailableError",
      reason: "container-magic",
    });
  });
});

describe("recommendVideoBitsPerSecond / motionExportFileName", () => {
  it("해상도에 비례하고 상·하한을 지킨다", () => {
    const sd = recommendVideoBitsPerSecond(720, 1280, 30);
    const hd = recommendVideoBitsPerSecond(1080, 1920, 30);
    expect(hd).toBeGreaterThan(sd);
    expect(recommendVideoBitsPerSecond(16, 16, 5)).toBe(2_500_000);
    expect(recommendVideoBitsPerSecond(4096, 4096, 60)).toBe(16_000_000);
  });

  it("파일명 — 제목 기반 -motion.webm, 빈 제목은 기본값", () => {
    expect(motionExportFileName("나의 만화")).toBe("나의 만화-motion.webm");
    expect(motionExportFileName("  ")).toBe("toonspectrum-motion-motion.webm");
  });

  it("패널 프리셋 데이터가 유효하다", () => {
    expect(new Set(MOTION_RESOLUTION_PRESETS.map((r) => r.id)).size).toBe(MOTION_RESOLUTION_PRESETS.length);
    expect(new Set(MOTION_HOLD_PRESETS.map((h) => h.id)).size).toBe(MOTION_HOLD_PRESETS.length);
    for (const h of MOTION_HOLD_PRESETS) expect(h.holdSec).toBeGreaterThan(0);
  });
});

// ── BGM 신스 스케줄러 ────────────────────────────────────────────────

interface FakeOscillator {
  type: string;
  frequency: { value: number } & Record<string, unknown>;
  startAt: number;
  stopAt: number;
}

function createFakeSynthContext() {
  const oscillators: FakeOscillator[] = [];
  let gainCount = 0;
  const makeParam = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  });
  const ctx: MotionSynthContext = {
    currentTime: 1,
    createGain() {
      gainCount += 1;
      return { gain: makeParam(), connect: vi.fn() };
    },
    createOscillator() {
      const osc = {
        type: "",
        frequency: makeParam(),
        connect: vi.fn(),
        startAt: -1,
        stopAt: -1,
        start(when: number) {
          osc.startAt = when;
        },
        stop(when: number) {
          osc.stopAt = when;
        },
      };
      oscillators.push(osc);
      return osc;
    },
    createBiquadFilter() {
      return { type: "", frequency: makeParam(), connect: vi.fn() };
    },
  };
  return { ctx, oscillators, gainCount: () => gainCount };
}

describe("scheduleMotionBgm", () => {
  it("총 길이를 덮을 때까지 3음 트라이어드를 예약한다", () => {
    const { ctx, oscillators } = createFakeSynthContext();
    const dest: MotionSynthNode = { connect: vi.fn() };
    const mood = findBgmMood("calm")!; // tempo 64 → 마디(4박) 3.75초
    scheduleMotionBgm(ctx, dest, mood, 0.5, 10);
    // 10초 / 3.75초 = 2.67 → 3마디 × 3음 = 9 오실레이터
    expect(oscillators).toHaveLength(9);
    for (const osc of oscillators) {
      expect(osc.type).toBe(mood.waveform);
      expect(osc.frequency.value).toBeGreaterThan(0);
      expect(osc.startAt).toBeGreaterThanOrEqual(1.05);
      expect(osc.stopAt).toBeLessThanOrEqual(1.05 + 10 + 0.05 + 1e-9);
    }
  });

  it("길이가 0 이하면 아무것도 예약하지 않는다", () => {
    const { ctx, oscillators, gainCount } = createFakeSynthContext();
    scheduleMotionBgm(ctx, { connect: vi.fn() }, findBgmMood("calm")!, 0.5, 0);
    expect(oscillators).toHaveLength(0);
    expect(gainCount()).toBe(0);
  });
});

// ── 프레임 렌더러 ────────────────────────────────────────────────────

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
    strokeStyle: "",
    lineWidth: 1,
    filter: "none",
    fillRect: push("fillRect"),
    drawImage: push("drawImage"),
    save: push("save"),
    restore: push("restore"),
    translate: push("translate"),
    rotate: push("rotate"),
    scale: push("scale"),
    beginPath: push("beginPath"),
    moveTo: push("moveTo"),
    lineTo: push("lineTo"),
    stroke: push("stroke"),
    fill: push("fill"),
    arc: push("arc"),
    ellipse: push("ellipse"),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops, raw: ctx };
}

const CUT_IMAGE: MotionCutImage = { source: {} as CanvasImageSource, width: 720, height: 1280 };

describe("drawMotionFrame", () => {
  const fx = { ...DEFAULT_WORK_FX, reveal: "fade-up", ambient: "snow" };
  const plan = planMotionExport(1, fx, { ...FAST, width: 720, height: 1280 });

  it("배경 → 컷(포즈 변환) → 파티클 순서로 그린다", () => {
    const { ctx, ops } = createFakeCtx();
    const frame = frameSpecAt(plan, 0)!; // 리빌 시작 — translateY 32, opacity 0
    const particles = [{ x: 10, y: 20, size: 3, vx: 0, vy: 0, rot: 0, vr: 0, phase: 0 }];
    drawMotionFrame(ctx, {
      plan,
      frame,
      image: CUT_IMAGE,
      particles,
      ambientPreset: findAmbientPreset("snow"),
      background: "#101014",
      timeSec: 0,
    });
    const names = ops.map((o) => o.op);
    expect(names[0]).toBe("fillRect");
    expect(names).toContain("drawImage");
    expect(names.indexOf("drawImage")).toBeLessThan(names.indexOf("arc")); // 파티클은 컷 위
    const translate = ops.find((o) => o.op === "translate")!;
    expect(translate.args[0]).toBeCloseTo(360, 6); // 중앙
    expect(translate.args[1]).toBeCloseTo(640 + 32, 6); // +32px(폭 720 기준 k=1)
  });

  it("이미지가 없어도 배경은 그린다", () => {
    const { ctx, ops } = createFakeCtx();
    drawMotionFrame(ctx, {
      plan,
      frame: frameSpecAt(plan, 1)!,
      image: undefined,
      particles: [],
      ambientPreset: undefined,
      background: "#000",
      timeSec: 1,
    });
    expect(ops).toEqual([{ op: "fillRect", args: [0, 0, 720, 1280] }]);
  });
});

// ── 이미지 로딩 ──────────────────────────────────────────────────────

describe("loadMotionCutImages", () => {
  it("주입한 로더로 순서를 보존해 로드한다", async () => {
    const loadOne = vi.fn(async (url: string) => ({
      source: {} as CanvasImageSource,
      width: url.length,
      height: 1,
    }));
    const images = await loadMotionCutImages(["a", "bb", "ccc"], loadOne);
    expect(images.map((i) => i.width)).toEqual([1, 2, 3]);
    expect(loadOne).toHaveBeenCalledTimes(3);
  });
});

// ── 레코더 오케스트레이터 ────────────────────────────────────────────

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

function createFakeRig(overrides?: Partial<MotionExportDeps>) {
  const { ctx, ops } = createFakeCtx();
  const videoTrack: MotionTrackLike & { stopped: boolean } = {
    stopped: false,
    stop() {
      this.stopped = true;
    },
  };
  const added: MotionTrackLike[] = [];
  const stream: MotionStreamLike = {
    addTrack: (t) => added.push(t),
    getTracks: () => [videoTrack, ...added],
  };
  let recorder: FakeRecorder | null = null;
  let nowMs = 0;
  const pending: (() => void)[] = [];
  const deps: MotionExportDeps = {
    createCanvas: (width, height) => ({
      width,
      height,
      getContext: () => ctx,
      captureStream: () => stream,
    }),
    createRecorder: (s, options) => {
      recorder = new FakeRecorder(s, options);
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
    addedTracks: added,
    recorder: () => recorder,
    advance(ms: number) {
      nowMs += ms;
      pending.shift()?.();
    },
    hasPending: () => pending.length > 0,
    flush: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
  };
}

function makePlan(pages = 2, bgmMood = ""): MotionExportPlan {
  return planMotionExport(pages, { ...DEFAULT_WORK_FX, reveal: "fade-up", ambient: "snow", bgmMood }, FAST);
}

const IMAGES: MotionCutImage[] = [CUT_IMAGE, CUT_IMAGE];

async function pumpUntilDone(rig: ReturnType<typeof createFakeRig>, stepMs = 200, maxTicks = 200) {
  await rig.flush(); // createAudio 등 마이크로태스크 소진 → 프레임 루프 진입
  let guard = 0;
  while (rig.hasPending() && guard < maxTicks) {
    rig.advance(stepMs);
    guard += 1;
  }
  await rig.flush();
}

describe("startMotionExport", () => {
  it("선택된 MediaRecorder 생성 실패 뒤 다른 codec으로 재시도하지 않는다", async () => {
    const createRecorder = vi.fn((): MotionRecorderLike => {
      throw new Error("selected recorder failed");
    });
    const isMimeSupported = vi.fn((mime: string) => mime.includes("vp9"));
    const rig = createFakeRig({ createRecorder, isMimeSupported });

    const handle = startMotionExport({
      plan: makePlan(),
      images: IMAGES,
      muted: true,
      deps: rig.deps,
    });

    await expect(handle.done).rejects.toThrow("selected recorder failed");
    expect(createRecorder).toHaveBeenCalledTimes(1);
    expect(isMimeSupported).toHaveBeenCalledTimes(1);
    expect(isMimeSupported).toHaveBeenCalledWith(MOTION_VIDEO_MIME_CANDIDATES[0]);
  });

  it("타임라인을 리플레이해 WebM blob으로 완료한다(진행률 단조 증가)", async () => {
    const rig = createFakeRig();
    const progresses: MotionExportProgress[] = [];
    const handle = startMotionExport({
      plan: makePlan(),
      images: IMAGES,
      muted: true,
      onProgress: (p) => progresses.push(p),
      deps: rig.deps,
    });
    await pumpUntilDone(rig);
    const result = await handle.done;

    expect(result.mimeType).toBe("video/webm;codecs=vp9,opus");
    expect(result.blob.size).toBeGreaterThan(0);
    expect(result.audio).toBe("none");
    expect(result.durationSec).toBeCloseTo(3.5, 9);
    expect(rig.recorder()!.started).toBe(500);
    expect(rig.recorder()!.stopCount).toBeGreaterThanOrEqual(1);
    expect(rig.videoTrack.stopped).toBe(true); // 정리 — 트랙 해제
    expect(rig.ops.some((o) => o.op === "drawImage")).toBe(true);

    const ratios = progresses.map((p) => p.ratio);
    expect(ratios.every((r, i) => i === 0 || r >= ratios[i - 1])).toBe(true);
    expect(progresses[progresses.length - 1]).toMatchObject({ phase: "finalize", ratio: 1 });
    expect(progresses.some((p) => p.phase === "record")).toBe(true);
  });

  it("muted면 오디오 어댑터를 만들지 않는다", async () => {
    const rig = createFakeRig();
    const handle = startMotionExport({ plan: makePlan(), images: IMAGES, muted: true, deps: rig.deps });
    await pumpUntilDone(rig);
    await handle.done;
    expect(rig.deps.createAudio).not.toHaveBeenCalled();
  });

  it("BGM이 있으면 오디오 트랙을 스트림에 믹스한다(audio: mixed)", async () => {
    const audioTrack: MotionTrackLike & { stopped: boolean } = {
      stopped: false,
      stop() {
        this.stopped = true;
      },
    };
    const audio = { tracks: [audioTrack], start: vi.fn(), dispose: vi.fn() };
    const rig = createFakeRig({ createAudio: vi.fn(async () => audio) });
    const handle = startMotionExport({ plan: makePlan(2, "calm"), images: IMAGES, deps: rig.deps });
    await pumpUntilDone(rig);
    const result = await handle.done;
    expect(result.audio).toBe("mixed");
    expect(rig.addedTracks).toContain(audioTrack);
    expect(audio.start).toHaveBeenCalledTimes(1);
    expect(audio.dispose).toHaveBeenCalledTimes(1); // 종료 시 정리
  });

  it("오디오 준비가 실패해도 무음으로 계속한다(audio: failed)", async () => {
    const rig = createFakeRig({
      createAudio: vi.fn(async () => {
        throw new Error("no audio");
      }),
    });
    const handle = startMotionExport({ plan: makePlan(2, "calm"), images: IMAGES, deps: rig.deps });
    await pumpUntilDone(rig);
    const result = await handle.done;
    expect(result.audio).toBe("failed");
    expect(result.blob.size).toBeGreaterThan(0);
  });

  it("cancel()하면 취소 에러로 reject하고 자원을 정리한다", async () => {
    const rig = createFakeRig();
    const handle = startMotionExport({ plan: makePlan(), images: IMAGES, muted: true, deps: rig.deps });
    const settled = handle.done.catch((err: unknown) => err);
    await rig.flush();
    rig.advance(200); // 몇 프레임 진행 후
    handle.cancel();
    const err = await settled;
    expect(isMotionExportCancelled(err)).toBe(true);
    expect(rig.videoTrack.stopped).toBe(true);
    expect(rig.recorder()!.stopCount).toBeGreaterThanOrEqual(1);
  });

  it("빈 플랜/미지원 MIME은 즉시 reject한다", async () => {
    const rig = createFakeRig();
    const empty = startMotionExport({
      plan: planMotionExport(0, DEFAULT_WORK_FX, FAST),
      images: [],
      deps: rig.deps,
    });
    await expect(empty.done).rejects.toThrow("내보낼 컷");

    const unsupported = startMotionExport({
      plan: makePlan(),
      images: IMAGES,
      deps: { ...rig.deps, isMimeSupported: () => false },
    });
    await expect(unsupported.done).rejects.toThrow("WebM");

    const short = startMotionExport({ plan: makePlan(2), images: [CUT_IMAGE], deps: rig.deps });
    await expect(short.done).rejects.toThrow("컷 이미지 수");
  });

  it("취소 판별 헬퍼는 일반 에러와 구분한다", () => {
    expect(isMotionExportCancelled(new Error("x"))).toBe(false);
  });
});
