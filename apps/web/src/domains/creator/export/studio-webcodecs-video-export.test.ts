import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { planConstantRateTimeline, planVariableRateTimeline } from "../studio-webcodecs-timeline";

import {
  isWebCodecsExportCancelled,
  startWebCodecsVideoExport,
  webCodecsVideoFileName,
  type EncodedVideoChunkLike,
  type EncodedVideoChunkMetadataLike,
  type VideoEncoderLike,
  type VideoFrameLike,
  type WebCodecsVideoExportDeps,
  type WebCodecsVideoExportProgress,
} from "./studio-webcodecs-video-export";

import type { StudioVideoTimelineFrame } from "../studio-webcodecs-timeline";

async function expectCancelled(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toThrow();
  await promise.catch((error: unknown) => {
    expect(isWebCodecsExportCancelled(error)).toBe(true);
  });
}

// ── 가짜 WebCodecs 인코더 ───────────────────────────────────────────────
//
// node에는 VideoEncoder/VideoFrame이 없다. 이 가짜는 실제 인코더의 관찰 가능한 계약만 흉내낸다:
// 큐에 쌓였다가(encodeQueueSize) drain 시점에 output 콜백으로 chunk를 뱉고, flush()가 잔여를 비운다.

class FakeChunk implements EncodedVideoChunkLike {
  constructor(
    readonly type: "delta" | "key",
    readonly timestamp: number,
    readonly duration: number | null,
    private readonly payload: Uint8Array
  ) {}

  get byteLength(): number {
    return this.payload.length;
  }

  copyTo(destination: AllowSharedBufferSource): void {
    (destination as Uint8Array).set(this.payload);
  }
}

interface FakeFrame extends VideoFrameLike {
  spec: StudioVideoTimelineFrame;
  closed: boolean;
}

interface FakeEncoderOptions {
  /** true면 encode() 시점에 바로 output하지 않고 drain(yieldToUi/flush)까지 큐에 쌓아 둔다. */
  queueUntilDrain?: boolean;
  /** 첫 chunk의 metadata로 실어 보낼 CodecPrivate. */
  description?: Uint8Array;
  /** 이 순번 프레임을 encode할 때 error 콜백을 부른다. */
  failAtFrame?: number;
}

class FakeEncoder implements VideoEncoderLike {
  encodeQueueSize = 0;
  configured: VideoEncoderConfig | null = null;
  closeCount = 0;
  readonly encoded: { timestamp: number; duration: number; keyFrame: boolean }[] = [];
  peakQueueSize = 0;
  private readonly queue: { timestamp: number; duration: number; keyFrame: boolean }[] = [];
  private emittedDescription = false;

  constructor(
    private readonly handlers: {
      output(chunk: EncodedVideoChunkLike, metadata?: EncodedVideoChunkMetadataLike): void;
      error(error: unknown): void;
    },
    private readonly options: FakeEncoderOptions = {}
  ) {}

  configure(config: VideoEncoderConfig): void {
    this.configured = config;
  }

  encode(frame: VideoFrameLike, options?: { keyFrame?: boolean }): void {
    const spec = (frame as FakeFrame).spec;
    const entry = {
      timestamp: spec.timestampUs,
      duration: spec.durationUs,
      keyFrame: options?.keyFrame === true,
    };
    this.encoded.push(entry);
    if (this.options.failAtFrame === spec.index) {
      this.handlers.error(new Error("encoder blew up"));
      return;
    }
    this.queue.push(entry);
    this.encodeQueueSize = this.queue.length;
    this.peakQueueSize = Math.max(this.peakQueueSize, this.encodeQueueSize);
    if (!this.options.queueUntilDrain) this.drain();
  }

