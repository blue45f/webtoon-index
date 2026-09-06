import { describe, expect, it } from "vitest";

import {
  STUDIO_VOLUME_BINDINGS,
  STUDIO_VOLUME_ENTRY_POINT,
  STUDIO_VOLUME_LIGHT_BYTES,
  STUDIO_VOLUME_OUTPUT_BYTES_PER_PIXEL,
  STUDIO_VOLUME_UNIFORM_BYTES,
  STUDIO_VOLUME_UNIFORM_OFFSETS,
  STUDIO_VOLUME_WGSL,
  STUDIO_VOLUME_WORKGROUP_X,
  STUDIO_VOLUME_WORKGROUP_Y,
  studioVolumeWgslUniformFieldOrder,
} from "./studio-volume-wgsl";

describe("studio-volume-wgsl · uniform 레이아웃 계약", () => {
  it("struct 선언 순서가 오프셋 표와 정확히 일치한다", () => {
    expect(studioVolumeWgslUniformFieldOrder()).toEqual(
      Object.keys(STUDIO_VOLUME_UNIFORM_OFFSETS)
    );
  });

  it("오프셋은 16바이트 정렬이고 필드 크기와 빈틈없이 이어진다", () => {
    const entries = Object.entries(STUDIO_VOLUME_UNIFORM_OFFSETS);
    expect(entries[0]).toEqual(["worldToObject", 0]);
    for (const [name, offset] of entries) {
      expect(offset % 16, `${name} 은 16바이트 정렬이어야 한다`).toBe(0);
    }
    // mat4x4 는 64바이트, 나머지는 전부 vec4(16바이트).
    for (let i = 1; i < entries.length; i += 1) {
      const previousSize = entries[i - 1][0] === "worldToObject" ? 64 : 16;
      expect(entries[i][1]).toBe(entries[i - 1][1] + previousSize);
    }
    const last = entries[entries.length - 1][1];
    expect(STUDIO_VOLUME_UNIFORM_BYTES).toBe(last + 16);
    expect(STUDIO_VOLUME_UNIFORM_BYTES % 16).toBe(0);
  });

  it("광원/출력 스트라이드는 vec4 배수다", () => {
    expect(STUDIO_VOLUME_LIGHT_BYTES).toBe(32);
    expect(STUDIO_VOLUME_OUTPUT_BYTES_PER_PIXEL).toBe(32);
  });
});

