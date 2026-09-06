import { describe, expect, it } from "vitest";

import {
  DEFAULT_IMPORT_FRAME_DURATION_MS,
  isAnimatedImageDecodeCancelled,
  isAnimatedImageDecodeMime,
  isAnimatedImageDecodeSupported,
  planAnimatedImageImport,
  selectEvenlySpacedIndices,
  startAnimatedImageDecode,
  type AnimatedImageDecodeDeps,
  type AnimatedImageDecodeProgress,
  type DecodedImageFrameLike,
  type ImageDecoderLike,
} from "./studio-webcodecs-image-decode";

// ── 가짜 ImageDecoder ───────────────────────────────────────────────────

interface FakeDecodedFrame extends DecodedImageFrameLike {
  index: number;
  closed: boolean;
}

interface FakeDecoderOptions {
  durationsUs: readonly (number | null)[];
  repetitionCount?: number;
  animated?: boolean;
  /** null이면 selectedTrack이 없는 상태(디코딩 불가 파일)를 흉내낸다. */
  noTrack?: boolean;
}

class FakeImageDecoder implements ImageDecoderLike {
  readonly decoded: FakeDecodedFrame[] = [];
  closeCount = 0;
  readonly tracks: {
    ready: Promise<void>;
    selectedTrack: { frameCount: number; animated: boolean; repetitionCount: number } | null;
  };

  constructor(private readonly options: FakeDecoderOptions) {
    this.tracks = {
      ready: Promise.resolve(),
      selectedTrack: options.noTrack
        ? null
        : {
            frameCount: options.durationsUs.length,
            animated: options.animated ?? true,
            repetitionCount: options.repetitionCount ?? Number.POSITIVE_INFINITY,
          },
    };
  }

  decode(request: { frameIndex: number }): Promise<{ image: DecodedImageFrameLike; complete: boolean }> {
    const index = request.frameIndex;
    const frame: FakeDecodedFrame = {
      index,
      closed: false,
      duration: this.options.durationsUs[index] ?? null,
      timestamp: index * 1000,
      displayWidth: 320,
      displayHeight: 180,
      close: () => void (frame.closed = true),
    };
    this.decoded.push(frame);
    return Promise.resolve({ image: frame, complete: true });
  }

  close(): void {
    this.closeCount += 1;
  }
}

interface Harness {
  deps: AnimatedImageDecodeDeps<string>;
  decoder(): FakeImageDecoder;
  materialized(): number[];
}

function harness(options: FakeDecoderOptions): Harness {
  let decoder: FakeImageDecoder | null = null;
  const materialized: number[] = [];
  return {
    deps: {
      createDecoder() {
        decoder = new FakeImageDecoder(options);
        return decoder;
      },
      materialize(image) {
        const frame = image as FakeDecodedFrame;
        expect(frame.closed).toBe(false); // 아직 살아 있는 프레임만 변환한다
        materialized.push(frame.index);
        return `frame-${frame.index}`;
      },
      yieldToUi: () => Promise.resolve(),
    },
    decoder: () => decoder!,
    materialized: () => materialized,
  };
}

// ── 지원 판정 ───────────────────────────────────────────────────────────

describe("지원 판정", () => {
  it("node에는 ImageDecoder가 없으므로 미지원으로 정직하게 답한다", () => {
    expect(isAnimatedImageDecodeSupported()).toBe(false);
  });

  it("애니메이션 컨테이너 MIME만 대상으로 삼는다", () => {
    expect(isAnimatedImageDecodeMime("image/gif")).toBe(true);
    expect(isAnimatedImageDecodeMime("IMAGE/WEBP")).toBe(true);
    expect(isAnimatedImageDecodeMime(" image/apng ")).toBe(true);
    expect(isAnimatedImageDecodeMime("image/jpeg")).toBe(false);
    expect(isAnimatedImageDecodeMime("application/pdf")).toBe(false);
  });
});

// ── 균등 샘플링 ─────────────────────────────────────────────────────────

