import { describe, expect, it } from "vitest";

import {
  DEFAULT_SPRING_SETTLE,
  DEFAULT_SPRING_WIND,
  STUDIO_VRM_SPRINGBONE_PRESETS,
  STUDIO_VRM_SPRINGBONE_VERSION,
  applyStudioVrmSpringBonePreset,
  buildStudioVrmSpringBoneState,
  chainFromPreset,
  defaultStudioVrmSpringBoneAuthoring,
  findStudioVrmSpringBonePreset,
  normalizeStudioVrmSpringBoneAuthoring,
  parseStudioVrmSpringBoneAuthoring,
  patchStudioVrmSpringBoneChain,
  resolveStudioVrmSpringBoneColliders,
  serializeStudioVrmSpringBoneAuthoring,
  studioVrmSpringBoneWind,
  studioVrmSpringBoneWindDir,
  type StudioVrmSpringBoneRig,
} from "./studio-vrm-springbone-authoring";
import {
  settleStudioVrmSpringBonesUntilStable,
  studioVrmSpringBoneJointLengths,
} from "./studio-vrm-springbone-core";

const RIG: StudioVrmSpringBoneRig = {
  chains: [
    {
      chainId: "longHair",
      origin: [0, 1.4, 0],
      joints: [
        { name: "Hair_1", restDir: [0, -1, 0], length: 0.2 },
        { name: "Hair_2", restDir: [0, -1, 0], length: 0.2 },
        { name: "Hair_3", restDir: [0, -1, 0], length: 0.2 },
      ],
    },
    {
      chainId: "skirt",
      origin: [0, 0.8, 0],
      joints: [
        { name: "Skirt_1", restDir: [0, -1, 0], length: 0.15 },
        { name: "Skirt_2", restDir: [0, -1, 0], length: 0.15 },
      ],
    },
    {
      chainId: "unknown-chain",
      origin: [0, 0, 0],
      joints: [{ name: "Nope", restDir: [0, -1, 0], length: 0.1 }],
    },
  ],
};

describe("프리셋", () => {
  it("한글 라벨을 가진 프리셋 6종을 제공한다", () => {
    expect(STUDIO_VRM_SPRINGBONE_PRESETS.map((preset) => preset.label)).toEqual([
      "긴 머리",
      "짧은 머리",
      "치마",
      "리본",
      "망토",
      "꼬리",
    ]);
  });

  it("모든 프리셋 수치가 문서화된 안전 범위 안에 있다", () => {
    for (const preset of STUDIO_VRM_SPRINGBONE_PRESETS) {
      expect(preset.note.length).toBeGreaterThan(10);
      expect(preset.tuning.stiffness).toBeGreaterThan(0);
      expect(preset.tuning.stiffness).toBeLessThanOrEqual(4);
      // drag 0.35 이상 = 60스텝(1초) 안에 정착한다는 프리셋 설계 계약.
      expect(preset.tuning.drag).toBeGreaterThanOrEqual(0.35);
      expect(preset.tuning.drag).toBeLessThan(1);
      expect(preset.tuning.gravityPower).toBeGreaterThanOrEqual(0);
      expect(preset.tuning.hitRadius).toBeGreaterThan(0);
      expect(preset.bonePatterns.length).toBeGreaterThan(0);
    }
  });

  it("프리셋별 성격이 설명대로다 — 긴 머리가 짧은 머리보다 무겁고 무르며, 리본이 바람에 가장 민감하다", () => {
    const long = findStudioVrmSpringBonePreset("longHair")!;
    const short = findStudioVrmSpringBonePreset("shortHair")!;
    const skirt = findStudioVrmSpringBonePreset("skirt")!;
    const ribbon = findStudioVrmSpringBonePreset("ribbon")!;
    expect(long.tuning.stiffness).toBeLessThan(short.tuning.stiffness);
    expect(long.tuning.gravityPower).toBeGreaterThan(short.tuning.gravityPower);
    expect(skirt.tuning.gravityPower).toBeGreaterThanOrEqual(long.tuning.gravityPower);
    expect(skirt.tuning.hitRadius).toBeGreaterThan(long.tuning.hitRadius);
    const maxWind = Math.max(...STUDIO_VRM_SPRINGBONE_PRESETS.map((p) => p.tuning.windScale));
    expect(ribbon.tuning.windScale).toBe(maxWind);
  });

  it("알 수 없는 프리셋 id 는 null", () => {
    expect(findStudioVrmSpringBonePreset("nope")).toBeNull();
  });

  it("프리셋 적용은 수치만 덮고 라벨/패턴은 유지한다", () => {
    const chain = { ...chainFromPreset(findStudioVrmSpringBonePreset("longHair")!), label: "내 머리", stiffness: 3.9 };
    const applied = applyStudioVrmSpringBonePreset(chain, "skirt");
    expect(applied.label).toBe("내 머리");
    expect(applied.presetId).toBe("skirt");
    expect(applied.stiffness).toBe(findStudioVrmSpringBonePreset("skirt")!.tuning.stiffness);
  });

  it("수치를 직접 만지면 presetId 가 custom 으로 떨어진다", () => {
    const chain = chainFromPreset(findStudioVrmSpringBonePreset("ribbon")!);
    expect(patchStudioVrmSpringBoneChain(chain, { label: "리본2" }).presetId).toBe("ribbon");
    expect(patchStudioVrmSpringBoneChain(chain, { stiffness: 2 }).presetId).toBe("custom");
  });
});