  drain(): void {
    while (this.queue.length > 0) {
      const entry = this.queue.shift()!;
      const payload = new Uint8Array([entry.keyFrame ? 0x4b : 0x44, entry.timestamp & 0xff]);
      const metadata: EncodedVideoChunkMetadataLike | undefined =
        !this.emittedDescription && this.options.description
          ? { decoderConfig: { description: this.options.description } }
          : undefined;
      if (metadata) this.emittedDescription = true;
      this.handlers.output(
        new FakeChunk(entry.keyFrame ? "key" : "delta", entry.timestamp, entry.duration, payload),
        metadata
      );
    }
    this.encodeQueueSize = 0;
  }

  flush(): Promise<void> {
    this.drain();
    return Promise.resolve();
  }

  close(): void {
    this.closeCount += 1;
  }
}

interface Harness {
  deps: WebCodecsVideoExportDeps;
  encoder: FakeEncoder;
  frames: FakeFrame[];
  yieldCount: () => number;
}

function harness(options: FakeEncoderOptions = {}): Harness {
  let encoder!: FakeEncoder;
  const frames: FakeFrame[] = [];
  let yields = 0;
  const deps: WebCodecsVideoExportDeps = {
    createEncoder(handlers) {
      encoder = new FakeEncoder(handlers, options);
      return encoder;
    },
    createFrame(spec) {
      const frame: FakeFrame = { spec, closed: false, close: () => void (frame.closed = true) };
      frames.push(frame);
      return frame;
    },
    yieldToUi() {
      yields += 1;
      encoder.drain(); // 실제 인코더가 백그라운드에서 큐를 비우는 것을 흉내낸다
      return Promise.resolve();
    },
  };
  // createEncoder가 불리기 전에 encoder를 참조하지 않도록 getter로 감싼다.
  return {
    deps,
    get encoder(): FakeEncoder {
      return encoder;
    },
    frames,
    yieldCount: () => yields,
  } as Harness;
}

const CONFIG: VideoEncoderConfig = {
  codec: "vp09.00.31.08",
  width: 720,
  height: 1280,
  framerate: 30,
  bitrate: 5_000_000,
};

function request(): {
  harness: Harness;
  options: Parameters<typeof startWebCodecsVideoExport>[0];
} {
  const base = harness();
  return {
    harness: base,
    options: {
      timeline: planConstantRateTimeline({ frameCount: 6, fps: 30, keyFrameIntervalSec: 0.1 }),
      config: CONFIG,
      webmCodecId: "V_VP9",
      deps: base.deps,
    },
  };
}

// ── 인코딩 흐름 ─────────────────────────────────────────────────────────

