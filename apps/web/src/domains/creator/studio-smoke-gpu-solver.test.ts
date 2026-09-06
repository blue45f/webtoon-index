import { describe, expect, it, vi } from "vitest";

import { STUDIO_SMOKE_KERNEL_IDS } from "./studio-smoke-core";
import {
  STUDIO_SMOKE_FIELD_BUFFER_IDS,
  encodeStudioSmokeGpuStep,
  planStudioSmokeGpuStep,
  studioSmokeBufferByteLength,
  studioSmokeDispatchCounts,
  studioSmokeKernelBindingNames,
} from "./studio-smoke-gpu-solver";
import {
  STUDIO_SMOKE_CHIMNEY_BOUNDARY,
  STUDIO_SMOKE_CLOSED_BOUNDARY,
  createStudioSmokeGridSpec,
  studioSmokeCellCount,
  studioSmokeUCount,
  studioSmokeVCount,
  studioSmokeWCount,
} from "./studio-smoke-grid";
import {
  STUDIO_SMOKE_DISPATCH_ROW_THREADS,
  STUDIO_SMOKE_KERNEL_BINDINGS,
  STUDIO_SMOKE_WORKGROUP_SIZE,
} from "./studio-smoke-wgsl";

import type { StudioSmokeStepParams } from "./studio-smoke-core";
import type { StudioSmokeGpuRuntime } from "./studio-smoke-gpu-runtime";
import type {
  StudioSmokeFieldBufferId,
  StudioSmokeGpuDispatchOp,
  StudioSmokeGpuResources,
  StudioSmokeGpuStepPlan,
} from "./studio-smoke-gpu-solver";

const SPEC = createStudioSmokeGridSpec({ nx: 16, ny: 24, nz: 12, h: 1, boundary: STUDIO_SMOKE_CHIMNEY_BOUNDARY });

const PARAMS: StudioSmokeStepParams = {
  dt: 1 / 30,
  buoyancyAlpha: 0.3,
  buoyancyBeta: 3,
  ambientTemperature: 0,
  vorticityEpsilon: 8,
  densityDissipation: 0.1,
  temperatureDissipation: 0.5,
  pressureIterations: 40,
};

function dispatches(plan: StudioSmokeGpuStepPlan): StudioSmokeGpuDispatchOp[] {
  return plan.ops.filter((op): op is StudioSmokeGpuDispatchOp => op.kind === "dispatch");
}

describe("studio-smoke-gpu-solver: 디스패치 좌표계", () => {
  it("x 는 항상 ROW_THREADS/WORKGROUP_SIZE 이고 y 가 스레드 수를 덮는다", () => {
    const expectedX = STUDIO_SMOKE_DISPATCH_ROW_THREADS / STUDIO_SMOKE_WORKGROUP_SIZE;
    for (const threads of [1, 63, 64, 16384, 16385, 262144, 2097152]) {
      const counts = studioSmokeDispatchCounts(threads);
      expect(counts.x).toBe(expectedX);
      expect(counts.y).toBeGreaterThanOrEqual(1);
      // 실제 커버리지: x*WORKGROUP_SIZE*y ≥ threads
      expect(counts.x * STUDIO_SMOKE_WORKGROUP_SIZE * counts.y).toBeGreaterThanOrEqual(threads);
      // 낭비는 한 행 미만이다.
      expect((counts.y - 1) * STUDIO_SMOKE_DISPATCH_ROW_THREADS).toBeLessThan(threads);
    }
  });

  it("최대 해상도(128³)에서도 maxComputeWorkgroupsPerDimension(65535) 안에 든다", () => {
    const spec = createStudioSmokeGridSpec({ nx: 128, ny: 128, nz: 128, allowOffline: true });
    const plan = planStudioSmokeGpuStep(spec, PARAMS);
    for (const op of dispatches(plan)) {
      expect(op.dispatchX).toBeLessThanOrEqual(65535);
      expect(op.dispatchY).toBeLessThanOrEqual(65535);
    }
  });
});

