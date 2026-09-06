import { describe, expect, it } from "vitest";

import { STUDIO_SMOKE_CPU_KERNELS, STUDIO_SMOKE_KERNEL_IDS, STUDIO_SMOKE_TRACE_PADDING } from "./studio-smoke-core";
import { STUDIO_SMOKE_CHIMNEY_BOUNDARY, createStudioSmokeGridSpec, packStudioSmokeBoundaryMask } from "./studio-smoke-grid";
import {
  STUDIO_SMOKE_DISPATCH_ROW_THREADS,
  STUDIO_SMOKE_KERNEL_BINDINGS,
  STUDIO_SMOKE_UNIFORM_BYTES,
  STUDIO_SMOKE_UNIFORM_OFFSETS,
  STUDIO_SMOKE_WGSL_KERNELS,
  STUDIO_SMOKE_WGSL_KERNEL_IDS,
  STUDIO_SMOKE_WGSL_TRACE_PADDING,
  STUDIO_SMOKE_WORKGROUP_SIZE,
  packStudioSmokeSolidMask,
  packStudioSmokeUniform,
  patchStudioSmokeThreadCount,
} from "./studio-smoke-wgsl";

import type { StudioSmokeKernelId, StudioSmokeStepParams } from "./studio-smoke-core";

const PARAMS: StudioSmokeStepParams = {
  dt: 1 / 30,
  buoyancyAlpha: 0.35,
  buoyancyBeta: 3.25,
  ambientTemperature: 0.5,
  vorticityEpsilon: 8,
  densityDissipation: 0.125,
  temperatureDissipation: 0.625,
  pressureIterations: 40,
};

const SPEC = createStudioSmokeGridSpec({ nx: 12, ny: 20, nz: 16, h: 0.5, boundary: STUDIO_SMOKE_CHIMNEY_BOUNDARY });

describe("studio-smoke-wgsl: CPU 레지스트리와의 드리프트 가드", () => {
  it("WGSL 커널 키 집합이 CPU 커널 id 집합과 정확히 같다", () => {
    expect(Object.keys(STUDIO_SMOKE_WGSL_KERNELS).sort()).toEqual([...STUDIO_SMOKE_KERNEL_IDS].sort());
    expect(Object.keys(STUDIO_SMOKE_CPU_KERNELS).sort()).toEqual(Object.keys(STUDIO_SMOKE_WGSL_KERNELS).sort());
    expect([...STUDIO_SMOKE_WGSL_KERNEL_IDS]).toEqual([...STUDIO_SMOKE_KERNEL_IDS].sort());
  });

  it("바인딩 표도 같은 키 집합을 덮는다", () => {
    expect(Object.keys(STUDIO_SMOKE_KERNEL_BINDINGS).sort()).toEqual([...STUDIO_SMOKE_KERNEL_IDS].sort());
  });

  it("shaderId 가 유일하다(파이프라인 캐시 충돌 방지)", () => {
    const ids = Object.values(STUDIO_SMOKE_WGSL_KERNELS).map((shader) => shader.shaderId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith("studio-smoke/")).toBe(true);
  });
});