describe("정규화", () => {
  it("기본 설정은 프리셋 전부를 켜고 바람은 꺼져 있다", () => {
    const authoring = defaultStudioVrmSpringBoneAuthoring();
    expect(authoring.version).toBe(STUDIO_VRM_SPRINGBONE_VERSION);
    expect(authoring.chains).toHaveLength(STUDIO_VRM_SPRINGBONE_PRESETS.length);
    expect(authoring.chains.every((chain) => chain.enabled)).toBe(true);
    expect(authoring.wind).toEqual(DEFAULT_SPRING_WIND);
    expect(authoring.wind.strength).toBe(0);
    // 기본 phaseStep 0 = 캡처 정착 결정성 보장.
    expect(authoring.wind.phaseStep).toBe(0);
    expect(authoring.settle).toEqual(DEFAULT_SPRING_SETTLE);
  });

  it("범위를 벗어난 값은 잘린다", () => {
    const parsed = normalizeStudioVrmSpringBoneAuthoring({
      chains: [{ id: "longHair", presetId: "longHair", stiffness: 999, drag: -3, gravityPower: 50, hitRadius: 9, windScale: -1 }],
      wind: { directionDeg: 900, elevationDeg: -900, strength: 99, turbulence: 5, phaseStep: 9 },
      settle: { dt: 100, steps: -50, epsilon: 100, maxSteps: 999999 },
    });
    const chain = parsed.chains[0]!;
    expect(chain.stiffness).toBe(4);
    expect(chain.drag).toBe(0);
    expect(chain.gravityPower).toBe(2);
    expect(chain.hitRadius).toBe(0.5);
    expect(chain.windScale).toBe(0);
    expect(parsed.wind.directionDeg).toBe(180);
    expect(parsed.wind.elevationDeg).toBe(-90);
    expect(parsed.wind.strength).toBe(2);
    expect(parsed.wind.turbulence).toBe(1);
    expect(parsed.wind.phaseStep).toBe(1);
    expect(parsed.settle.dt).toBeCloseTo(1 / 10, 12);
    expect(parsed.settle.steps).toBe(0);
    expect(parsed.settle.maxSteps).toBe(5000);
  });

  it("NaN/Infinity/타입 오류는 기본값으로 흡수된다", () => {
    const parsed = normalizeStudioVrmSpringBoneAuthoring({
      enabled: "yes",
      chains: [{ id: 42, presetId: "longHair", stiffness: Number.NaN, drag: Number.POSITIVE_INFINITY, gravityDir: "down" }],
      wind: { seed: Number.NaN, phase: "x" },
    });
    const preset = findStudioVrmSpringBonePreset("longHair")!;
    expect(parsed.enabled).toBe(true);
    expect(parsed.chains[0]!.id).toBe("longHair");
    expect(parsed.chains[0]!.stiffness).toBe(preset.tuning.stiffness);
    expect(parsed.chains[0]!.drag).toBe(preset.tuning.drag);
    expect(parsed.chains[0]!.gravityDir).toEqual([0, -1, 0]);
    expect(parsed.wind.seed).toBe(DEFAULT_SPRING_WIND.seed);
    expect(parsed.wind.phase).toBe(0);
  });

  it("빈 bonePatterns 는 프리셋 키워드로 되돌아간다", () => {
    const parsed = normalizeStudioVrmSpringBoneAuthoring({
      chains: [{ id: "skirt", presetId: "skirt", bonePatterns: [] }],
    });
    expect(parsed.chains[0]!.bonePatterns).toEqual([...findStudioVrmSpringBonePreset("skirt")!.bonePatterns]);
  });

  it("bonePatterns 는 소문자화·중복 제거된다", () => {
    const parsed = normalizeStudioVrmSpringBoneAuthoring({
      chains: [{ id: "skirt", presetId: "skirt", bonePatterns: [" Skirt ", "SKIRT", "치마", 7] }],
    });
    expect(parsed.chains[0]!.bonePatterns).toEqual(["skirt", "치마"]);
  });
});