describe("studio-smoke-gpu-solver: 버퍼 크기", () => {
  it("면 버퍼는 축마다 +1 층, 셀 버퍼는 셀 수 × 4바이트", () => {
    expect(studioSmokeBufferByteLength(SPEC, "u")).toBe(studioSmokeUCount(SPEC) * 4);
    expect(studioSmokeBufferByteLength(SPEC, "u0")).toBe(studioSmokeUCount(SPEC) * 4);
    expect(studioSmokeBufferByteLength(SPEC, "v")).toBe(studioSmokeVCount(SPEC) * 4);
    expect(studioSmokeBufferByteLength(SPEC, "w")).toBe(studioSmokeWCount(SPEC) * 4);
    expect(studioSmokeBufferByteLength(SPEC, "density")).toBe(studioSmokeCellCount(SPEC) * 4);
    // solid 는 WGSL storage 제약 때문에 u32 라 셀당 4바이트다(Uint8 아님).
    expect(studioSmokeBufferByteLength(SPEC, "solid")).toBe(studioSmokeCellCount(SPEC) * 4);
  });
});

describe("studio-smoke-gpu-solver: 스텝 계획", () => {
  const plan = planStudioSmokeGpuStep(SPEC, PARAMS);

  it("순수 함수다 — 같은 입력이면 깊은 값이 동일하다", () => {
    expect(planStudioSmokeGpuStep(SPEC, PARAMS)).toEqual(plan);
  });

  it("커널 순서가 CPU 스텝 순서를 그대로 따른다", () => {
    const order = dispatches(plan).map((op) => op.kernelId);
    expect(order).toEqual([
      "advect_velocity",
      "advect_scalar",
      "advect_scalar",
      "dissipate",
      "buoyancy",
      "curl",
      "vorticity_force",
      "vorticity_apply",
      "boundary",
      "divergence",
      ...Array.from({ length: 40 }, () => "pressure_jacobi" as const),
      "subtract_gradient",
      "boundary",
    ]);
  });

  it("계획이 쓰는 커널은 전부 정규 커널 목록 안에 있다", () => {
    for (const op of dispatches(plan)) {
      expect(STUDIO_SMOKE_KERNEL_IDS).toContain(op.kernelId);
    }
  });

  it("각 dispatch 의 바인딩 수·0번 슬롯이 커널 바인딩 표와 맞는다", () => {
    for (const op of dispatches(plan)) {
      const names = STUDIO_SMOKE_KERNEL_BINDINGS[op.kernelId];
      expect(op.bindings.length).toBe(names.length);
      expect(op.bindings[0]).toBe("params");
      for (let index = 1; index < names.length; index += 1) {
        const name = names[index];
        const bound = op.bindings[index];
        expect(bound).not.toBe("params");
        // 일반 슬롯(src/dst)이 아니면 이름이 그대로 버퍼 id 여야 한다.
        if (name !== "src" && name !== "dst") expect(bound).toBe(name);
        expect(STUDIO_SMOKE_FIELD_BUFFER_IDS).toContain(bound as StudioSmokeFieldBufferId);
      }
    }
  });

  it("어떤 dispatch 도 같은 버퍼를 src 와 dst 로 동시에 쓰지 않는다(ping-pong 무결)", () => {
    for (const op of dispatches(plan)) {
      const names = STUDIO_SMOKE_KERNEL_BINDINGS[op.kernelId];
      const srcIndex = names.indexOf("src");
      const dstIndex = names.indexOf("dst");
      if (srcIndex < 0 || dstIndex < 0) continue;
      expect(op.bindings[srcIndex]).not.toBe(op.bindings[dstIndex]);
    }
  });

  it("Jacobi 패스가 pressure ↔ pressure0 로 정확히 번갈아 간다", () => {
    const jacobi = dispatches(plan).filter((op) => op.kernelId === "pressure_jacobi");
    expect(jacobi.length).toBe(40);
    for (let index = 0; index < jacobi.length; index += 1) {
      const expectedSrc = index % 2 === 0 ? "pressure0" : "pressure";
      const expectedDst = index % 2 === 0 ? "pressure" : "pressure0";
      expect(jacobi[index].bindings[3]).toBe(expectedSrc);
      expect(jacobi[index].bindings[4]).toBe(expectedDst);
    }
  });

  it("반복수 패리티에 따라 최종 압력 버퍼가 정해지고, 짝수면 복사가 붙는다", () => {
    const odd = planStudioSmokeGpuStep(SPEC, { ...PARAMS, pressureIterations: 41 });
    expect(odd.pressureResultBuffer).toBe("pressure");
    expect(odd.ops.some((op) => op.kind === "copy" && op.from === "pressure0" && op.to === "pressure")).toBe(
      false,
    );
    const even = planStudioSmokeGpuStep(SPEC, { ...PARAMS, pressureIterations: 40 });
    expect(even.pressureResultBuffer).toBe("pressure0");
    expect(even.ops.some((op) => op.kind === "copy" && op.from === "pressure0" && op.to === "pressure")).toBe(
      true,
    );
    // subtract_gradient 는 항상 "pressure" 를 읽는다.
    const gradient = dispatches(even).find((op) => op.kernelId === "subtract_gradient")!;
    expect(gradient.bindings[2]).toBe("pressure");
  });

  it("반복수를 바꾸면 Jacobi 패스 수가 정확히 따라간다", () => {
    for (const iterations of [0, 1, 7, 120]) {
      const custom = planStudioSmokeGpuStep(SPEC, { ...PARAMS, pressureIterations: iterations });
      expect(custom.pressureIterations).toBe(iterations);
      expect(dispatches(custom).filter((op) => op.kernelId === "pressure_jacobi").length).toBe(iterations);
    }
    // 소수/음수는 정규화된다.
    expect(planStudioSmokeGpuStep(SPEC, { ...PARAMS, pressureIterations: -5 }).pressureIterations).toBe(0);
    expect(planStudioSmokeGpuStep(SPEC, { ...PARAMS, pressureIterations: 3.9 }).pressureIterations).toBe(3);
  });

  it("ε=0 이면 와도 관련 패스가 통째로 빠진다", () => {
    const noVorticity = planStudioSmokeGpuStep(SPEC, { ...PARAMS, vorticityEpsilon: 0 });
    const kernels = dispatches(noVorticity).map((op) => op.kernelId);
    expect(kernels).not.toContain("curl");
    expect(kernels).not.toContain("vorticity_force");
    expect(kernels).not.toContain("vorticity_apply");
    expect(dispatches(noVorticity).length).toBe(dispatches(plan).length - 3);
  });

  it("스레드 수가 커널 성격과 맞는다(셀/면/합산 공간)", () => {
    const cells = studioSmokeCellCount(SPEC);
    const faces = studioSmokeUCount(SPEC) + studioSmokeVCount(SPEC) + studioSmokeWCount(SPEC);
    const byKernel = new Map(dispatches(plan).map((op) => [op.kernelId, op.threadCount]));
    expect(byKernel.get("advect_scalar")).toBe(cells);
    expect(byKernel.get("dissipate")).toBe(cells);
    expect(byKernel.get("divergence")).toBe(cells);
    expect(byKernel.get("pressure_jacobi")).toBe(cells);
    expect(byKernel.get("curl")).toBe(cells);
    expect(byKernel.get("vorticity_force")).toBe(cells);
    expect(byKernel.get("buoyancy")).toBe(studioSmokeVCount(SPEC));
    expect(byKernel.get("advect_velocity")).toBe(faces);
    expect(byKernel.get("vorticity_apply")).toBe(faces);
    expect(byKernel.get("subtract_gradient")).toBe(faces);
    expect(byKernel.get("boundary")).toBe(cells + faces);
  });

  it("copy/clear 연산이 CPU 의 set()/fill(0) 을 그대로 반영한다", () => {
    const copies = plan.ops.filter((op) => op.kind === "copy");
    const clears = plan.ops.filter((op) => op.kind === "clear");
    expect(copies.map((op) => (op.kind === "copy" ? `${op.from}->${op.to}` : ""))).toEqual([
      "u->u0",
      "v->v0",
      "w->w0",
      "density->density0",
      "temperature->temperature0",
      "pressure0->pressure",
    ]);
    expect(clears.map((op) => (op.kind === "clear" ? op.target : ""))).toEqual(["pressure", "pressure0"]);
    for (const op of copies) {
      if (op.kind !== "copy") continue;
      expect(op.byteLength).toBe(studioSmokeBufferByteLength(SPEC, op.from));
      expect(op.byteLength).toBe(studioSmokeBufferByteLength(SPEC, op.to));
    }
  });

  it("uniformThreadCounts 가 실제로 등장하는 스레드 수 집합과 같다(오름차순·중복 없음)", () => {
    const used = new Set(dispatches(plan).map((op) => op.threadCount));
    expect(plan.uniformThreadCounts.length).toBe(used.size);
    expect([...plan.uniformThreadCounts]).toEqual([...used].sort((a, b) => a - b));
  });

  it("평균 압력 차감 생략 플래그가 Dirichlet 유무를 따른다", () => {
    expect(planStudioSmokeGpuStep(SPEC, PARAMS).meanPressureSubtractionSkipped).toBe(false);
    const closed = createStudioSmokeGridSpec({ nx: 8, ny: 8, nz: 8, boundary: STUDIO_SMOKE_CLOSED_BOUNDARY });
    expect(planStudioSmokeGpuStep(closed, PARAMS).meanPressureSubtractionSkipped).toBe(true);
  });

  it("바인딩 이름 조회는 WGSL 표를 그대로 노출한다", () => {
    for (const id of STUDIO_SMOKE_KERNEL_IDS) {
      expect(studioSmokeKernelBindingNames(id)).toBe(STUDIO_SMOKE_KERNEL_BINDINGS[id]);
    }
  });
});

