import { describe, expect, it } from "vitest";

import {
  STUDIO_WEBCODECS_CODECS,
  av1CodecString,
  buildVideoEncoderConfig,
  probeStudioVideoCodecs,
  recommendWebCodecsBitrate,
  selectExportPipeline,
  selectStudioVideoCodec,
  vp9CodecString,
  type StudioCodecProbeResult,
  type StudioVideoEncoderProbe,
} from "./studio-webcodecs-capability";

// ── 가짜 VideoEncoder 프로브 ────────────────────────────────────────────
//
// 실제 브라우저 구현처럼 (a) 코덱 문자열 접두사와 (b) hardwareAcceleration 요청을 함께 본다.
// "prefer-hardware"로 물었을 때만 true를 주는 코덱 = 해당 preference 설정이 수락되는 코덱이다.

interface FakeProbeRule {
  prefix: string;
  hardware: boolean;
  software: boolean;
  /** 이 픽셀 수를 넘으면 미지원(prefer-hardware 설정의 해상도 상한 흉내). */
  maxPixels?: number;
  /** true면 지원 여부 대신 예외를 던진다(일부 구현의 잘못된 코덱 문자열 처리). */
  throws?: boolean;
}

function fakeProbe(rules: readonly FakeProbeRule[]): {
  probe: StudioVideoEncoderProbe;
  calls: { codec: string; hardwareAcceleration?: string }[];
} {
  const calls: { codec: string; hardwareAcceleration?: string }[] = [];
  const probe: StudioVideoEncoderProbe = {
    isConfigSupported(config) {
      calls.push({ codec: config.codec, hardwareAcceleration: config.hardwareAcceleration });
      const rule = rules.find((candidate) => config.codec.startsWith(candidate.prefix));
      if (!rule) return Promise.resolve({ supported: false });
      if (rule.throws) return Promise.reject(new TypeError("unsupported codec string"));
      if (rule.maxPixels && (config.width ?? 0) * (config.height ?? 0) > rule.maxPixels) {
        return Promise.resolve({ supported: false });
      }
      const wantsHardware = config.hardwareAcceleration === "prefer-hardware";
      return Promise.resolve({ supported: wantsHardware ? rule.hardware : rule.software });
    },
  };
  return { probe, calls };
}

const REQUEST = { width: 1080, height: 1920, fps: 30 };

// ── 코덱 문자열 ─────────────────────────────────────────────────────────

describe("코덱 문자열", () => {
  it("VP9 레벨이 해상도·fps에서 결정된다", () => {
    expect(vp9CodecString(192, 144, 30)).toBe("vp09.00.10.08");
    expect(vp9CodecString(320, 240, 30)).toBe("vp09.00.20.08");
    expect(vp9CodecString(720, 1280, 30)).toBe("vp09.00.31.08");
    expect(vp9CodecString(1080, 1920, 30)).toBe("vp09.00.40.08");
    expect(vp9CodecString(1080, 1920, 60)).toBe("vp09.00.41.08");
    expect(vp9CodecString(3840, 2160, 60)).toBe("vp09.00.51.08");
  });

  it("AV1 문자열은 Main 프로필·Main 티어·8비트로 레벨만 바뀐다", () => {
    expect(av1CodecString(720, 1280, 30)).toBe("av01.0.05M.08");
    expect(av1CodecString(1080, 1920, 30)).toBe("av01.0.08M.08");
    expect(av1CodecString(3840, 2160, 60)).toBe("av01.0.13M.08");
  });

  it("VP8은 레벨 개념이 없어 고정 문자열이다", () => {
    const vp8 = STUDIO_WEBCODECS_CODECS.find((codec) => codec.id === "vp8")!;
    expect(vp8.codecString(1080, 1920, 30)).toBe("vp8");
    expect(vp8.webmCodecId).toBe("V_VP8");
  });

  it("코덱 후보의 WebM 매핑이 컨테이너가 아는 ID와 일치한다", () => {
    expect(STUDIO_WEBCODECS_CODECS.map((codec) => codec.webmCodecId).sort()).toEqual([
      "V_AV1",
      "V_VP8",
      "V_VP9",
    ]);
  });
});