describe("파싱 / 직렬화", () => {
  it("손상 입력은 전부 기본값으로 흡수되고 절대 throw 하지 않는다", () => {
    const fallback = defaultStudioVrmSpringBoneAuthoring();
    for (const bad of [null, undefined, "", "{", "[]}", 42, true, Number.NaN, [], () => 1]) {
      const parsed = parseStudioVrmSpringBoneAuthoring(bad);
      expect(parsed.version).toBe(STUDIO_VRM_SPRINGBONE_VERSION);
      expect(parsed.chains.length).toBeGreaterThan(0);
      expect(parsed.wind).toEqual(fallback.wind);
    }
  });

  it("JSON 문자열도 그대로 받는다", () => {
    const authoring = defaultStudioVrmSpringBoneAuthoring();
    authoring.wind.strength = 0.8;
    const json = serializeStudioVrmSpringBoneAuthoring(authoring);
    expect(parseStudioVrmSpringBoneAuthoring(json).wind.strength).toBe(0.8);
  });

  it("직렬화 → 파싱 왕복이 값을 보존한다", () => {
    const authoring = defaultStudioVrmSpringBoneAuthoring();
    authoring.enabled = true;
    authoring.chains[0]!.stiffness = 1.25;
    authoring.chains[0]!.presetId = "custom";
    authoring.chains[2]!.enabled = false;
    authoring.wind = { directionDeg: -35, elevationDeg: 12, strength: 1.4, turbulence: 0.6, seed: 777, phase: 0.25, phaseStep: 0.05 };
    authoring.colliders = [
      { id: "head", label: "머리 콜라이더", enabled: true, kind: "sphere", offset: [0, 1.5, 0], tail: [0, 0, 0], radius: 0.12, inside: false },
      { id: "leg", label: "다리 콜라이더", enabled: false, kind: "capsule", offset: [0, 0.8, 0], tail: [0, 0.1, 0], radius: 0.09, inside: false },
    ];

    const round = parseStudioVrmSpringBoneAuthoring(serializeStudioVrmSpringBoneAuthoring(authoring));
    expect(round).toEqual(normalizeStudioVrmSpringBoneAuthoring(authoring));
    expect(round.colliders).toHaveLength(2);
    expect(round.colliders[1]!.kind).toBe("capsule");
    expect(round.colliders[1]!.enabled).toBe(false);

    // 두 번 왕복해도 같다(정규화가 멱등).
    expect(serializeStudioVrmSpringBoneAuthoring(round)).toBe(serializeStudioVrmSpringBoneAuthoring(authoring));
  });

  it("콜라이더 파싱은 알 수 없는 kind 를 sphere 로 떨어뜨린다", () => {
    const parsed = parseStudioVrmSpringBoneAuthoring({ colliders: [{ kind: "torus" }, {}] });
    expect(parsed.colliders.map((c) => c.kind)).toEqual(["sphere", "sphere"]);
    expect(parsed.colliders[0]!.id).toBe("collider-1");
    expect(parsed.colliders[1]!.id).toBe("collider-2");
  });
});

describe("바람 벡터", () => {
  it("0° = +X, 90° = +Z", () => {
    const east = studioVrmSpringBoneWindDir({ ...DEFAULT_SPRING_WIND, directionDeg: 0 });
    expect(east.x).toBeCloseTo(1, 9);
    expect(east.z).toBeCloseTo(0, 9);
    const north = studioVrmSpringBoneWindDir({ ...DEFAULT_SPRING_WIND, directionDeg: 90 });
    expect(north.z).toBeCloseTo(1, 9);
    expect(north.x).toBeCloseTo(0, 9);
  });

  it("고도각 90° 는 위로 부는 바람", () => {
    const up = studioVrmSpringBoneWindDir({ ...DEFAULT_SPRING_WIND, elevationDeg: 90 });
    expect(up.y).toBeCloseTo(1, 9);
  });

  it("체인 windScale 이 바람 세기에 곱해진다", () => {
    const wind = studioVrmSpringBoneWind({ ...DEFAULT_SPRING_WIND, strength: 0.5 }, 1.6);
    expect(wind.strength).toBeCloseTo(0.8, 12);
  });
});