describe("studio-smoke-wgsl: 셰이더 소스 구조", () => {
  const entries = Object.entries(STUDIO_SMOKE_WGSL_KERNELS) as [StudioSmokeKernelId, { wgsl: string; entryPoint: string }][];

  it("모든 커널이 선언한 entryPoint 함수를 실제로 정의한다", () => {
    for (const [id, shader] of entries) {
      expect(shader.entryPoint).toBe("main");
      expect(shader.wgsl).toContain(`fn ${shader.entryPoint}(`);
      expect(shader.wgsl, id).toContain("@compute");
    }
  });

  it("@workgroup_size 리터럴이 TS 상수와 일치한다", () => {
    for (const [id, shader] of entries) {
      const matches = [...shader.wgsl.matchAll(/@workgroup_size\((\d+)\)/g)];
      expect(matches.length, id).toBe(1);
      expect(Number(matches[0][1]), id).toBe(STUDIO_SMOKE_WORKGROUP_SIZE);
    }
  });

  it("디스패치 row-threads 리터럴이 TS 상수와 일치한다", () => {
    for (const [id, shader] of entries) {
      expect(shader.wgsl, id).toContain(`gid.y * ${STUDIO_SMOKE_DISPATCH_ROW_THREADS}u + gid.x`);
    }
  });

  it("@binding(n) 선언이 바인딩 표와 인덱스까지 정확히 대응한다", () => {
    for (const [id, shader] of entries) {
      const names = STUDIO_SMOKE_KERNEL_BINDINGS[id];
      const declared = [...shader.wgsl.matchAll(/@group\(0\) @binding\((\d+)\) var<[^>]+>\s*(\w+)\s*:/g)];
      expect(declared.length, id).toBe(names.length);
      for (const match of declared) {
        const index = Number(match[1]);
        const variable = match[2];
        // 0번은 uniform 이며 WGSL 변수명은 P(짧게), 나머지는 바인딩 표 이름 그대로.
        expect(index, `${id} binding ${index}`).toBeLessThan(names.length);
        expect(names[index], `${id} binding ${index} -> ${variable}`).toBe(index === 0 ? "params" : variable);
      }
      // 인덱스가 0..n-1 을 빠짐없이 덮는다.
      expect(declared.map((match) => Number(match[1])).sort((a, b) => a - b)).toEqual(
        names.map((_, index) => index),
      );
    }
  });

  it("0번 바인딩은 전부 uniform, 나머지는 storage 다", () => {
    for (const [id, shader] of entries) {
      expect(shader.wgsl, id).toContain("@group(0) @binding(0) var<uniform> P : SmokeParams;");
      const storage = [...shader.wgsl.matchAll(/@binding\((\d+)\) var<storage/g)].map((m) => Number(m[1]));
      expect(storage.includes(0), id).toBe(false);
    }
  });

  it("uniform struct 필드 순서가 TS 오프셋 표와 일치한다", () => {
    const expectedOrder = Object.entries(STUDIO_SMOKE_UNIFORM_OFFSETS)
      .sort((a, b) => a[1] - b[1])
      .map(([key]) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`));
    for (const [id, shader] of entries) {
      const struct = shader.wgsl.match(/struct SmokeParams \{([\s\S]*?)\n\}/);
      expect(struct, id).not.toBeNull();
      const fields = [...struct![1].matchAll(/^\s*(\w+)\s*:/gm)].map((match) => match[1]);
      expect(fields, id).toEqual(expectedOrder);
      // 4바이트 스칼라 16개 = 64바이트.
      expect(fields.length * 4).toBe(STUDIO_SMOKE_UNIFORM_BYTES);
    }
  });

  it("역추적 패딩 상수가 CPU 와 같고 WGSL 리터럴에도 박혀 있다", () => {
    expect(STUDIO_SMOKE_WGSL_TRACE_PADDING).toBe(STUDIO_SMOKE_TRACE_PADDING);
    expect(STUDIO_SMOKE_WGSL_KERNELS.advect_scalar.wgsl).toContain(
      `let pad = ${STUDIO_SMOKE_TRACE_PADDING}.0;`,
    );
  });

  it("경계 open 비트 순서가 CPU 마스크와 같다(WGSL smoke_is_open 인자)", () => {
    // yMax 는 비트 3 — 굴뚝 경계 마스크가 1<<3 이고 WGSL 도 3u 를 쓴다.
    expect(packStudioSmokeBoundaryMask(STUDIO_SMOKE_CHIMNEY_BOUNDARY)).toBe(1 << 3);
    expect(STUDIO_SMOKE_WGSL_KERNELS.subtract_gradient.wgsl).toContain("smoke_is_open(3u)");
    expect(STUDIO_SMOKE_WGSL_KERNELS.boundary.wgsl).toContain("smoke_is_open(5u)");
  });

  it("Jacobi 커널이 CPU 와 같은 수식을 쓴다(발산·이웃 수 나눗셈)", () => {
    const wgsl = STUDIO_SMOKE_WGSL_KERNELS.pressure_jacobi.wgsl;
    expect(wgsl).toContain("(sum - divergence[tid] * P.pressure_inv_scale) / count");
    expect(wgsl).toContain("if (count == 0.0) { dst[tid] = 0.0; return; }");
  });

  it("부력 커널이 CPU 와 같은 부호를 쓴다(−α·d + β·(T−ambient))", () => {
    expect(STUDIO_SMOKE_WGSL_KERNELS.buoyancy.wgsl).toContain(
      "-P.buoyancy_alpha * d + P.buoyancy_beta * (t - P.ambient_temperature)",
    );
  });
});

describe("studio-smoke-wgsl: uniform 패커", () => {
  it("64바이트를 문서화된 오프셋에 정확히 채운다", () => {
    const buffer = packStudioSmokeUniform(SPEC, PARAMS, 1234);
    expect(buffer.byteLength).toBe(STUDIO_SMOKE_UNIFORM_BYTES);
    const view = new DataView(buffer);
    const O = STUDIO_SMOKE_UNIFORM_OFFSETS;
    expect(view.getUint32(O.nx, true)).toBe(12);
    expect(view.getUint32(O.ny, true)).toBe(20);
    expect(view.getUint32(O.nz, true)).toBe(16);
    expect(view.getUint32(O.cellCount, true)).toBe(12 * 20 * 16);
    expect(view.getFloat32(O.dt, true)).toBeCloseTo(PARAMS.dt, 6);
    expect(view.getFloat32(O.h, true)).toBe(0.5);
    expect(view.getFloat32(O.invH, true)).toBe(2);
    expect(view.getUint32(O.threadCount, true)).toBe(1234);
    expect(view.getFloat32(O.buoyancyAlpha, true)).toBeCloseTo(PARAMS.buoyancyAlpha, 6);
    expect(view.getFloat32(O.buoyancyBeta, true)).toBe(3.25);
    expect(view.getFloat32(O.ambientTemperature, true)).toBe(0.5);
    expect(view.getFloat32(O.vorticityEpsilon, true)).toBe(8);
    expect(view.getFloat32(O.densityDissipation, true)).toBe(0.125);
    expect(view.getFloat32(O.temperatureDissipation, true)).toBe(0.625);
    expect(view.getUint32(O.boundaryOpen, true)).toBe(packStudioSmokeBoundaryMask(SPEC.boundary));
    expect(view.getFloat32(O.pressureInvScale, true)).toBeCloseTo((0.5 * 0.5) / PARAMS.dt, 5);
  });

  it("오프셋 표에 중복이 없고 64바이트 안에 딱 들어간다", () => {
    const offsets = Object.values(STUDIO_SMOKE_UNIFORM_OFFSETS);
    expect(new Set(offsets).size).toBe(offsets.length);
    expect(Math.max(...offsets) + 4).toBe(STUDIO_SMOKE_UNIFORM_BYTES);
    for (const offset of offsets) expect(offset % 4).toBe(0);
  });

  it("threadCount 만 갈아끼우면 나머지 바이트가 그대로다", () => {
    const buffer = packStudioSmokeUniform(SPEC, PARAMS, 10);
    const before = new Uint8Array(buffer.slice(0));
    patchStudioSmokeThreadCount(buffer, 99999);
    const after = new Uint8Array(buffer);
    expect(new DataView(buffer).getUint32(STUDIO_SMOKE_UNIFORM_OFFSETS.threadCount, true)).toBe(99999);
    for (let index = 0; index < before.length; index += 1) {
      if (index >= STUDIO_SMOKE_UNIFORM_OFFSETS.threadCount && index < STUDIO_SMOKE_UNIFORM_OFFSETS.threadCount + 4) {
        continue;
      }
      expect(after[index]).toBe(before[index]);
    }
  });

  it("음수·소수 threadCount 는 0 이상 정수로 정규화된다", () => {
    const negative = packStudioSmokeUniform(SPEC, PARAMS, -5);
    expect(new DataView(negative).getUint32(STUDIO_SMOKE_UNIFORM_OFFSETS.threadCount, true)).toBe(0);
    const fractional = packStudioSmokeUniform(SPEC, PARAMS, 7.9);
    expect(new DataView(fractional).getUint32(STUDIO_SMOKE_UNIFORM_OFFSETS.threadCount, true)).toBe(7);
  });

  it("패킹은 결정적이다 — 같은 입력이면 바이트 동일", () => {
    const a = new Uint8Array(packStudioSmokeUniform(SPEC, PARAMS, 512));
    const b = new Uint8Array(packStudioSmokeUniform(SPEC, PARAMS, 512));
    expect(b).toEqual(a);
  });
});

describe("studio-smoke-wgsl: solid 마스크 패킹", () => {
  it("Uint8 0/1 을 Uint32 0/1 로 옮기고 0 이 아닌 값은 전부 1 로 정규화한다", () => {
    const solid = Uint8Array.from([0, 1, 0, 255, 2]);
    expect(Array.from(packStudioSmokeSolidMask(solid))).toEqual([0, 1, 0, 1, 1]);
    expect(packStudioSmokeSolidMask(solid).byteLength).toBe(solid.length * 4);
  });
});
