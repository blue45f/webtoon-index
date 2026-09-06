/**
 * Studio Smoke GPU Solver — 한 스텝의 **디스패치 계획**(순수 데이터)과 그 실행부
 *
 * ## 왜 계획을 데이터로 뽑는가
 * WebGPU 가 없는 node 에서도 "커널 순서 · 스레드 수 · 디스패치 크기 · 버퍼 ping-pong 배정"
 * 을 전부 검증할 수 있게 하기 위해서다. `planStudioSmokeGpuStep` 은 디바이스를 전혀 모르는
 * 순수 함수이고, 디바이스를 타는 것은 `encodeStudioSmokeGpuStep` 뿐이다(주입형 seam).
 *
 * ## CPU 스텝과의 대응
 * 계획의 dispatch 순서는 studio-smoke-core 의 `stepStudioSmoke` 순서와 정확히 같다.
 * CPU 가 `TypedArray.set()` 으로 하는 필드 복사는 `copy` 연산으로, `fill(0)` 은 `clear`
 * 연산으로 나타난다 — 즉 계획만 읽어도 CPU 스텝을 재구성할 수 있다.
 *
 * ## GPU 가 **일부러** 하지 않는 것 (정직하게)
 *  - **평균 압력 차감**: CPU 는 순수 Neumann(개구부 없음)일 때 압력의 상수 자유도를
 *    없애려고 평균을 뺀다. GPU 는 전역 리덕션 커널을 추가하지 않고 생략한다 —
 *    ∇(p+c) = ∇p 라 **속도 결과는 완전히 동일**하고, 달라지는 것은 리드백한 압력 필드의
 *    상수 오프셋뿐이다. 압력 필드 자체를 쓰려면 CPU 경로를 써야 한다.
 *  - **CFL/클램프 계측**: CPU 는 역추적 클램프 횟수를 세어 `cflClamped` 로 보고한다.
 *    GPU 는 원자 카운터를 두지 않는다(미리보기 경로라 계측은 CPU 스텝이 담당).
 *
 * 전부 순수·결정적(계획 생성 기준). 같은 (spec, params) 는 항상 같은 계획을 만든다.
 */

import {
  studioSmokeCellCount,
  studioSmokeUCount,
  studioSmokeVCount,
  studioSmokeWCount,
} from "./studio-smoke-grid";
import { STUDIO_SMOKE_DISPATCH_ROW_THREADS, STUDIO_SMOKE_KERNEL_BINDINGS, STUDIO_SMOKE_WGSL_KERNELS, STUDIO_SMOKE_WORKGROUP_SIZE } from "./studio-smoke-wgsl";

import type { StudioSmokeKernelId, StudioSmokeStepParams } from "./studio-smoke-core";
import type { StudioSmokeGpuRuntime } from "./studio-smoke-gpu-runtime";
import type { StudioSmokeGridSpec } from "./studio-smoke-grid";

// ---------------------------------------------------------------------------
// 버퍼 식별자
// ---------------------------------------------------------------------------

export const STUDIO_SMOKE_FIELD_BUFFER_IDS = [
  "solid",
  "u",
  "v",
  "w",
  "u0",
  "v0",
  "w0",
  "density",
  "density0",
  "temperature",
  "temperature0",
  "pressure",
  "pressure0",
  "divergence",
  "curlX",
  "curlY",
  "curlZ",
  "curlMagnitude",
] as const;

export type StudioSmokeFieldBufferId = (typeof STUDIO_SMOKE_FIELD_BUFFER_IDS)[number];
/** 계획의 바인딩 슬롯 — 0번은 항상 uniform("params"), 나머지는 실제 필드 버퍼다. */
export type StudioSmokeBindingId = "params" | StudioSmokeFieldBufferId;

/** 버퍼 하나의 바이트 길이. solid 는 WGSL storage 제약 때문에 u32(4B/cell)다. */
export function studioSmokeBufferByteLength(spec: StudioSmokeGridSpec, id: StudioSmokeFieldBufferId): number {
  switch (id) {
    case "u":
    case "u0":
      return studioSmokeUCount(spec) * 4;
    case "v":
    case "v0":
      return studioSmokeVCount(spec) * 4;
    case "w":
    case "w0":
      return studioSmokeWCount(spec) * 4;
    default:
      return studioSmokeCellCount(spec) * 4;
  }
}