describe("WebCodecs 영상 내보내기", () => {
  it("타임라인 순서 그대로 인코딩하고 타임스탬프·키프레임 지시를 그대로 전달한다", async () => {
    const { harness: h, options } = request();
    const result = await startWebCodecsVideoExport(options).done;

    expect(h.encoder.configured).toEqual(CONFIG);
    expect(h.encoder.encoded.map((entry) => entry.timestamp)).toEqual(
      options.timeline.frames.map((frame) => frame.timestampUs)
    );
    expect(h.encoder.encoded.map((entry) => entry.keyFrame)).toEqual(
      options.timeline.frames.map((frame) => frame.keyFrame)
    );
    expect(result.frameCount).toBe(6);
    expect(result.keyFrameCount).toBe(2); // 0.1초 간격 = 3프레임마다
    expect(result.codecString).toBe("vp09.00.31.08");
    expect(result.mimeType).toBe('video/webm; codecs="vp09.00.31.08"');
    expect(result.durationSec).toBeCloseTo(0.2, 5);
  });

  it("만든 VideoFrame을 하나도 빠짐없이 즉시 닫는다(메모리 누수 방지)", async () => {
    const { harness: h, options } = request();
    await startWebCodecsVideoExport(options).done;
    expect(h.frames).toHaveLength(6);
    expect(h.frames.every((frame) => frame.closed)).toBe(true);
    expect(h.encoder.closeCount).toBe(1);
  });

  it("실제 재생 가능한 WebM 바이트를 낸다(EBML 시그니처 + Segment)", async () => {
    const { options } = request();
    const result = await startWebCodecsVideoExport(options).done;
    expect(Array.from(result.bytes.subarray(0, 4))).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
    expect(result.bytes.length).toBeGreaterThan(100);
    expect(result.clusterCount).toBe(2); // 키프레임마다 Cluster
  });

  it("인코더 metadata의 CodecPrivate(AV1 등)이 컨테이너에 실린다", async () => {
    const description = new Uint8Array([0x81, 0x0c, 0x3f, 0x77]);
    const base = harness({ description });
    const result = await startWebCodecsVideoExport({
      timeline: planConstantRateTimeline({ frameCount: 3, fps: 30 }),
      config: { ...CONFIG, codec: "av01.0.05M.08" },
      webmCodecId: "V_AV1",
      deps: base.deps,
    }).done;
    const haystack = Array.from(result.bytes).join(",");
    expect(haystack).toContain(Array.from(description).join(","));
    expect(result.mimeType).toBe('video/webm; codecs="av01.0.05M.08"');
  });

  it("VFR 타임라인도 그대로 인코딩된다(셀 애니메이션 경로)", async () => {
    const base = harness();
    const timeline = planVariableRateTimeline({ durationsMs: [100, 40, 250], loopCount: 2 });
    const result = await startWebCodecsVideoExport({
      timeline,
      config: CONFIG,
      webmCodecId: "V_VP9",
      deps: base.deps,
    }).done;
    expect(result.frameCount).toBe(6);
    expect(base.encoder.encoded.map((entry) => entry.timestamp)).toEqual([
      0, 100_000, 140_000, 390_000, 490_000, 530_000,
    ]);
    expect(result.durationSec).toBeCloseTo(0.78, 5);
  });
});

// ── 백프레셔 ────────────────────────────────────────────────────────────

describe("백프레셔", () => {
  it("큐 상한을 넘으면 양보해서 소진을 기다린다 — 큐가 상한 이상으로 자라지 않는다", async () => {
    const base = harness({ queueUntilDrain: true });
    await startWebCodecsVideoExport({
      timeline: planConstantRateTimeline({ frameCount: 20, fps: 30 }),
      config: CONFIG,
      webmCodecId: "V_VP9",
      maxQueueSize: 3,
      deps: base.deps,
    }).done;
    expect(base.encoder.peakQueueSize).toBeLessThanOrEqual(3);
    expect(base.yieldCount()).toBeGreaterThan(0);
  });

  it("큐가 비어 있으면 양보하지 않는다(불필요한 지연 없음)", async () => {
    const { harness: h, options } = request();
    await startWebCodecsVideoExport(options).done;
    expect(h.yieldCount()).toBe(0);
  });
});

// ── 취소·오류 ───────────────────────────────────────────────────────────

