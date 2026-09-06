import { describe, expect, it } from "vitest";

import { STUDIO_PATHTRACE_LUMA, STUDIO_PATHTRACE_MIN_ALPHA } from "./studio-pathtrace-bsdf";
import { STUDIO_PATHTRACE_TRAVERSAL_STACK_SIZE } from "./studio-pathtrace-bvh";
import { STUDIO_PATHTRACE_INV_DIR_LIMIT } from "./studio-pathtrace-geometry";
import {
  STUDIO_PATHTRACE_RAY_EPSILON,
  STUDIO_PATHTRACE_RR_MAX,
  STUDIO_PATHTRACE_RR_MIN,
} from "./studio-pathtrace-integrator";
import {
  STUDIO_PATHTRACE_DIMENSION,
  STUDIO_PATHTRACE_MIX_BOUNCE,
  STUDIO_PATHTRACE_MIX_DIMENSION,
  STUDIO_PATHTRACE_MIX_SAMPLE,
  STUDIO_PATHTRACE_PCG_INCREMENT,
  STUDIO_PATHTRACE_PCG_MULTIPLIER,
  STUDIO_PATHTRACE_PCG_OUTPUT_MULTIPLIER,
} from "./studio-pathtrace-sampler";
import { createStudioPathtraceMaterial } from "./studio-pathtrace-scene";
import {
  STUDIO_PATHTRACE_ACCUM_FLOATS_PER_PIXEL,
  STUDIO_PATHTRACE_BINDINGS,
  STUDIO_PATHTRACE_DISPATCH_ROW_THREADS,
  STUDIO_PATHTRACE_ENTRY_POINT,
  STUDIO_PATHTRACE_ENV_CODE,
  STUDIO_PATHTRACE_LIGHT_CODE,
  STUDIO_PATHTRACE_LIGHT_FLOATS,
  STUDIO_PATHTRACE_MATERIAL_BYTES,
  STUDIO_PATHTRACE_MATERIAL_FLOATS,
  STUDIO_PATHTRACE_MODE_CODE,
  STUDIO_PATHTRACE_SHADER,
  STUDIO_PATHTRACE_UNIFORM_BYTES,
  STUDIO_PATHTRACE_UNIFORM_OFFSETS,
  STUDIO_PATHTRACE_WGSL,
  STUDIO_PATHTRACE_WORKGROUP_SIZE,
  mergeStudioPathtraceGpuAccum,
  packStudioPathtraceLights,
  packStudioPathtraceMaterials,
  packStudioPathtraceUniform,
  planStudioPathtraceDispatch,
} from "./studio-pathtrace-wgsl";

import type { StudioPathtraceLight } from "./studio-pathtrace-scene";