// ---------------------------------------------------------------------------
// 계획 타입
// ---------------------------------------------------------------------------

export interface StudioSmokeGpuDispatchOp {
  readonly kind: "dispatch";
  readonly label: string;
  readonly kernelId: StudioSmokeKernelId;
  readonly threadCount: number;
  readonly dispatchX: number;
  readonly dispatchY: number;
  /** 배열 인덱스 = `@binding(n)`. 0번은 항상 "params". */
  readonly bindings: readonly StudioSmokeBindingId[];
}

export interface StudioSmokeGpuCopyOp {
  readonly kind: "copy";
  readonly label: string;
  readonly from: StudioSmokeFieldBufferId;
  readonly to: StudioSmokeFieldBufferId;
  readonly byteLength: number;
}

export interface StudioSmokeGpuClearOp {
  readonly kind: "clear";
  readonly label: string;
  readonly target: StudioSmokeFieldBufferId;
  readonly byteLength: number;
}

export type StudioSmokeGpuOp = StudioSmokeGpuDispatchOp | StudioSmokeGpuCopyOp | StudioSmokeGpuClearOp;

export interface StudioSmokeGpuStepPlan {
  readonly spec: StudioSmokeGridSpec;
  readonly pressureIterations: number;
  readonly ops: readonly StudioSmokeGpuOp[];
  /** Jacobi 반복 후 최종 압력이 들어 있는 버퍼(홀수=pressure, 짝수=pressure0). */
  readonly pressureResultBuffer: "pressure" | "pressure0";
  /** 계획이 요구하는 서로 다른 threadCount 값들(오름차순) — uniform 버퍼 개수. */
  readonly uniformThreadCounts: readonly number[];
  /** 순수 Neumann 이라 CPU 는 평균 압력을 뺐지만 GPU 는 생략했음을 알리는 플래그. */
  readonly meanPressureSubtractionSkipped: boolean;
}

/** threadCount → 2D 디스패치 개수. x 는 항상 ROW_THREADS/WORKGROUP_SIZE 로 고정. */
export function studioSmokeDispatchCounts(threadCount: number): { x: number; y: number } {
  const x = STUDIO_SMOKE_DISPATCH_ROW_THREADS / STUDIO_SMOKE_WORKGROUP_SIZE;
  const y = Math.max(1, Math.ceil(threadCount / STUDIO_SMOKE_DISPATCH_ROW_THREADS));
  return { x, y };
}

function dispatchOp(
  kernelId: StudioSmokeKernelId,
  label: string,
  threadCount: number,
  bindings: readonly StudioSmokeBindingId[],
): StudioSmokeGpuDispatchOp {
  const counts = studioSmokeDispatchCounts(threadCount);
  return { kind: "dispatch", label, kernelId, threadCount, dispatchX: counts.x, dispatchY: counts.y, bindings };
}

/**
 * 한 스텝의 GPU 실행 계획을 만든다 — 디바이스 없이 완전히 검증 가능한 순수 데이터.
 * dispatch 순서는 CPU `stepStudioSmoke` 와 1:1 이다.
 */