describe("오써링 → 시뮬레이션 상태", () => {
  it("활성 체인만, 리그 순서대로 상태를 만든다", () => {
    const authoring = defaultStudioVrmSpringBoneAuthoring();
    const state = buildStudioVrmSpringBoneState(authoring, RIG);
    // unknown-chain 은 오써링에 없어서 제외된다.
    expect(state.chains.map((chain) => chain.def.id)).toEqual(["longHair", "skirt"]);
    expect(state.chains[0]!.joints).toHaveLength(3);
    expect(state.chains[0]!.def.origin).toEqual({ x: 0, y: 1.4, z: 0 });
  });

  it("비활성 체인은 시뮬레이션에서 빠진다", () => {
    const authoring = defaultStudioVrmSpringBoneAuthoring();
    authoring.chains.find((chain) => chain.id === "skirt")!.enabled = false;
    const state = buildStudioVrmSpringBoneState(authoring, RIG);
    expect(state.chains.map((chain) => chain.def.id)).toEqual(["longHair"]);
  });

  it("체인 수치가 조인트 설정으로 전파된다", () => {
    const authoring = defaultStudioVrmSpringBoneAuthoring();
    const preset = findStudioVrmSpringBonePreset("longHair")!;
    const state = buildStudioVrmSpringBoneState(authoring, RIG);
    const joint = state.chains[0]!.def.joints[0]!;
    expect(joint.settings.stiffness).toBe(preset.tuning.stiffness);
    expect(joint.settings.drag).toBe(preset.tuning.drag);
    expect(joint.settings.gravityPower).toBe(preset.tuning.gravityPower);
    expect(joint.settings.hitRadius).toBe(preset.tuning.hitRadius);
  });

  it("활성 콜라이더만 좌표계 그대로 넘어간다", () => {
    const authoring = defaultStudioVrmSpringBoneAuthoring();
    authoring.colliders = [
      { id: "a", label: "머리", enabled: true, kind: "sphere", offset: [0, 1.5, 0], tail: [0, 0, 0], radius: 0.12, inside: false },
      { id: "b", label: "꺼짐", enabled: false, kind: "sphere", offset: [1, 1, 1], tail: [0, 0, 0], radius: 0.2, inside: false },
      { id: "c", label: "다리", enabled: true, kind: "capsule", offset: [0, 0.8, 0], tail: [0, 0.1, 0], radius: 0.09, inside: true },
    ];
    const colliders = resolveStudioVrmSpringBoneColliders(authoring);
    expect(colliders).toHaveLength(2);
    expect(colliders[0]).toEqual({ kind: "sphere", center: { x: 0, y: 1.5, z: 0 }, radius: 0.12, inside: false });
    expect(colliders[1]).toEqual({
      kind: "capsule",
      head: { x: 0, y: 0.8, z: 0 },
      tail: { x: 0, y: 0.1, z: 0 },
      radius: 0.09,
      inside: true,
    });
  });

  it("enabled=false 전역 스위치는 바람을 0 으로 만든다", () => {
    const authoring = defaultStudioVrmSpringBoneAuthoring();
    authoring.enabled = false;
    authoring.wind.strength = 2;
    expect(buildStudioVrmSpringBoneState(authoring, RIG).wind.strength).toBe(0);
  });

  it("프리셋 계약대로 60스텝(1초) 안에 정착하고 길이를 유지한다", () => {
    const authoring = defaultStudioVrmSpringBoneAuthoring();
    const state = buildStudioVrmSpringBoneState(authoring, RIG);
    const report = settleStudioVrmSpringBonesUntilStable(state, { epsilon: 1e-4, maxSteps: 60 });
    expect(report.settled).toBe(true);
    for (const chain of state.chains) {
      const lengths = studioVrmSpringBoneJointLengths(chain);
      chain.def.joints.forEach((joint, i) => {
        expect(Math.abs(lengths[i]! - joint.length)).toBeLessThan(1e-9);
      });
    }
  });

  it("리그가 비어 있으면 빈 상태를 만든다(모델에 흔들림 뼈가 없을 때)", () => {
    const state = buildStudioVrmSpringBoneState(defaultStudioVrmSpringBoneAuthoring(), { chains: [] });
    expect(state.chains).toEqual([]);
  });
});
