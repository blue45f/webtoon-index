import { describe, expect, it } from "vitest";

import { STUDIO_GPU_FILTER_WORKGROUP_SIZE } from "./studio-gpu-filter-kernels";
import {
  STUDIO_GPU_CONVOLUTION_UNIFORM_BYTES,
  STUDIO_GPU_SPATIAL_FILTER_KERNELS,
  STUDIO_GPU_SPATIAL_UNIFORM_BYTES,
  packStudioGpuConvolutionParams,
  packStudioGpuGaussianResolveParams,
  packStudioGpuMorphologyParams,
  packStudioGpuSpatialParams,
  studioGpuGaussianBoxRadii,
} from "./studio-gpu-filter-spatial-kernels";

describe("studio-gpu-filter-spatial-kernels: WGSL 구조", () => {
  it("모든 커널이 bounded dispatch와 올바른 packed/float 바인딩을 선언한다", () => {
    for (const kernel of Object.values(STUDIO_GPU_SPATIAL_FILTER_KERNELS)) {
      expect(kernel.wgsl).toContain(`@compute @workgroup_size(${STUDIO_GPU_FILTER_WORKGROUP_SIZE})`);
      expect(kernel.wgsl).toContain("pixel_count : u32");
      expect(kernel.wgsl).toContain("if (i >= params.pixel_count) { return; }");
      expect(kernel.wgsl).toContain("@group(0) @binding(2) var<uniform> params : Params;");
      const opens = kernel.wgsl.split("{").length - 1;
      const closes = kernel.wgsl.split("}").length - 1;
      expect(closes, kernel.id).toBe(opens);

      if (kernel.bufferLayout === "gaussian-box") {
        expect(kernel.wgsl).toContain("@binding(0) var<storage, read> src : array<vec4<f32>>;");
        expect(kernel.wgsl).toContain("@binding(1) var<storage, read_write> dst : array<vec4<f32>>;");
      } else if (kernel.bufferLayout === "gaussian-decode") {
        expect(kernel.wgsl).toContain("@binding(0) var<storage, read> src : array<u32>;");
        expect(kernel.wgsl).toContain("@binding(1) var<storage, read_write> dst : array<vec4<f32>>;");
      } else {
        expect(kernel.wgsl).toContain("@binding(0) var<storage, read> src : array<u32>;");
        expect(kernel.wgsl).toContain("@binding(1) var<storage, read_write> dst : array<u32>;");
      }
    }
  });

  it("가우시안 resolve만 premultiplied float 보조 버퍼를 binding(3)으로 읽는다", () => {
    const resolve = STUDIO_GPU_SPATIAL_FILTER_KERNELS["gaussian-resolve"];
    expect(resolve.wgsl).toContain(
      "@group(0) @binding(3) var<storage, read> filtered : array<vec4<f32>>;",
    );
    expect(resolve.wgsl).toContain("blurred.w > 0.0001");
    expect(resolve.wgsl).toContain("original.w");
    for (const kernel of Object.values(STUDIO_GPU_SPATIAL_FILTER_KERNELS)) {
      expect(kernel.usesLut).toBe(false);
    }
  });
});

describe("studio-gpu-filter-spatial-kernels: 파라미터 계약", () => {
  it("CPU Gaussian three-box 반경과 같은 bounded 반경을 만든다", () => {
    expect(studioGpuGaussianBoxRadii(0)).toEqual([0, 0, 0]);
    expect(studioGpuGaussianBoxRadii(1)).toEqual([0, 0, 1]);
    expect(studioGpuGaussianBoxRadii(6)).toEqual([5, 5, 6]);
    expect(studioGpuGaussianBoxRadii(40)).toEqual([39, 39, 40]);
    expect(studioGpuGaussianBoxRadii(999)).toEqual([39, 39, 40]);
    expect(studioGpuGaussianBoxRadii(Number.NaN)).toEqual([0, 0, 0]);
  });

  it("공간 uniform은 16-byte 정렬 크기와 치수/방향/모드를 보존한다", () => {
    const uniform = packStudioGpuSpatialParams({
      width: 193,
      height: 127,
      radius: 4,
      direction: "vertical",
      mode: "erode",
    });
    expect(uniform.byteLength).toBe(STUDIO_GPU_SPATIAL_UNIFORM_BYTES);
    const view = new DataView(uniform);
    expect(view.getUint32(0, true)).toBe(0);
    expect(view.getUint32(4, true)).toBe(193);
    expect(view.getUint32(8, true)).toBe(127);
    expect(view.getUint32(12, true)).toBe(4);
    expect(view.getUint32(16, true)).toBe(1);
    expect(view.getUint32(20, true)).toBe(1);
  });

  it("morphology normalizer와 Gaussian strength clamp를 패커 경계에서 재적용한다", () => {
    const morphology = new DataView(packStudioGpuMorphologyParams(
      9,
      7,
      { mode: "dilate", radius: 99 },
      "horizontal",
    ));
    expect(morphology.getUint32(12, true)).toBe(4);
    expect(morphology.getUint32(16, true)).toBe(0);
    expect(morphology.getUint32(20, true)).toBe(0);

    expect(new DataView(packStudioGpuGaussianResolveParams(73)).getFloat32(4, true))
      .toBeCloseTo(0.73, 6);
    expect(new DataView(packStudioGpuGaussianResolveParams(999)).getFloat32(4, true)).toBe(1);
    expect(new DataView(packStudioGpuGaussianResolveParams(-10)).getFloat32(4, true)).toBe(0);
  });

  it("3×3 convolution 행·divisor·bias를 vec4 정렬 uniform에 싣는다", () => {
    const uniform = packStudioGpuConvolutionParams(11, 13, {
      kernel: [-1, -2, -3, -4, 8, -5, -6, -7, -8],
      divisor: 2,
      bias: 17,
    });
    expect(uniform.byteLength).toBe(STUDIO_GPU_CONVOLUTION_UNIFORM_BYTES);
    const view = new DataView(uniform);
    expect(view.getUint32(4, true)).toBe(11);
    expect(view.getUint32(8, true)).toBe(13);
    expect([
      view.getFloat32(16, true),
      view.getFloat32(20, true),
      view.getFloat32(24, true),
      view.getFloat32(32, true),
      view.getFloat32(36, true),
      view.getFloat32(40, true),
      view.getFloat32(48, true),
      view.getFloat32(52, true),
      view.getFloat32(56, true),
    ]).toEqual([-1, -2, -3, -4, 8, -5, -6, -7, -8]);
    expect(view.getFloat32(28, true)).toBe(2);
    expect(view.getFloat32(44, true)).toBe(17);
  });
});