// ---------------------------------------------------------------------------
// 실행부 — 가짜 디바이스로 인코딩 동작을 검증(WebGPU 없이)
// ---------------------------------------------------------------------------

interface EncodeHarness {
  readonly runtime: StudioSmokeGpuRuntime;
  readonly resources: StudioSmokeGpuResources;
  readonly dispatchWorkgroups: ReturnType<typeof vi.fn>;
  readonly beginComputePass: ReturnType<typeof vi.fn>;
  readonly copyBufferToBuffer: ReturnType<typeof vi.fn>;
  readonly clearBuffer: ReturnType<typeof vi.fn>;
  readonly submit: ReturnType<typeof vi.fn>;
  readonly createBindGroup: ReturnType<typeof vi.fn>;
  readonly getComputePipeline: ReturnType<typeof vi.fn>;
}

function createEncodeHarness(plan: StudioSmokeGpuStepPlan, lost = false): EncodeHarness {
  const dispatchWorkgroups = vi.fn();
  const copyBufferToBuffer = vi.fn();
  const clearBuffer = vi.fn();
  const submit = vi.fn();
  const createBindGroup = vi.fn(() => ({}) as GPUBindGroup);
  const beginComputePass = vi.fn(() => ({
    setPipeline: vi.fn(),
    setBindGroup: vi.fn(),
    dispatchWorkgroups,
    end: vi.fn(),
  }));
  const getComputePipeline = vi.fn(() => ({ getBindGroupLayout: vi.fn(() => ({}) as GPUBindGroupLayout) }));
  const runtime = {
    lost,
    device: {
      createCommandEncoder: vi.fn(() => ({
        copyBufferToBuffer,
        clearBuffer,
        beginComputePass,
        finish: vi.fn(() => ({}) as GPUCommandBuffer),
      })),
      createBindGroup,
      queue: { submit },
    },
    getComputePipeline,
  } as unknown as StudioSmokeGpuRuntime;

  const buffers: Partial<Record<StudioSmokeFieldBufferId, GPUBuffer>> = {};
  for (const id of STUDIO_SMOKE_FIELD_BUFFER_IDS) buffers[id] = { label: id } as unknown as GPUBuffer;
  const uniforms = new Map<number, GPUBuffer>();
  for (const threadCount of plan.uniformThreadCounts) {
    uniforms.set(threadCount, { label: `uniform-${threadCount}` } as unknown as GPUBuffer);
  }
  return {
    runtime,
    resources: { buffers, uniforms },
    dispatchWorkgroups,
    beginComputePass,
    copyBufferToBuffer,
    clearBuffer,
    submit,
    createBindGroup,
    getComputePipeline,
  };
}