describe("프레임 솎아내기", () => {
  it("예산 안이면 전부 유지한다", () => {
    expect(selectEvenlySpacedIndices(4, 10)).toEqual([0, 1, 2, 3]);
    expect(selectEvenlySpacedIndices(0, 10)).toEqual([]);
  });

  it("예산을 넘으면 첫/마지막을 포함해 균등 간격으로 고른다", () => {
    expect(selectEvenlySpacedIndices(9, 5)).toEqual([0, 2, 4, 6, 8]);
    expect(selectEvenlySpacedIndices(10, 4)).toEqual([0, 3, 6, 9]);
    expect(selectEvenlySpacedIndices(100, 3)).toEqual([0, 50, 99]);
  });

  it("반올림이 겹치면 중복을 제거하고, 예산 1이면 첫 프레임만 남긴다", () => {
    expect(selectEvenlySpacedIndices(3, 1)).toEqual([0]);
    const thinned = selectEvenlySpacedIndices(5, 4);
    expect(thinned).toEqual([0, 1, 3, 4]);
    expect(new Set(thinned).size).toBe(thinned.length);
  });
});

// ── 프레임 플랜 ─────────────────────────────────────────────────────────

describe("프레임 플랜 계산", () => {
  it("µs 표시 시간을 ms로 바꾸고 총 길이를 그대로 보존한다", () => {
    const plan = planAnimatedImageImport({
      frameDurationsUs: [100_000, 40_000, 250_000],
      repetitionCount: Number.POSITIVE_INFINITY,
    });
    expect(plan.frames).toEqual([
      { sourceIndex: 0, durationMs: 100 },
      { sourceIndex: 1, durationMs: 40 },
      { sourceIndex: 2, durationMs: 250 },
    ]);
    expect(plan.totalDurationMs).toBe(390);
    expect(plan.droppedFrameCount).toBe(0);
    expect(plan.loopForever).toBe(true);
  });

  it("표시 시간이 없거나 0인 프레임은 브라우저 관행값(100ms)으로 채운다", () => {
    const plan = planAnimatedImageImport({ frameDurationsUs: [null, 0, undefined] });
    expect(plan.frames.map((frame) => frame.durationMs)).toEqual([
      DEFAULT_IMPORT_FRAME_DURATION_MS,
      DEFAULT_IMPORT_FRAME_DURATION_MS,
      DEFAULT_IMPORT_FRAME_DURATION_MS,
    ]);
    expect(plan.totalDurationMs).toBe(300);
  });

  it("솎아낸 프레임의 시간을 남은 프레임이 흡수해 총 재생 시간이 바뀌지 않는다", () => {
    const durations = Array.from({ length: 9 }, () => 50_000); // 9프레임 × 50ms = 450ms
    const plan = planAnimatedImageImport({ frameDurationsUs: durations, maxFrames: 5 });
    expect(plan.frames.map((frame) => frame.sourceIndex)).toEqual([0, 2, 4, 6, 8]);
    expect(plan.frames.map((frame) => frame.durationMs)).toEqual([100, 100, 100, 100, 50]);
    expect(plan.totalDurationMs).toBe(450);
    expect(plan.sourceFrameCount).toBe(9);
    expect(plan.droppedFrameCount).toBe(4);
  });

  it("반복 횟수가 유한하면 loopForever가 꺼지고 loopCount가 잡힌다", () => {
    expect(planAnimatedImageImport({ frameDurationsUs: [10_000], repetitionCount: 3 })).toMatchObject({
      loopForever: false,
      loopCount: 3,
    });
    expect(planAnimatedImageImport({ frameDurationsUs: [10_000], repetitionCount: 0 })).toMatchObject({
      loopForever: false,
      loopCount: 1,
    });
    // repetitionCount 자체가 없으면(정보 없음) 안전하게 무한 반복으로 본다.
    expect(planAnimatedImageImport({ frameDurationsUs: [10_000] }).loopForever).toBe(true);
  });

  it("평균 노출 시간에서 편집기 기본 fps를 제안하고 30fps로 상한을 건다", () => {
    expect(planAnimatedImageImport({ frameDurationsUs: [100_000, 100_000] }).suggestedFps).toBe(10);
    expect(planAnimatedImageImport({ frameDurationsUs: [1000, 1000] }).suggestedFps).toBe(30);
    expect(planAnimatedImageImport({ frameDurationsUs: [5_000_000] }).suggestedFps).toBe(1);
  });

  it("같은 입력이면 같은 플랜이 나온다", () => {
    const input = { frameDurationsUs: [33_000, 66_000, 99_000], maxFrames: 2 };
    expect(planAnimatedImageImport(input)).toEqual(planAnimatedImageImport(input));
  });
});

// ── 디코딩 오케스트레이션 ───────────────────────────────────────────────