describe("취소와 오류", () => {
  it("취소하면 전용 오류로 reject하고 인코더를 닫는다", async () => {
    const base = harness({ queueUntilDrain: true });
    const handle = startWebCodecsVideoExport({
      timeline: planConstantRateTimeline({ frameCount: 50, fps: 30 }),
      config: CONFIG,
      webmCodecId: "V_VP9",
      maxQueueSize: 2,
      deps: base.deps,
    });
    handle.cancel();
    await expectCancelled(handle.done);
    expect(base.encoder.closeCount).toBe(1);
    expect(base.frames.every((frame) => frame.closed)).toBe(true);
  });

  it("인코딩 도중 취소하면 남은 프레임을 더 만들지 않는다", async () => {
    const base = harness({ queueUntilDrain: true });
    let created = 0;
    const deps: WebCodecsVideoExportDeps = {
      ...base.deps,
      createFrame(spec) {
        created += 1;
        if (created === 3) handle.cancel();
        return base.deps.createFrame(spec);
      },
    };
    const handle = startWebCodecsVideoExport({
      timeline: planConstantRateTimeline({ frameCount: 30, fps: 30 }),
      config: CONFIG,
      webmCodecId: "V_VP9",
      deps,
    });
    await expectCancelled(handle.done);
    expect(created).toBe(3);
  });

  it("인코더 error 콜백은 사용자용 한국어 오류가 된다", async () => {
    const base = harness({ failAtFrame: 2 });
    await expect(
      startWebCodecsVideoExport({
        timeline: planConstantRateTimeline({ frameCount: 10, fps: 30 }),
        config: CONFIG,
        webmCodecId: "V_VP9",
        deps: base.deps,
      }).done
    ).rejects.toThrow(/영상 인코딩 중 오류/);
    expect(base.encoder.closeCount).toBe(1);
  });

  it("프레임이 없거나 첫 프레임이 키프레임이 아니면 시작 전에 거부한다", async () => {
    const empty = harness();
    await expect(
      startWebCodecsVideoExport({
        timeline: planConstantRateTimeline({ frameCount: 0, fps: 30 }),
        config: CONFIG,
        webmCodecId: "V_VP9",
        deps: empty.deps,
      }).done
    ).rejects.toThrow(/프레임이 없어요/);

    const broken = harness();
    const timeline = planConstantRateTimeline({ frameCount: 3, fps: 30 });
    timeline.frames[0]!.keyFrame = false;
    await expect(
      startWebCodecsVideoExport({
        timeline,
        config: CONFIG,
        webmCodecId: "V_VP9",
        deps: broken.deps,
      }).done
    ).rejects.toThrow(/키프레임/);
  });
});

// ── 진행률·결정성 ───────────────────────────────────────────────────────

describe("진행률과 결정성", () => {
  it("진행률이 단조 증가하고 encode → flush → finalize 순으로 끝난다", async () => {
    const base = harness();
    const progress: WebCodecsVideoExportProgress[] = [];
    await startWebCodecsVideoExport({
      timeline: planConstantRateTimeline({ frameCount: 5, fps: 30 }),
      config: CONFIG,
      webmCodecId: "V_VP9",
      deps: base.deps,
      onProgress: (entry) => progress.push(entry),
    }).done;
    const phases = progress.map((entry) => entry.phase);
    expect(phases.slice(0, 5)).toEqual(["encode", "encode", "encode", "encode", "encode"]);
    expect(phases.slice(5)).toEqual(["flush", "finalize"]);
    for (let index = 1; index < progress.length; index += 1) {
      expect(progress[index]!.ratio).toBeGreaterThanOrEqual(progress[index - 1]!.ratio);
    }
    expect(progress[progress.length - 1]!.ratio).toBe(1);
  });

  it("같은 타임라인·같은 인코더 출력이면 같은 파일 바이트가 나온다", async () => {
    const runOnce = async (): Promise<Uint8Array> => {
      const base = harness();
      const result = await startWebCodecsVideoExport({
        timeline: planConstantRateTimeline({ frameCount: 8, fps: 30, keyFrameIntervalSec: 0.1 }),
        config: CONFIG,
        webmCodecId: "V_VP9",
        deps: base.deps,
      }).done;
      return result.bytes;
    };
    expect(Array.from(await runOnce())).toEqual(Array.from(await runOnce()));
  });

  it("소스(주석 제외)에 벽시계·rAF가 없다 — 인코딩 속도가 출력에 영향을 주지 않는다", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(path.join(here, "studio-webcodecs-video-export.ts"), "utf-8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/Date\.now|performance\.now|Math\.random|requestAnimationFrame/);
  });

  it("파일명 규칙이 기존 내보내기와 나란하다", () => {
    expect(webCodecsVideoFileName("내 웹툰", "motion")).toBe("내 웹툰-motion.webm");
    expect(webCodecsVideoFileName("   ", "frames")).toBe("toonspectrum-frames.webm");
  });
});