describe("WGSL 구조 계약", () => {
  it("엔트리 포인트와 workgroup_size 가 TS 상수와 일치한다", () => {
    expect(STUDIO_PATHTRACE_WGSL).toContain(`@workgroup_size(${STUDIO_PATHTRACE_WORKGROUP_SIZE})`);
    expect(STUDIO_PATHTRACE_WGSL).toContain(`fn ${STUDIO_PATHTRACE_ENTRY_POINT}(`);
    expect(STUDIO_PATHTRACE_SHADER.entryPoint).toBe(STUDIO_PATHTRACE_ENTRY_POINT);
    expect(STUDIO_PATHTRACE_SHADER.wgsl).toBe(STUDIO_PATHTRACE_WGSL);
    expect(STUDIO_PATHTRACE_SHADER.shaderId).toMatch(/^studio-pathtrace-/);
  });

  it("모든 바인딩이 선언되어 있고 인덱스가 겹치지 않는다", () => {
    const entries = Object.entries(STUDIO_PATHTRACE_BINDINGS);
    const indices = entries.map(([, i]) => i);
    expect(new Set(indices).size).toBe(entries.length);
    for (const [name, index] of entries) {
      expect(STUDIO_PATHTRACE_WGSL, `binding ${name}`).toContain(`@group(0) @binding(${index})`);
    }
    // accum 만 read_write, 나머지 storage 는 read.
    expect(STUDIO_PATHTRACE_WGSL).toContain(
      `@group(0) @binding(${STUDIO_PATHTRACE_BINDINGS.accum}) var<storage, read_write>`,
    );
    expect(
      (STUDIO_PATHTRACE_WGSL.match(/var<storage, read_write>/g) ?? []).length,
    ).toBe(1);
    expect((STUDIO_PATHTRACE_WGSL.match(/var<storage, read>/g) ?? []).length).toBe(8);
    expect((STUDIO_PATHTRACE_WGSL.match(/var<uniform>/g) ?? []).length).toBe(1);
  });

  it("중괄호/괄호가 균형을 이룬다", () => {
    let brace = 0;
    let paren = 0;
    for (const ch of STUDIO_PATHTRACE_WGSL) {
      if (ch === "{") brace += 1;
      else if (ch === "}") brace -= 1;
      else if (ch === "(") paren += 1;
      else if (ch === ")") paren -= 1;
      expect(brace).toBeGreaterThanOrEqual(0);
      expect(paren).toBeGreaterThanOrEqual(0);
    }
    expect(brace).toBe(0);
    expect(paren).toBe(0);
  });

  it("CPU 코어의 각 단계에 대응하는 함수가 모두 있다", () => {
    const required = [
      "fn pt_pcg_hash",
      "fn pt_hash",
      "fn pt_rand01",
      "fn pt_strata",
      "fn pt_sample_disk",
      "fn pt_sample_cosine",
      "fn pt_sample_ggx_vndf",
      "fn pt_onb_tangent",
      "fn pt_onb_bitangent",
      "fn pt_d_ggx",
      "fn pt_g1",
      "fn pt_g2",
      "fn pt_spec_prob",
      "fn pt_eval_bsdf",
      "fn pt_pdf_bsdf",
      "fn pt_sample_bsdf",
      "fn pt_make_ray",
      "fn pt_hit_aabb",
      "fn pt_hit_triangle",
      "fn pt_hit_parallelogram",
      "fn pt_trace_closest",
      "fn pt_trace_occluded",
      "fn pt_env",
      "fn pt_power_heuristic",
      "fn pt_camera_ray",
      "fn pt_trace_radiance",
    ];
    for (const fn of required) expect(STUDIO_PATHTRACE_WGSL, fn).toContain(fn);
  });

  it("각 WGSL 함수가 대응 TS 함수를 주석으로 밝힌다", () => {
    for (const ts of [
      "TS: studioPathtracePcgHash",
      "TS: studioPathtraceHash",
      "TS: intersectStudioPathtraceTriangle",
      "TS: intersectStudioPathtraceBvh",
      "TS: occludedStudioPathtraceBvh",
      "TS: evalStudioPathtraceBsdf",
      "TS: pdfStudioPathtraceBsdf",
      "TS: sampleStudioPathtraceBsdf",
      "TS: traceStudioPathtraceRadiance",
    ]) {
      expect(STUDIO_PATHTRACE_WGSL, ts).toContain(ts);
    }
  });

  it("수치 상수가 TS 상수에서 보간되어 손으로 고칠 수 없다", () => {
    // WGSL f32 리터럴은 정수여도 소수점이 있어야 한다(모듈의 f32Literal 과 같은 규칙).
    const wgslFloat = (value: number): string => (Number.isInteger(value) ? `${value}.0` : `${value}`);
    const pairs: readonly [string, string][] = [
      ["PT_PCG_MULT", `${STUDIO_PATHTRACE_PCG_MULTIPLIER}u`],
      ["PT_PCG_INC", `${STUDIO_PATHTRACE_PCG_INCREMENT}u`],
      ["PT_PCG_OUT", `${STUDIO_PATHTRACE_PCG_OUTPUT_MULTIPLIER}u`],
      ["PT_MIX_SAMPLE", `${STUDIO_PATHTRACE_MIX_SAMPLE}u`],
      ["PT_MIX_BOUNCE", `${STUDIO_PATHTRACE_MIX_BOUNCE}u`],
      ["PT_MIX_DIM", `${STUDIO_PATHTRACE_MIX_DIMENSION}u`],
      ["PT_MIN_ALPHA", wgslFloat(STUDIO_PATHTRACE_MIN_ALPHA)],
      ["PT_EPS", wgslFloat(STUDIO_PATHTRACE_RAY_EPSILON)],
      ["PT_RR_MIN", wgslFloat(STUDIO_PATHTRACE_RR_MIN)],
      ["PT_RR_MAX", wgslFloat(STUDIO_PATHTRACE_RR_MAX)],
      ["PT_INV_LIMIT", wgslFloat(STUDIO_PATHTRACE_INV_DIR_LIMIT)],
      ["PT_ROW_THREADS", `${STUDIO_PATHTRACE_DISPATCH_ROW_THREADS}u`],
      ["PT_STACK", `${STUDIO_PATHTRACE_TRAVERSAL_STACK_SIZE}u`],
    ];
    for (const [name, literal] of pairs) {
      const match = STUDIO_PATHTRACE_WGSL.match(new RegExp(`const ${name}:\\s*\\w+\\s*=\\s*([^;]+);`));
      expect(match, `${name} 선언이 없다`).not.toBeNull();
      expect((match as RegExpMatchArray)[1].trim(), name).toBe(literal);
    }
    expect(STUDIO_PATHTRACE_WGSL).toContain(
      `vec3<f32>(${STUDIO_PATHTRACE_LUMA[0]}, ${STUDIO_PATHTRACE_LUMA[1]}, ${STUDIO_PATHTRACE_LUMA[2]})`,
    );
  });

  it("샘플 차원 번호가 TS 열거와 정확히 일치한다", () => {
    const wgslDims: Readonly<Record<string, number>> = {
      PT_DIM_JITTER_X: STUDIO_PATHTRACE_DIMENSION.pixelJitterX,
      PT_DIM_JITTER_Y: STUDIO_PATHTRACE_DIMENSION.pixelJitterY,
      PT_DIM_LIGHT_SELECT: STUDIO_PATHTRACE_DIMENSION.lightSelect,
      PT_DIM_LIGHT_U: STUDIO_PATHTRACE_DIMENSION.lightU,
      PT_DIM_LIGHT_V: STUDIO_PATHTRACE_DIMENSION.lightV,
      PT_DIM_BSDF_LOBE: STUDIO_PATHTRACE_DIMENSION.bsdfLobe,
      PT_DIM_BSDF_U: STUDIO_PATHTRACE_DIMENSION.bsdfU,
      PT_DIM_BSDF_V: STUDIO_PATHTRACE_DIMENSION.bsdfV,
      PT_DIM_RR: STUDIO_PATHTRACE_DIMENSION.russianRoulette,
    };
    for (const [name, value] of Object.entries(wgslDims)) {
      expect(STUDIO_PATHTRACE_WGSL, name).toContain(`const ${name}: u32 = ${value}u;`);
    }
  });

  it("모드/환경/광원 종류 코드가 WGSL 상수와 일치한다", () => {
    expect(STUDIO_PATHTRACE_WGSL).toContain(
      `const PT_MODE_NEE_MIS: u32 = ${STUDIO_PATHTRACE_MODE_CODE["nee-mis"]}u;`,
    );
    expect(STUDIO_PATHTRACE_WGSL).toContain(
      `const PT_ENV_GRADIENT: u32 = ${STUDIO_PATHTRACE_ENV_CODE.gradient}u;`,
    );
    expect(STUDIO_PATHTRACE_WGSL).toContain(
      `const PT_LIGHT_AREA: f32 = ${STUDIO_PATHTRACE_LIGHT_CODE.area}.0;`,
    );
    expect(STUDIO_PATHTRACE_MODE_CODE["naive-bsdf"]).not.toBe(STUDIO_PATHTRACE_MODE_CODE["nee-mis"]);
  });

  it("uniform 구조체 멤버가 패커 오프셋 순서와 같다", () => {
    const structBody = STUDIO_PATHTRACE_WGSL.slice(
      STUDIO_PATHTRACE_WGSL.indexOf("struct PtUniform {"),
      STUDIO_PATHTRACE_WGSL.indexOf("@group(0) @binding(0)"),
    );
    const order = Object.entries(STUDIO_PATHTRACE_UNIFORM_OFFSETS).sort((a, b) => a[1] - b[1]);
    let cursor = 0;
    for (const [name] of order) {
      const at = structBody.indexOf(`${name}:`, cursor);
      expect(at, `${name} 이 구조체에 선언 순서대로 없다`).toBeGreaterThan(-1);
      cursor = at;
    }
  });
});