export function planStudioSmokeGpuStep(
  spec: StudioSmokeGridSpec,
  params: StudioSmokeStepParams,
): StudioSmokeGpuStepPlan {
  const cells = studioSmokeCellCount(spec);
  const uCount = studioSmokeUCount(spec);
  const vCount = studioSmokeVCount(spec);
  const wCount = studioSmokeWCount(spec);
  const faceThreads = uCount + vCount + wCount;
  const boundaryThreads = cells + faceThreads;
  const iterations = Math.max(0, Math.floor(params.pressureIterations));
  const ops: StudioSmokeGpuOp[] = [];
  const bytes = (id: StudioSmokeFieldBufferId): number => studioSmokeBufferByteLength(spec, id);

  // 1) 속도 이류 — CPU 의 u0.set(u) 3회가 copy 3개로 나타난다.
  ops.push({ kind: "copy", label: "u→u0", from: "u", to: "u0", byteLength: bytes("u") });
  ops.push({ kind: "copy", label: "v→v0", from: "v", to: "v0", byteLength: bytes("v") });
  ops.push({ kind: "copy", label: "w→w0", from: "w", to: "w0", byteLength: bytes("w") });
  ops.push(
    dispatchOp("advect_velocity", "속도 이류", faceThreads, ["params", "u0", "v0", "w0", "u", "v", "w"]),
  );

  // 2) 스칼라 이류 — 같은 파이프라인을 버퍼만 바꿔 두 번 돌린다.
  ops.push({ kind: "copy", label: "density→density0", from: "density", to: "density0", byteLength: bytes("density") });
  ops.push(
    dispatchOp("advect_scalar", "밀도 이류", cells, ["params", "solid", "u", "v", "w", "density0", "density"]),
  );
  ops.push({
    kind: "copy",
    label: "temperature→temperature0",
    from: "temperature",
    to: "temperature0",
    byteLength: bytes("temperature"),
  });
  ops.push(
    dispatchOp("advect_scalar", "온도 이류", cells, [
      "params",
      "solid",
      "u",
      "v",
      "w",
      "temperature0",
      "temperature",
    ]),
  );

  // 3) 소산
  ops.push(dispatchOp("dissipate", "소산", cells, ["params", "solid", "density", "temperature"]));

  // 4) 부력
  ops.push(dispatchOp("buoyancy", "부력", vCount, ["params", "solid", "density", "temperature", "v"]));

  // 5) 와도 구속 — 힘 계산과 면 적용은 이웃 의존 때문에 **반드시 별개 디스패치**다.
  if (params.vorticityEpsilon !== 0) {
    ops.push(
      dispatchOp("curl", "와도 계산", cells, [
        "params",
        "u",
        "v",
        "w",
        "curlX",
        "curlY",
        "curlZ",
        "curlMagnitude",
      ]),
    );
    ops.push(
      dispatchOp("vorticity_force", "와도 구속력", cells, [
        "params",
        "solid",
        "curlMagnitude",
        "curlX",
        "curlY",
        "curlZ",
      ]),
    );
    ops.push(
      dispatchOp("vorticity_apply", "와도 구속 적용", faceThreads, [
        "params",
        "solid",
        "curlX",
        "curlY",
        "curlZ",
        "u",
        "v",
        "w",
      ]),
    );
  }

  const boundaryBindings: readonly StudioSmokeBindingId[] = [
    "params",
    "solid",
    "density",
    "temperature",
    "pressure",
    "u",
    "v",
    "w",
  ];
  ops.push(dispatchOp("boundary", "경계", boundaryThreads, boundaryBindings));

  // 6) 압력 투영
  ops.push(dispatchOp("divergence", "발산", cells, ["params", "solid", "u", "v", "w", "divergence"]));
  ops.push({ kind: "clear", label: "pressure 0", target: "pressure", byteLength: bytes("pressure") });
  ops.push({ kind: "clear", label: "pressure0 0", target: "pressure0", byteLength: bytes("pressure0") });
  let src: "pressure" | "pressure0" = "pressure0";
  let dst: "pressure" | "pressure0" = "pressure";
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    ops.push(
      dispatchOp("pressure_jacobi", `Jacobi ${iteration + 1}/${iterations}`, cells, [
        "params",
        "solid",
        "divergence",
        src,
        dst,
      ]),
    );
    const swap: "pressure" | "pressure0" = src;
    src = dst;
    dst = swap;
  }
  const pressureResultBuffer = src;
  if (pressureResultBuffer !== "pressure") {
    ops.push({
      kind: "copy",
      label: "pressure0→pressure",
      from: "pressure0",
      to: "pressure",
      byteLength: bytes("pressure"),
    });
  }
  ops.push(
    dispatchOp("subtract_gradient", "압력 보정", faceThreads, ["params", "solid", "pressure", "u", "v", "w"]),
  );
  ops.push(dispatchOp("boundary", "경계(투영 후)", boundaryThreads, boundaryBindings));

  const threadCounts = new Set<number>();
  for (const op of ops) if (op.kind === "dispatch") threadCounts.add(op.threadCount);

  return {
    spec,
    pressureIterations: iterations,
    ops,
    pressureResultBuffer,
    uniformThreadCounts: [...threadCounts].sort((a, b) => a - b),
    meanPressureSubtractionSkipped: !(
      spec.boundary.xMin === "open" ||
      spec.boundary.xMax === "open" ||
      spec.boundary.yMin === "open" ||
      spec.boundary.yMax === "open" ||
      spec.boundary.zMin === "open" ||
      spec.boundary.zMax === "open"
    ),
  };
}