describe("studio-smoke-gpu-solver: 실행부(주입 seam)", () => {
  const plan = planStudioSmokeGpuStep(SPEC, PARAMS);

  it("계획의 모든 연산을 인코딩하고 한 번 제출한다", () => {
    const harness = createEncodeHarness(plan);
    const result = encodeStudioSmokeGpuStep(harness.runtime, plan, harness.resources);
    expect(result).not.toBeNull();
    expect(result!.dispatches).toBe(dispatches(plan).length);
    expect(result!.copies).toBe(plan.ops.filter((op) => op.kind === "copy").length);
    expect(result!.clears).toBe(plan.ops.filter((op) => op.kind === "clear").length);
    expect(harness.copyBufferToBuffer).toHaveBeenCalledTimes(result!.copies);
    expect(harness.clearBuffer).toHaveBeenCalledTimes(result!.clears);
    expect(harness.dispatchWorkgroups).toHaveBeenCalledTimes(result!.dispatches);
    expect(harness.submit).toHaveBeenCalledTimes(1);
  });

  it("연속된 dispatch 는 하나의 compute pass 로 묶고 copy/clear 에서만 끊는다", () => {
    const harness = createEncodeHarness(plan);
    const result = encodeStudioSmokeGpuStep(harness.runtime, plan, harness.resources);
    // copy/clear 로 잘린 dispatch 구간 수를 계획에서 직접 센다.
    let expectedPasses = 0;
    let inRun = false;
    for (const op of plan.ops) {
      if (op.kind === "dispatch") {
        if (!inRun) {
          expectedPasses += 1;
          inRun = true;
        }
      } else {
        inRun = false;
      }
    }
    expect(result!.computePasses).toBe(expectedPasses);
    expect(harness.beginComputePass).toHaveBeenCalledTimes(expectedPasses);
    expect(expectedPasses).toBeLessThan(dispatches(plan).length);
  });

  it("dispatchWorkgroups 인자가 계획의 (x,y) 와 정확히 같다", () => {
    const harness = createEncodeHarness(plan);
    encodeStudioSmokeGpuStep(harness.runtime, plan, harness.resources);
    const expected = dispatches(plan).map((op) => [op.dispatchX, op.dispatchY]);
    expect(harness.dispatchWorkgroups.mock.calls).toEqual(expected);
  });

  it("bind group entries 가 binding 인덱스 순서대로 계획의 버퍼를 가리킨다", () => {
    const harness = createEncodeHarness(plan);
    encodeStudioSmokeGpuStep(harness.runtime, plan, harness.resources);
    const ops = dispatches(plan);
    expect(harness.createBindGroup.mock.calls.length).toBe(ops.length);
    for (let index = 0; index < ops.length; index += 1) {
      const descriptor = harness.createBindGroup.mock.calls[index][0] as {
        entries: { binding: number; resource: { buffer: { label: string } } }[];
      };
      expect(descriptor.entries.length).toBe(ops[index].bindings.length);
      for (let slot = 0; slot < descriptor.entries.length; slot += 1) {
        expect(descriptor.entries[slot].binding).toBe(slot);
        const expectedLabel =
          ops[index].bindings[slot] === "params"
            ? `uniform-${ops[index].threadCount}`
            : ops[index].bindings[slot];
        expect(descriptor.entries[slot].resource.buffer.label).toBe(expectedLabel);
      }
    }
  });

  it("lost 런타임이면 아무것도 인코딩하지 않고 null(=CPU 폴백)", () => {
    const harness = createEncodeHarness(plan, true);
    expect(encodeStudioSmokeGpuStep(harness.runtime, plan, harness.resources)).toBeNull();
    expect(harness.submit).not.toHaveBeenCalled();
  });

  it("버퍼가 하나라도 없으면 인코딩 전에 null 을 돌려준다(부분 실행 없음)", () => {
    const harness = createEncodeHarness(plan);
    const broken: StudioSmokeGpuResources = {
      buffers: { ...harness.resources.buffers, curlY: undefined },
      uniforms: harness.resources.uniforms,
    };
    expect(encodeStudioSmokeGpuStep(harness.runtime, plan, broken)).toBeNull();
    expect(harness.submit).not.toHaveBeenCalled();
    expect(harness.dispatchWorkgroups).not.toHaveBeenCalled();
  });

  it("uniform 버퍼가 빠져도 null 이다", () => {
    const harness = createEncodeHarness(plan);
    const missing = new Map(harness.resources.uniforms);
    missing.delete(plan.uniformThreadCounts[0]);
    expect(
      encodeStudioSmokeGpuStep(harness.runtime, plan, { buffers: harness.resources.buffers, uniforms: missing }),
    ).toBeNull();
    expect(harness.submit).not.toHaveBeenCalled();
  });

  it("인코딩 중 예외는 밖으로 흘리지 않고 null 로 강등한다", () => {
    const harness = createEncodeHarness(plan);
    harness.getComputePipeline.mockImplementationOnce(() => {
      throw new Error("shader compile failed");
    });
    expect(encodeStudioSmokeGpuStep(harness.runtime, plan, harness.resources)).toBeNull();
    expect(harness.submit).not.toHaveBeenCalled();
  });
});