describe("패커", () => {
  it("uniform 패킹 값이 TS 원본과 바이트 위치까지 일치한다", () => {
    const buffer = packStudioPathtraceUniform({
      camPos: [1, 2, 3],
      camRight: [1, 0, 0],
      camUp: [0, 1, 0],
      camForward: [0, 0, -1],
      width: 640,
      height: 480,
      sampleIndex: 12,
      seed: 4242,
      tanHalfFovY: 0.5,
      aspect: 640 / 480,
      maxBounces: 5,
      rrStartBounce: 3,
      rrEnabled: true,
      lightCount: 2,
      materialCount: 3,
      mode: "naive-bsdf",
      samplesPerPixel: 64,
      clampIndirect: 12.5,
      environment: { kind: "gradient", zenithLinear: [0.1, 0.2, 0.3], horizonLinear: [0.4, 0.5, 0.6] },
    });
    expect(buffer.byteLength).toBe(STUDIO_PATHTRACE_UNIFORM_BYTES);
    const f32 = new Float32Array(buffer);
    const u32 = new Uint32Array(buffer);
    const o = STUDIO_PATHTRACE_UNIFORM_OFFSETS;
    expect([f32[o.camPos / 4], f32[o.camPos / 4 + 1], f32[o.camPos / 4 + 2]]).toEqual([1, 2, 3]);
    expect(u32[o.width / 4]).toBe(640);
    expect(u32[o.height / 4]).toBe(480);
    expect(u32[o.sampleIndex / 4]).toBe(12);
    expect(u32[o.seed / 4]).toBe(4242);
    expect(f32[o.tanHalfFovY / 4]).toBeCloseTo(0.5, 6);
    expect(f32[o.aspect / 4]).toBeCloseTo(640 / 480, 6);
    expect(u32[o.maxBounces / 4]).toBe(5);
    expect(u32[o.rrStartBounce / 4]).toBe(3);
    expect(u32[o.rrEnabled / 4]).toBe(1);
    expect(u32[o.lightCount / 4]).toBe(2);
    expect(u32[o.materialCount / 4]).toBe(3);
    expect(u32[o.mode / 4]).toBe(STUDIO_PATHTRACE_MODE_CODE["naive-bsdf"]);
    expect(u32[o.samplesPerPixel / 4]).toBe(64);
    expect(u32[o.envKind / 4]).toBe(STUDIO_PATHTRACE_ENV_CODE.gradient);
    expect(f32[o.clampIndirect / 4]).toBeCloseTo(12.5, 6);
    expect(f32[o.envA / 4]).toBeCloseTo(0.1, 6);
    expect(f32[o.envB / 4]).toBeCloseTo(0.4, 6);
  });

  it("constant 환경은 zenith/horizon 슬롯을 같은 값으로 채운다", () => {
    const buffer = packStudioPathtraceUniform({
      camPos: [0, 0, 0],
      camRight: [1, 0, 0],
      camUp: [0, 1, 0],
      camForward: [0, 0, -1],
      width: 4,
      height: 4,
      sampleIndex: 0,
      seed: 1,
      tanHalfFovY: 1,
      aspect: 1,
      maxBounces: 1,
      rrStartBounce: 1,
      rrEnabled: false,
      lightCount: 0,
      materialCount: 1,
      mode: "nee-mis",
      samplesPerPixel: 1,
      clampIndirect: 0,
      environment: { kind: "constant", radianceLinear: [0.7, 0.8, 0.9] },
    });
    const f32 = new Float32Array(buffer);
    const o = STUDIO_PATHTRACE_UNIFORM_OFFSETS;
    expect(new Uint32Array(buffer)[o.envKind / 4]).toBe(STUDIO_PATHTRACE_ENV_CODE.constant);
    for (let c = 0; c < 3; c += 1) {
      expect(f32[o.envA / 4 + c]).toBeCloseTo(f32[o.envB / 4 + c], 12);
    }
    expect(f32[o.envA / 4 + 2]).toBeCloseTo(0.9, 6);
    expect(new Uint32Array(buffer)[o.rrEnabled / 4]).toBe(0);
  });

  it("머티리얼 패킹이 vec4×3 레이아웃을 따른다", () => {
    const materials = [
      createStudioPathtraceMaterial({
        baseColorLinear: [0.1, 0.2, 0.3],
        roughness: 0.4,
        metallic: 0.5,
        emissiveLinear: [0.6, 0.7, 0.8],
        ior: 1.45,
      }),
      createStudioPathtraceMaterial({ baseColorLinear: [1, 0, 0] }),
    ];
    const packed = packStudioPathtraceMaterials(materials);
    expect(packed.length).toBe(materials.length * STUDIO_PATHTRACE_MATERIAL_FLOATS);
    expect(STUDIO_PATHTRACE_MATERIAL_FLOATS * 4).toBe(STUDIO_PATHTRACE_MATERIAL_BYTES);
    expect(Array.from(packed.subarray(0, 12)).map((v) => Math.round(v * 1000) / 1000)).toEqual([
      0.1, 0.2, 0.3, 0.4, 0.6, 0.7, 0.8, 0.5, 1.45, 0, 0, 0,
    ]);
    expect(packed[12]).toBeCloseTo(1, 6);
  });

  it("광원 패킹이 종류 코드와 미리 구운 면적을 싣는다", () => {
    const lights: readonly StudioPathtraceLight[] = [
      { kind: "point", positionWorld: [1, 2, 3], intensityLinear: [4, 5, 6], radius: 0.25 },
      {
        kind: "area",
        origin: [0, 2, 0],
        edgeU: [2, 0, 0],
        edgeV: [0, 0, 3],
        emissiveLinear: [7, 8, 9],
        twoSided: true,
      },
    ];
    const packed = packStudioPathtraceLights(lights);
    expect(packed.length).toBe(2 * STUDIO_PATHTRACE_LIGHT_FLOATS);
    expect(packed[3]).toBe(STUDIO_PATHTRACE_LIGHT_CODE.point);
    expect(packed[7]).toBeCloseTo(0.25, 6);
    expect([packed[12], packed[13], packed[14]]).toEqual([4, 5, 6]);
    const b = STUDIO_PATHTRACE_LIGHT_FLOATS;
    expect(packed[b + 3]).toBe(STUDIO_PATHTRACE_LIGHT_CODE.area);
    expect(packed[b + 11]).toBe(1); // twoSided
    // |edgeU × edgeV| = |(2,0,0) × (0,0,3)| = 6
    expect(packed[b + 15]).toBeCloseTo(6, 6);
  });

  it("빈 배열도 최소 1 슬롯을 만들어 storage 바인딩이 유효하다", () => {
    expect(packStudioPathtraceMaterials([]).length).toBe(STUDIO_PATHTRACE_MATERIAL_FLOATS);
    expect(packStudioPathtraceLights([]).length).toBe(STUDIO_PATHTRACE_LIGHT_FLOATS);
  });
});