describe("ImageDecoder 오케스트레이션", () => {
  const bytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);

  it("모든 프레임을 디코딩하되 유지 대상만 변환하고, 프레임은 전부 닫는다", async () => {
    const base = harness({ durationsUs: Array.from({ length: 9 }, () => 50_000) });
    const result = await startAnimatedImageDecode({
      data: bytes,
      mimeType: "image/gif",
      maxFrames: 5,
      deps: base.deps,
    }).done;

    // 표시 시간은 디코딩해야 알 수 있으므로 9장 전부 디코딩한다.
    expect(base.decoder().decoded).toHaveLength(9);
    // 비싼 변환(캔버스 래스터화)은 유지 대상 5장에만 한다.
    expect(base.materialized()).toEqual([0, 2, 4, 6, 8]);
    expect(result.frames).toEqual(["frame-0", "frame-2", "frame-4", "frame-6", "frame-8"]);
    expect(base.decoder().decoded.every((frame) => frame.closed)).toBe(true);
    expect(base.decoder().closeCount).toBe(1);
    expect(result.plan.totalDurationMs).toBe(450);
    expect(result.width).toBe(320);
    expect(result.height).toBe(180);
    expect(result.animated).toBe(true);
  });

  it("플랜 프레임 수와 변환된 프레임 수가 항상 일치한다", async () => {
    const base = harness({ durationsUs: [40_000, 40_000, 40_000, 40_000, 40_000, 40_000, 40_000] });
    const result = await startAnimatedImageDecode({
      data: bytes,
      mimeType: "image/gif",
      maxFrames: 3,
      deps: base.deps,
    }).done;
    expect(result.frames).toHaveLength(result.plan.frames.length);
    expect(result.plan.frames.map((frame) => frame.sourceIndex)).toEqual(base.materialized());
  });

  it("진행률이 프레임 수 기준으로 올라가고 plan 단계로 끝난다", async () => {
    const base = harness({ durationsUs: [10_000, 10_000, 10_000] });
    const progress: AnimatedImageDecodeProgress[] = [];
    await startAnimatedImageDecode({
      data: bytes,
      mimeType: "image/gif",
      deps: base.deps,
      onProgress: (entry) => progress.push(entry),
    }).done;
    expect(progress.map((entry) => entry.phase)).toEqual(["decode", "decode", "decode", "plan"]);
    expect(progress.map((entry) => entry.decodedFrames)).toEqual([1, 2, 3, 3]);
    expect(progress[progress.length - 1]!.ratio).toBe(1);
  });

  it("취소하면 전용 오류로 reject하고 디코더를 닫는다", async () => {
    const base = harness({ durationsUs: Array.from({ length: 40 }, () => 10_000) });
    const handle = startAnimatedImageDecode({
      data: bytes,
      mimeType: "image/gif",
      deps: base.deps,
    });
    handle.cancel();
    await expect(handle.done).rejects.toThrow();
    await handle.done.catch((error: unknown) => {
      expect(isAnimatedImageDecodeCancelled(error)).toBe(true);
    });
    expect(base.decoder().closeCount).toBe(1);
    expect(base.decoder().decoded.every((frame) => frame.closed)).toBe(true);
  });

  it("트랙이 없거나 프레임이 0이면 사용자용 오류를 낸다", async () => {
    const noTrack = harness({ durationsUs: [], noTrack: true });
    await expect(
      startAnimatedImageDecode({ data: bytes, mimeType: "image/gif", deps: noTrack.deps }).done
    ).rejects.toThrow(/프레임을 찾지 못했어요/);
    expect(noTrack.decoder().closeCount).toBe(1);

    const empty = harness({ durationsUs: [] });
    await expect(
      startAnimatedImageDecode({ data: bytes, mimeType: "image/gif", deps: empty.deps }).done
    ).rejects.toThrow(/프레임을 찾지 못했어요/);
  });

  it("정적 이미지(1프레임)도 1장짜리 플랜으로 정상 처리된다", async () => {
    const base = harness({ durationsUs: [null], animated: false, repetitionCount: 0 });
    const result = await startAnimatedImageDecode({
      data: bytes,
      mimeType: "image/png",
      deps: base.deps,
    }).done;
    expect(result.animated).toBe(false);
    expect(result.plan.frames).toEqual([{ sourceIndex: 0, durationMs: 100 }]);
    expect(result.frames).toEqual(["frame-0"]);
  });
});