// ---------------------------------------------------------------------------
// 실행부 — 유일하게 디바이스를 타는 자리
// ---------------------------------------------------------------------------

export interface StudioSmokeGpuResources {
  /** 필드 버퍼 전체. 하나라도 빠지면 실행은 null(=GPU 로 처리 안 함)을 돌려준다. */
  readonly buffers: Partial<Record<StudioSmokeFieldBufferId, GPUBuffer>>;
  /** threadCount → uniform 버퍼. plan.uniformThreadCounts 를 전부 채워야 한다. */
  readonly uniforms: ReadonlyMap<number, GPUBuffer>;
}

export interface StudioSmokeGpuEncodeResult {
  readonly dispatches: number;
  readonly copies: number;
  readonly clears: number;
  readonly computePasses: number;
}

/**
 * 계획을 커맨드 인코더에 굽고 제출한다.
 * 연속된 dispatch 는 하나의 compute pass 로 묶고, copy/clear 가 끼면 pass 를 끊는다.
 * 반환값 `null` = "GPU 로 처리하지 않았다"(런타임 lost / 버퍼 누락 / 인코딩 예외).
 */
export function encodeStudioSmokeGpuStep(
  runtime: StudioSmokeGpuRuntime,
  plan: StudioSmokeGpuStepPlan,
  resources: StudioSmokeGpuResources,
): StudioSmokeGpuEncodeResult | null {
  if (runtime.lost) return null;
  for (const threadCount of plan.uniformThreadCounts) {
    if (!resources.uniforms.get(threadCount)) return null;
  }
  for (const op of plan.ops) {
    if (op.kind === "dispatch") {
      for (const binding of op.bindings) {
        if (binding !== "params" && !resources.buffers[binding]) return null;
      }
    } else if (op.kind === "copy") {
      if (!resources.buffers[op.from] || !resources.buffers[op.to]) return null;
    } else if (!resources.buffers[op.target]) {
      return null;
    }
  }

  let dispatches = 0;
  let copies = 0;
  let clears = 0;
  let computePasses = 0;

  try {
    const encoder = runtime.device.createCommandEncoder({ label: "studio-smoke/step" });
    let pass: GPUComputePassEncoder | null = null;
    const endPass = (): void => {
      if (pass) {
        pass.end();
        pass = null;
      }
    };

    for (const op of plan.ops) {
      if (op.kind === "copy") {
        endPass();
        encoder.copyBufferToBuffer(
          resources.buffers[op.from]!,
          0,
          resources.buffers[op.to]!,
          0,
          op.byteLength,
        );
        copies += 1;
        continue;
      }
      if (op.kind === "clear") {
        endPass();
        encoder.clearBuffer(resources.buffers[op.target]!, 0, op.byteLength);
        clears += 1;
        continue;
      }
      const pipeline = runtime.getComputePipeline(STUDIO_SMOKE_WGSL_KERNELS[op.kernelId]);
      const entries: GPUBindGroupEntry[] = op.bindings.map((binding, index) => ({
        binding: index,
        resource: {
          buffer:
            binding === "params" ? resources.uniforms.get(op.threadCount)! : resources.buffers[binding]!,
        },
      }));
      const bindGroup = runtime.device.createBindGroup({
        label: `studio-smoke/${op.kernelId}`,
        layout: pipeline.getBindGroupLayout(0),
        entries,
      });
      if (!pass) {
        pass = encoder.beginComputePass({ label: "studio-smoke/compute" });
        computePasses += 1;
      }
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(op.dispatchX, op.dispatchY);
      dispatches += 1;
    }
    endPass();
    runtime.device.queue.submit([encoder.finish()]);
  } catch {
    // 인코딩/제출 실패는 선택한 GPU 작업의 unavailable 결과다. 호출부는 같은 작업에서
    // CPU solver를 시작하지 않고 마지막 정상 상태를 유지해야 한다.
    return null;
  }

  return { dispatches, copies, clears, computePasses };
}

/** 계획이 참조하는 커널의 바인딩 이름 표(디버깅/계약 테스트용 재노출). */
export function studioSmokeKernelBindingNames(kernelId: StudioSmokeKernelId): readonly string[] {
  return STUDIO_SMOKE_KERNEL_BINDINGS[kernelId];
}