describe("디스패치 계획", () => {
  it("workgroup 수가 65535 한계 아래로 유지된다", () => {
    for (const pixels of [1, 1024, 640 * 480, 1920 * 1080, 2048 * 2048]) {
      const plan = planStudioPathtraceDispatch(pixels);
      expect(plan.x).toBe(STUDIO_PATHTRACE_DISPATCH_ROW_THREADS / STUDIO_PATHTRACE_WORKGROUP_SIZE);
      expect(plan.y).toBeGreaterThanOrEqual(1);
      expect(plan.x).toBeLessThan(65535);
      expect(plan.y).toBeLessThan(65535);
      // 전 픽셀을 덮어야 한다.
      expect(plan.x * STUDIO_PATHTRACE_WORKGROUP_SIZE * plan.y).toBeGreaterThanOrEqual(pixels);
    }
  });
});

describe("GPU 누적 버퍼 → CPU 필름 병합", () => {
  it("픽셀당 4 f32 를 필름의 3 f32 + 카운트로 접는다", () => {
    const pixels = 4;
    const accum = new Float32Array(pixels * STUDIO_PATHTRACE_ACCUM_FLOATS_PER_PIXEL);
    for (let p = 0; p < pixels; p += 1) {
      accum[p * 4] = p + 0.5;
      accum[p * 4 + 1] = p + 1.5;
      accum[p * 4 + 2] = p + 2.5;
      accum[p * 4 + 3] = 8;
    }
    const filmAccum = new Float32Array(pixels * 3);
    const filmCount = new Uint32Array(pixels);
    mergeStudioPathtraceGpuAccum(accum, filmAccum, filmCount);
    for (let p = 0; p < pixels; p += 1) {
      expect(filmAccum[p * 3]).toBeCloseTo(p + 0.5, 6);
      expect(filmAccum[p * 3 + 2]).toBeCloseTo(p + 2.5, 6);
      expect(filmCount[p]).toBe(8);
    }
    // 두 번 병합하면 누적된다(프로그레시브).
    mergeStudioPathtraceGpuAccum(accum, filmAccum, filmCount);
    expect(filmCount[0]).toBe(16);
    expect(filmAccum[0]).toBeCloseTo(1, 6);
  });
});