describe("비트레이트 권장", () => {
  it("코덱 효율을 반영하고 2.5–16Mbps로 클램프한다", () => {
    expect(recommendWebCodecsBitrate(1080, 1920, 30, "vp8")).toBe(7_464_960);
    expect(recommendWebCodecsBitrate(1080, 1920, 30, "vp9")).toBe(5_225_472);
    expect(recommendWebCodecsBitrate(1080, 1920, 30, "av1")).toBe(4_105_728);
    expect(recommendWebCodecsBitrate(64, 64, 12, "vp9")).toBe(2_500_000); // 하한
    expect(recommendWebCodecsBitrate(3840, 2160, 60, "vp8")).toBe(16_000_000); // 상한
  });
});

describe("VideoEncoderConfig 조립", () => {
  it("해상도·fps를 정규화하고 화질 우선 설정을 넣는다", () => {
    const candidate = STUDIO_WEBCODECS_CODECS.find((codec) => codec.id === "vp9")!;
    const config = buildVideoEncoderConfig(candidate, { width: 719.4, height: 1280.2, fps: 29.6 });
    expect(config.width).toBe(719);
    expect(config.height).toBe(1280);
    expect(config.framerate).toBe(30);
    expect(config.codec).toBe("vp09.00.31.08");
    expect(config.latencyMode).toBe("quality");
    expect(config.hardwareAcceleration).toBe("no-preference");
    expect(config.bitrate).toBe(recommendWebCodecsBitrate(719, 1280, 30, "vp9"));
  });

  it("명시 비트레이트가 있으면 권장값을 덮어쓴다", () => {
    const candidate = STUDIO_WEBCODECS_CODECS.find((codec) => codec.id === "av1")!;
    const config = buildVideoEncoderConfig(candidate, { ...REQUEST, bitrate: 1_234_567 }, "prefer-hardware");
    expect(config.bitrate).toBe(1_234_567);
    expect(config.hardwareAcceleration).toBe("prefer-hardware");
  });
});

// ── 탐지 ────────────────────────────────────────────────────────────────

describe("코덱 탐지", () => {
  it("하드웨어 패스를 먼저 돌고, 이미 붙은 코덱은 소프트웨어로 다시 묻지 않는다", async () => {
    const { probe, calls } = fakeProbe([
      { prefix: "vp09", hardware: true, software: true },
      { prefix: "av01", hardware: false, software: true },
      { prefix: "vp8", hardware: false, software: true },
    ]);
    const results = await probeStudioVideoCodecs(REQUEST, probe);
    expect(results.map((result) => `${result.id}:${result.hardwarePreferenceAccepted}`)).toEqual([
      "vp9:true", // prefer-hardware 패스에서 확정
      "vp8:false", // no-preference 패스 — softwareRank 순
      "av1:false",
    ]);
    // vp9는 하드웨어에서 이미 확정됐으므로 소프트웨어 패스에서 재질의하지 않는다.
    const softwareVp9 = calls.filter(
      (call) => call.codec.startsWith("vp09") && call.hardwareAcceleration === "no-preference"
    );
    expect(softwareVp9).toHaveLength(0);
  });

  it("하드웨어 후보가 있으면 hardwareRank(AV1 > VP9 > VP8) 순으로 고른다", async () => {
    const { probe } = fakeProbe([
      { prefix: "av01", hardware: true, software: true },
      { prefix: "vp09", hardware: true, software: true },
    ]);
    const selected = await selectStudioVideoCodec(REQUEST, probe);
    expect(selected?.id).toBe("av1");
    expect(selected?.hardwarePreferenceAccepted).toBe(true);
    expect(selected?.webmCodecId).toBe("V_AV1");
  });

  it("전부 소프트웨어면 속도 순(VP9 > VP8 > AV1)으로 고른다 — AV1 SW 인코딩은 느리다", async () => {
    const { probe } = fakeProbe([
      { prefix: "av01", hardware: false, software: true },
      { prefix: "vp09", hardware: false, software: true },
      { prefix: "vp8", hardware: false, software: true },
    ]);
    const selected = await selectStudioVideoCodec(REQUEST, probe);
    expect(selected?.id).toBe("vp9");
    expect(selected?.hardwarePreferenceAccepted).toBe(false);
  });

  it("prefer-hardware 설정 상한을 넘으면 no-preference 후보만 남긴다", async () => {
    const { probe } = fakeProbe([
      { prefix: "vp09", hardware: true, software: true, maxPixels: 1920 * 1080 },
    ]);
    const uhd = await selectStudioVideoCodec({ width: 3840, height: 2160, fps: 30 }, probe);
    expect(uhd).toBeNull(); // 해상도 상한을 소프트웨어 패스에서도 동일 적용한 가짜 규칙
    const hd = await selectStudioVideoCodec({ width: 1920, height: 1080, fps: 30 }, probe);
    expect(hd?.id).toBe("vp9");
  });

  it("isConfigSupported가 던지는 예외는 '미지원'으로 흡수한다", async () => {
    const { probe } = fakeProbe([
      { prefix: "av01", hardware: false, software: false, throws: true },
      { prefix: "vp8", hardware: false, software: true },
    ]);
    const selected = await selectStudioVideoCodec(REQUEST, probe);
    expect(selected?.id).toBe("vp8");
  });

  it("지원 코덱이 없거나 프로브 자체가 없으면 null이다(예외 아님)", async () => {
    const { probe } = fakeProbe([]);
    await expect(selectStudioVideoCodec(REQUEST, probe)).resolves.toBeNull();
    await expect(selectStudioVideoCodec(REQUEST, null)).resolves.toBeNull();
  });

  it("codecIds로 탐지 대상을 제한할 수 있다", async () => {
    const { probe, calls } = fakeProbe([
      { prefix: "vp09", hardware: true, software: true },
      { prefix: "av01", hardware: true, software: true },
    ]);
    const selected = await selectStudioVideoCodec({ ...REQUEST, codecIds: ["vp9"] }, probe);
    expect(selected?.id).toBe("vp9");
    expect(calls.every((call) => call.codec.startsWith("vp09"))).toBe(true);
  });
});

