import { describe, expect, it } from "vitest";

import {
  STUDIO_PBR_BINDINGS,
  STUDIO_PBR_BLOOM_RESAMPLE_OFFSETS,
  STUDIO_PBR_BLOOM_THRESHOLD_OFFSETS,
  STUDIO_PBR_BRDF_LUT_OFFSETS,
  STUDIO_PBR_DEFERRED_SHADE_OFFSETS,
  STUDIO_PBR_KERNELS,
  STUDIO_PBR_PREFILTER_OFFSETS,
  STUDIO_PBR_SSAO_BLUR_OFFSETS,
  STUDIO_PBR_SSAO_OFFSETS,
  STUDIO_PBR_WGSL_BRDF,
  STUDIO_PBR_WORKGROUP_SIZE_2D,
  packStudioPbrBloomResampleParams,
  packStudioPbrBloomThresholdParams,
  packStudioPbrBrdfLutParams,
  packStudioPbrDeferredShadeParams,
  packStudioPbrPrefilterParams,
  packStudioPbrSsaoBlurParams,
  packStudioPbrSsaoParams,
  studioPbrDispatch2d,
  type StudioPbrKernelId,
} from "./studio-pbr-wgsl";

const KERNEL_IDS = Object.keys(STUDIO_PBR_KERNELS) as StudioPbrKernelId[];

/** WGSL 소스에서 `struct Params { ... }` 안의 필드 이름을 선언 순서대로 뽑는다. */
function paramsFieldOrder(wgsl: string): string[] {
  const match = /struct Params \{([\s\S]*?)\n\};/.exec(wgsl);
  if (!match) throw new Error("struct Params 를 찾지 못했다");
  return Array.from(match[1].matchAll(/^\s*([a-z_0-9]+)\s*:/gm), (m) => m[1]);
}