describe("studio-volume-wgsl · 셰이더 소스 구조", () => {
  it("엔트리포인트와 워크그룹 리터럴이 TS 상수와 일치한다", () => {
    expect(STUDIO_VOLUME_WGSL).toContain(`fn ${STUDIO_VOLUME_ENTRY_POINT}(`);
    expect(STUDIO_VOLUME_WGSL).toContain(
      `@workgroup_size(${STUDIO_VOLUME_WORKGROUP_X}, ${STUDIO_VOLUME_WORKGROUP_Y}, 1)`
    );
    expect(STUDIO_VOLUME_WGSL).toContain("@compute");
  });

  it("바인딩 인덱스가 표와 일치하고 중복이 없다", () => {
    const declared = new Map<number, string>();
    const pattern = /@group\(0\) @binding\((\d+)\) var<[^>]*>\s*(\w+)/g;
    let match = pattern.exec(STUDIO_VOLUME_WGSL);
    while (match) {
      const index = Number(match[1]);
      expect(declared.has(index)).toBe(false);
      declared.set(index, match[2]);
      match = pattern.exec(STUDIO_VOLUME_WGSL);
    }
    expect(declared.size).toBe(Object.keys(STUDIO_VOLUME_BINDINGS).length);
    expect(declared.get(STUDIO_VOLUME_BINDINGS.uniforms)).toBe("uni");
    expect(declared.get(STUDIO_VOLUME_BINDINGS.density)).toBe("densityField");
    expect(declared.get(STUDIO_VOLUME_BINDINGS.temperature)).toBe("temperatureField");
    expect(declared.get(STUDIO_VOLUME_BINDINGS.occupancy)).toBe("occupancyField");
    expect(declared.get(STUDIO_VOLUME_BINDINGS.emissionLut)).toBe("emissionLut");
    expect(declared.get(STUDIO_VOLUME_BINDINGS.lights)).toBe("lights");
    expect(declared.get(STUDIO_VOLUME_BINDINGS.output)).toBe("outputBuffer");
  });

  it("출력 버퍼만 read_write 이고 나머지는 읽기 전용이다", () => {
    expect(STUDIO_VOLUME_WGSL).toContain("var<storage, read_write> outputBuffer");
    const readWriteCount = STUDIO_VOLUME_WGSL.split("read_write").length - 1;
    expect(readWriteCount).toBe(1);
  });

  it("PCG 해시 상수가 TS 샘플러와 같다(GPU/CPU 난수 패리티)", () => {
    expect(STUDIO_VOLUME_WGSL).toContain("747796405u");
    expect(STUDIO_VOLUME_WGSL).toContain("2891336453u");
    expect(STUDIO_VOLUME_WGSL).toContain("277803737u");
    expect(STUDIO_VOLUME_WGSL).toContain("2.3283064365386963e-10");
  });

  it("물리 커널이 전부 이식되어 있다", () => {
    for (const symbol of [
      "fn sampleTrilinear",
      "fn henyeyGreenstein",
      "fn ratioTracking",
      "fn intersectBounds",
      "fn blockOccupied",
      "fn emissionRadiance",
      "fn ignitionGate",
    ]) {
      expect(STUDIO_VOLUME_WGSL).toContain(symbol);
    }
  });

  it("러시안 룰렛 상수가 CPU 구현과 같다", async () => {
    const cpu = await import("./studio-volume-transmittance");
    expect(STUDIO_VOLUME_WGSL).toContain(
      `const RR_THRESHOLD : f32 = ${cpu.STUDIO_VOLUME_RR_THRESHOLD};`
    );
    expect(STUDIO_VOLUME_WGSL).toContain(
      `const RR_KILL : f32 = ${cpu.STUDIO_VOLUME_RR_KILL_PROBABILITY};`
    );
  });

  it("1/4π 상수가 CPU 위상함수와 일치한다", async () => {
    const phase = await import("./studio-volume-phase");
    const match = /const INV_FOUR_PI : f32 = ([\d.e-]+);/.exec(STUDIO_VOLUME_WGSL);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeCloseTo(phase.STUDIO_VOLUME_ISOTROPIC_PHASE, 15);
  });

  it("중괄호가 균형을 이룬다(잘린 소스 방지)", () => {
    let depth = 0;
    for (const ch of STUDIO_VOLUME_WGSL) {
      if (ch === "{") depth += 1;
      if (ch === "}") depth -= 1;
      expect(depth).toBeGreaterThanOrEqual(0);
    }
    expect(depth).toBe(0);
  });

  it("WGSL 내장 이름(length/distance)을 값으로 가리지 않는다", () => {
    // `let length : f32 = ...` 같은 선언은 이후 length() 호출을 깨뜨린다.
    expect(STUDIO_VOLUME_WGSL).not.toMatch(/\blet length\s*:/);
    expect(STUDIO_VOLUME_WGSL).not.toMatch(/\bvar length\s*:/);
    // distance 는 point light 거리 변수로 쓰지만 그 뒤로 distance() 를 호출하지 않는다.
    expect(STUDIO_VOLUME_WGSL).not.toContain("distance(");
  });

  it("3.4e38 같은 f32 경계 리터럴 대신 FAR 상수를 쓴다", () => {
    expect(STUDIO_VOLUME_WGSL).toContain("const FAR : f32 = 1e30;");
    expect(STUDIO_VOLUME_WGSL).not.toContain("3.4e38");
  });

  it("유니폼 벡터를 런타임 인덱스로 읽지 않는다(드라이버 호환)", () => {
    const code = STUDIO_VOLUME_WGSL.replace(/\/\/[^\n]*/g, "");
    expect(code).not.toMatch(/uni\.\w+\[[a-z]/);
  });

  it("선언한 모듈 상수/함수에 죽은 코드가 없다", () => {
    const declared = [
      ...STUDIO_VOLUME_WGSL.matchAll(/^(?:fn|const) (\w+)/gm),
    ].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(8);
    for (const name of declared) {
      if (name === "main") continue;
      const uses = STUDIO_VOLUME_WGSL.split(new RegExp(`\\b${name}\\b`)).length - 1;
      expect(uses, `${name} 이 선언만 되고 쓰이지 않는다`).toBeGreaterThan(1);
    }
  });
});