// ── exact 파이프라인 계약 ───────────────────────────────────────────────

const WEBCODECS_CODEC: StudioCodecProbeResult = {
  id: "vp9",
  label: "VP9",
  codecString: "vp09.00.40.08",
  webmCodecId: "V_VP9",
  bitrate: 5_000_000,
  hardwarePreferenceAccepted: true,
};

describe("exact 파이프라인 계약", () => {
  it("선택한 WebCodecs가 되면 그 경로만 승인한다", () => {
    const decision = selectExportPipeline({
      selectedPipeline: "webcodecs-webm",
      webCodecsCodec: WEBCODECS_CODEC,
      mediaRecorderSupported: true,
      pureEncoderSupported: true,
    });
    expect(decision.pipeline).toBe("webcodecs-webm");
    expect(decision.available).toBe(true);
    expect(decision.codec?.id).toBe("vp9");
    expect(decision.reason).toContain("prefer-hardware");
  });

  it("선택한 WebCodecs가 없으면 다른 사용 가능 provider로 전환하지 않는다", () => {
    const decision = selectExportPipeline({
      selectedPipeline: "webcodecs-webm",
      webCodecsCodec: null,
      mediaRecorderSupported: true,
      pureEncoderSupported: true,
    });
    expect(decision.pipeline).toBe("webcodecs-webm");
    expect(decision.available).toBe(false);
    expect(decision.reason).toContain("전환하지 않았어요");
  });

  it("GIF와 APNG도 호출자가 각각 명시한 경우에만 판정한다", () => {
    const gif = selectExportPipeline({
      selectedPipeline: "gif",
      webCodecsCodec: null,
      mediaRecorderSupported: false,
      pureEncoderSupported: true,
    });
    expect(gif.pipeline).toBe("gif");
    expect(gif.available).toBe(true);

    const apng = selectExportPipeline({
      selectedPipeline: "apng",
      webCodecsCodec: null,
      mediaRecorderSupported: false,
      pureEncoderSupported: true,
    });
    expect(apng.pipeline).toBe("apng");
    expect(apng.reason).toContain("APNG");
  });

  it("선택한 경로가 없으면 available=false 결정을 돌려준다", () => {
    const decision = selectExportPipeline({
      selectedPipeline: "mediarecorder-webm",
      webCodecsCodec: null,
      mediaRecorderSupported: false,
      pureEncoderSupported: false,
    });
    expect(decision.available).toBe(false);
    expect(decision.pipeline).toBe("mediarecorder-webm");
    expect(decision.reason).toContain("전환하지 않았어요");
  });

  it("킬스위치가 켜진 선택 WebCodecs는 unavailable이며 다른 경로를 쓰지 않는다", () => {
    const decision = selectExportPipeline({
      selectedPipeline: "webcodecs-webm",
      webCodecsCodec: WEBCODECS_CODEC,
      mediaRecorderSupported: true,
      pureEncoderSupported: true,
      disableWebCodecs: true,
    });
    expect(decision.pipeline).toBe("webcodecs-webm");
    expect(decision.available).toBe(false);
    expect(decision.reason).toContain("비활성화");
  });
});