/** snake_case → camelCase (WGSL 필드명 ↔ TS 오프셋 키 대조용). */
function toCamel(name: string): string {
  return name.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

describe("studio-pbr-wgsl: 커널 카탈로그", () => {
  it("모든 커널이 8종이고 shaderId 가 고유하다", () => {
    expect(KERNEL_IDS).toEqual([
      "brdfLut",
      "prefilterSpecular",
      "ssao",
      "ssaoBlur",
      "bloomThreshold",
      "bloomDownsample",
      "bloomUpsample",
      "deferredShade",
    ]);
    const ids = KERNEL_IDS.map((id) => STUDIO_PBR_KERNELS[id].shaderId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("모든 커널의 엔트리포인트가 WGSL 에 실제로 선언돼 있다", () => {
    for (const id of KERNEL_IDS) {
      const kernel = STUDIO_PBR_KERNELS[id];
      expect(kernel.wgsl).toContain(`fn ${kernel.entryPoint}(`);
      expect(kernel.wgsl).toContain("@compute");
    }
  });

  it("WGSL @workgroup_size 리터럴이 TS 상수와 일치한다", () => {
    for (const id of KERNEL_IDS) {
      const wgsl = STUDIO_PBR_KERNELS[id].wgsl;
      const matches = Array.from(wgsl.matchAll(/@workgroup_size\((\d+),\s*(\d+)\)/g));
      expect(matches.length).toBe(1);
      expect(Number(matches[0][1])).toBe(STUDIO_PBR_WORKGROUP_SIZE_2D);
      expect(Number(matches[0][2])).toBe(STUDIO_PBR_WORKGROUP_SIZE_2D);
    }
  });

  it("WGSL @binding 인덱스가 BINDINGS 선언과 정확히 일치한다", () => {
    for (const id of KERNEL_IDS) {
      const kernel = STUDIO_PBR_KERNELS[id];
      const declared = new Set(kernel.bindings.map((name) => STUDIO_PBR_BINDINGS[name]));
      const inSource = new Set(
        Array.from(kernel.wgsl.matchAll(/@group\(0\) @binding\((\d+)\)/g), (m) => Number(m[1])),
      );
      expect(Array.from(inSource).sort()).toEqual(Array.from(declared).sort());
    }
  });

  it("BRDF 공용 텍스트가 필요한 커널에만 붙어 있다", () => {
    const marker = "fn studio_pbr_importance_sample_ggx";
    expect(STUDIO_PBR_WGSL_BRDF).toContain(marker);
    for (const id of ["brdfLut", "prefilterSpecular", "deferredShade"] as StudioPbrKernelId[]) {
      expect(STUDIO_PBR_KERNELS[id].wgsl).toContain(marker);
    }
    for (const id of ["ssao", "ssaoBlur", "bloomThreshold"] as StudioPbrKernelId[]) {
      expect(STUDIO_PBR_KERNELS[id].wgsl).not.toContain(marker);
    }
  });

  it("공용 BRDF 텍스트가 TS 코어와 같은 상수를 쓴다", () => {
    // 값이 갈리면 CPU/GPU 파리티가 원천적으로 불가능해진다.
    expect(STUDIO_PBR_WGSL_BRDF).toContain("STUDIO_PBR_MIN_ALPHA : f32 = 1e-4");
    expect(STUDIO_PBR_WGSL_BRDF).toContain("2.3283064365386963e-10"); // 2⁻³²
    expect(STUDIO_PBR_WGSL_BRDF).toContain("r * r / 2.0"); // IBL k 재매핑
    expect(STUDIO_PBR_WGSL_BRDF).toContain("k * k / 8.0"); // direct k 재매핑
  });
});

describe("studio-pbr-wgsl: uniform 레이아웃", () => {
  const cases: { id: StudioPbrKernelId; offsets: Record<string, number> }[] = [
    { id: "brdfLut", offsets: STUDIO_PBR_BRDF_LUT_OFFSETS },
    { id: "prefilterSpecular", offsets: STUDIO_PBR_PREFILTER_OFFSETS },
    { id: "ssao", offsets: STUDIO_PBR_SSAO_OFFSETS },
    { id: "ssaoBlur", offsets: STUDIO_PBR_SSAO_BLUR_OFFSETS },
    { id: "bloomThreshold", offsets: STUDIO_PBR_BLOOM_THRESHOLD_OFFSETS },
    { id: "bloomDownsample", offsets: STUDIO_PBR_BLOOM_RESAMPLE_OFFSETS },
  ];

  it.each(cases)("$id — WGSL 필드 선언 순서가 오프셋 오름차순과 일치한다", ({ id, offsets }) => {
    const fields = paramsFieldOrder(STUDIO_PBR_KERNELS[id].wgsl).filter((f) => !f.startsWith("pad"));
    const expected = Object.entries(offsets)
      .sort((a, b) => a[1] - b[1])
      .map(([key]) => key);
    expect(fields.map(toCamel)).toEqual(expected);
  });

  it("deferredShade 의 vec4 필드는 16B 정렬 경계에 놓인다(std140 규칙)", () => {
    expect(STUDIO_PBR_DEFERRED_SHADE_OFFSETS.lightDirection % 16).toBe(0);
    expect(STUDIO_PBR_DEFERRED_SHADE_OFFSETS.lightColor % 16).toBe(0);
    const fields = paramsFieldOrder(STUDIO_PBR_KERNELS.deferredShade.wgsl);
    expect(fields).toEqual(["width", "height", "pad0", "pad1", "light_direction", "light_color"]);
  });

  it("uniform 바이트 길이가 16의 배수다(WebGPU 정렬 요구)", () => {
    for (const id of KERNEL_IDS) {
      expect(STUDIO_PBR_KERNELS[id].uniformByteLength % 16).toBe(0);
    }
  });
});

describe("studio-pbr-wgsl: 패커", () => {
  it("brdfLut 패커가 선언한 오프셋에 값을 쓴다", () => {
    const view = new DataView(packStudioPbrBrdfLutParams(128, 64));
    expect(view.byteLength).toBe(STUDIO_PBR_KERNELS.brdfLut.uniformByteLength);
    expect(view.getUint32(STUDIO_PBR_BRDF_LUT_OFFSETS.size, true)).toBe(128);
    expect(view.getUint32(STUDIO_PBR_BRDF_LUT_OFFSETS.sampleCount, true)).toBe(64);
  });

  it("prefilter 패커가 u32/f32 를 오프셋대로 섞어 쓴다", () => {
    const view = new DataView(
      packStudioPbrPrefilterParams({
        srcWidth: 512,
        srcHeight: 256,
        dstWidth: 64,
        dstHeight: 32,
        roughness: 0.375,
        sampleCount: 32,
      }),
    );
    expect(view.getUint32(STUDIO_PBR_PREFILTER_OFFSETS.srcWidth, true)).toBe(512);
    expect(view.getUint32(STUDIO_PBR_PREFILTER_OFFSETS.srcHeight, true)).toBe(256);
    expect(view.getUint32(STUDIO_PBR_PREFILTER_OFFSETS.dstWidth, true)).toBe(64);
    expect(view.getUint32(STUDIO_PBR_PREFILTER_OFFSETS.dstHeight, true)).toBe(32);
    expect(view.getFloat32(STUDIO_PBR_PREFILTER_OFFSETS.roughness, true)).toBe(0.375);
    expect(view.getUint32(STUDIO_PBR_PREFILTER_OFFSETS.sampleCount, true)).toBe(32);
  });

  it("ssao 패커가 아홉 필드를 전부 정확한 자리에 쓴다", () => {
    const uniform = {
      width: 1920,
      height: 1080,
      sampleCount: 16,
      rotationSize: 4,
      radius: 0.5,
      bias: 0.25,
      intensity: 0.75,
      focalX: 1.5,
      focalY: 2.5,
    };
    const view = new DataView(packStudioPbrSsaoParams(uniform));
    expect(view.getUint32(STUDIO_PBR_SSAO_OFFSETS.width, true)).toBe(1920);
    expect(view.getUint32(STUDIO_PBR_SSAO_OFFSETS.height, true)).toBe(1080);
    expect(view.getUint32(STUDIO_PBR_SSAO_OFFSETS.sampleCount, true)).toBe(16);
    expect(view.getUint32(STUDIO_PBR_SSAO_OFFSETS.rotationSize, true)).toBe(4);
    expect(view.getFloat32(STUDIO_PBR_SSAO_OFFSETS.radius, true)).toBe(0.5);
    expect(view.getFloat32(STUDIO_PBR_SSAO_OFFSETS.bias, true)).toBe(0.25);
    expect(view.getFloat32(STUDIO_PBR_SSAO_OFFSETS.intensity, true)).toBe(0.75);
    expect(view.getFloat32(STUDIO_PBR_SSAO_OFFSETS.focalX, true)).toBe(1.5);
    expect(view.getFloat32(STUDIO_PBR_SSAO_OFFSETS.focalY, true)).toBe(2.5);
  });

  it("ssaoBlur 축 플래그가 0/1 로 구분된다", () => {
    const horizontal = new DataView(packStudioPbrSsaoBlurParams(64, 32, 2, 0));
    const vertical = new DataView(packStudioPbrSsaoBlurParams(64, 32, 2, 1));
    expect(horizontal.getUint32(STUDIO_PBR_SSAO_BLUR_OFFSETS.axis, true)).toBe(0);
    expect(vertical.getUint32(STUDIO_PBR_SSAO_BLUR_OFFSETS.axis, true)).toBe(1);
    expect(horizontal.getUint32(STUDIO_PBR_SSAO_BLUR_OFFSETS.radius, true)).toBe(2);
  });

  it("bloom 패커들이 f32/u32 를 섞지 않는다", () => {
    const threshold = new DataView(packStudioPbrBloomThresholdParams(16, 8, 1.25, 0.5));
    expect(threshold.getUint32(STUDIO_PBR_BLOOM_THRESHOLD_OFFSETS.width, true)).toBe(16);
    expect(threshold.getFloat32(STUDIO_PBR_BLOOM_THRESHOLD_OFFSETS.threshold, true)).toBe(1.25);
    expect(threshold.getFloat32(STUDIO_PBR_BLOOM_THRESHOLD_OFFSETS.knee, true)).toBe(0.5);
    const resample = new DataView(packStudioPbrBloomResampleParams(32, 16, 16, 8));
    expect(resample.getUint32(STUDIO_PBR_BLOOM_RESAMPLE_OFFSETS.srcWidth, true)).toBe(32);
    expect(resample.getUint32(STUDIO_PBR_BLOOM_RESAMPLE_OFFSETS.dstHeight, true)).toBe(8);
  });

  it("deferredShade 패커가 vec4 슬롯에 xyz 만 채운다", () => {
    const view = new DataView(
      packStudioPbrDeferredShadeParams({
        width: 100,
        height: 50,
        lightDirection: [0, -1, 0],
        lightColor: [1, 0.5, 0.25],
      }),
    );
    expect(view.getUint32(STUDIO_PBR_DEFERRED_SHADE_OFFSETS.width, true)).toBe(100);
    expect(view.getFloat32(STUDIO_PBR_DEFERRED_SHADE_OFFSETS.lightDirection + 4, true)).toBe(-1);
    expect(view.getFloat32(STUDIO_PBR_DEFERRED_SHADE_OFFSETS.lightColor + 8, true)).toBe(0.25);
    // w 성분은 건드리지 않으므로 0.
    expect(view.getFloat32(STUDIO_PBR_DEFERRED_SHADE_OFFSETS.lightColor + 12, true)).toBe(0);
  });

  it("모든 패커 출력 길이가 커널 선언과 일치한다", () => {
    const sizes: [StudioPbrKernelId, number][] = [
      ["brdfLut", packStudioPbrBrdfLutParams(8, 8).byteLength],
      [
        "prefilterSpecular",
        packStudioPbrPrefilterParams({
          srcWidth: 1,
          srcHeight: 1,
          dstWidth: 1,
          dstHeight: 1,
          roughness: 0,
          sampleCount: 1,
        }).byteLength,
      ],
      [
        "ssao",
        packStudioPbrSsaoParams({
          width: 1,
          height: 1,
          sampleCount: 1,
          rotationSize: 1,
          radius: 1,
          bias: 0,
          intensity: 1,
          focalX: 1,
          focalY: 1,
        }).byteLength,
      ],
      ["ssaoBlur", packStudioPbrSsaoBlurParams(1, 1, 1, 0).byteLength],
      ["bloomThreshold", packStudioPbrBloomThresholdParams(1, 1, 1, 0).byteLength],
      ["bloomDownsample", packStudioPbrBloomResampleParams(1, 1, 1, 1).byteLength],
      ["bloomUpsample", packStudioPbrBloomResampleParams(1, 1, 1, 1).byteLength],
      [
        "deferredShade",
        packStudioPbrDeferredShadeParams({
          width: 1,
          height: 1,
          lightDirection: [0, 0, 1],
          lightColor: [1, 1, 1],
        }).byteLength,
      ],
    ];
    for (const [id, byteLength] of sizes) {
      expect(byteLength).toBe(STUDIO_PBR_KERNELS[id].uniformByteLength);
    }
  });
});

describe("studio-pbr-wgsl: 디스패치 계산", () => {
  it("워크그룹 수가 올림 나눗셈이다", () => {
    expect(studioPbrDispatch2d(8, 8)).toEqual([1, 1]);
    expect(studioPbrDispatch2d(9, 8)).toEqual([2, 1]);
    expect(studioPbrDispatch2d(1920, 1080)).toEqual([240, 135]);
  });

  it("어떤 해상도든 전체 픽셀을 덮는다", () => {
    for (const [w, h] of [
      [1, 1],
      [7, 13],
      [64, 64],
      [1023, 511],
    ]) {
      const [gx, gy] = studioPbrDispatch2d(w, h);
      expect(gx * STUDIO_PBR_WORKGROUP_SIZE_2D).toBeGreaterThanOrEqual(w);
      expect(gy * STUDIO_PBR_WORKGROUP_SIZE_2D).toBeGreaterThanOrEqual(h);
      // 낭비가 워크그룹 하나 미만이어야 한다.
      expect((gx - 1) * STUDIO_PBR_WORKGROUP_SIZE_2D).toBeLessThan(w);
      expect((gy - 1) * STUDIO_PBR_WORKGROUP_SIZE_2D).toBeLessThan(h);
    }
  });
});
