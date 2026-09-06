import { describe, expect, it } from "vitest";

import {
  defaultStudioVrmSpringBoneAuthoring,
  findStudioVrmSpringBonePreset,
  type StudioVrmSpringBoneAuthoring,
} from "./studio-vrm-springbone-authoring";
import {
  applyStudioVrmSpringBoneBindings,
  bindStudioVrmSpringBoneJoints,
  composeStudioVrmSpringBoneGravity,
  matchStudioVrmSpringBoneChain,
  measureStudioVrmSpringBoneRotations,
  settleStudioVrmSpringBoneRuntime,
  type SpringBoneJointLike,
  type SpringBoneVectorLike,
  type SpringBoneVrmLike,
} from "./studio-vrm-springbone-bridge";

/* ── three-vrm 대역(구조적 호환 페이크) ────────────────────────────── */

function makeVector(x = 0, y = -1, z = 0): SpringBoneVectorLike {
  return {
    x,
    y,
    z,
    set(nx: number, ny: number, nz: number) {
      this.x = nx;
      this.y = ny;
      this.z = nz;
      return this;
    },
  };
}

function makeJoint(name: string, parentName: string | null = null): SpringBoneJointLike {
  return {
    settings: {
      hitRadius: 0.05,
      stiffness: 1,
      gravityPower: 0.1,
      gravityDir: makeVector(),
      dragForce: 0.4,
    },
    bone: {
      name,
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      parent: parentName ? { name: parentName } : null,
    },
  };
}

interface FakeVrm extends SpringBoneVrmLike {
  resetCount: number;
  deltas: number[];
  jointList: SpringBoneJointLike[];
}

/**
 * three-vrm 대신 쓰는 결정적 페이크. update(delta) 는 현재 조인트 설정에서 유도한 목표 회전으로
 * 기하급수적으로 수렴한다(시계 접근 없음). 실제 VRMSpringBoneJoint 도 delta<=0 이면 아무것도 하지 않는다.
 */
function createFakeVrm(names: readonly (string | [string, string])[], options: { converge?: boolean } = {}): FakeVrm {
  const converge = options.converge ?? true;
  const jointList = names.map((entry) =>
    Array.isArray(entry) ? makeJoint(entry[0], entry[1]) : makeJoint(entry)
  );
  let tick = 0;
  const vrm: FakeVrm = {
    jointList,
    resetCount: 0,
    deltas: [],
    springBoneManager: {
      joints: jointList,
      reset() {
        vrm.resetCount += 1;
        for (const joint of jointList) joint.bone.quaternion = { x: 0, y: 0, z: 0, w: 1 };
      },
    },
    update(delta: number) {
      if (delta <= 0) return;
      vrm.deltas.push(delta);
      tick += 1;
      for (const joint of jointList) {
        const g = joint.settings.gravityDir;
        const target = converge
          ? { x: g.x * 0.3, y: g.y * 0.3, z: g.z * 0.3, w: 1 }
          : { x: tick % 2 === 0 ? 0.4 : -0.4, y: 0, z: 0, w: 1 };
        const k = converge ? Math.min(1, delta * 8) : 1;
        const q = joint.bone.quaternion;
        joint.bone.quaternion = {
          x: q.x + (target.x - q.x) * k,
          y: q.y + (target.y - q.y) * k,
          z: q.z + (target.z - q.z) * k,
          w: q.w + (target.w - q.w) * k,
        };
      }
    },
  };
  return vrm;
}

function windyAuthoring(): StudioVrmSpringBoneAuthoring {
  const authoring = defaultStudioVrmSpringBoneAuthoring();
  authoring.wind = {
    directionDeg: 0,
    elevationDeg: 0,
    strength: 0.5,
    turbulence: 0.8,
    seed: 4242,
    phase: 0,
    phaseStep: 0.3,
  };
  return authoring;
}

/* ── 본 이름 매칭 ───────────────────────────────────────────────────── */

describe("본 이름 → 체인 매칭", () => {
  const chains = defaultStudioVrmSpringBoneAuthoring().chains;

  it("VRoid 표준 명명과 한글 이름을 모두 잡는다", () => {
    expect(matchStudioVrmSpringBoneChain("J_Sec_Hair1_01", null, chains)?.id).toBe("longHair");
    expect(matchStudioVrmSpringBoneChain("Skirt_L_01", null, chains)?.id).toBe("skirt");
    expect(matchStudioVrmSpringBoneChain("치마_뒤_01", null, chains)?.id).toBe("skirt");
    expect(matchStudioVrmSpringBoneChain("Ribbon_R", null, chains)?.id).toBe("ribbon");
    expect(matchStudioVrmSpringBoneChain("Tail_03", null, chains)?.id).toBe("tail");
  });

  it("본 이름이 애매하면 부모 이름으로 보완한다", () => {
    expect(matchStudioVrmSpringBoneChain("01", "Skirt_Front", chains)?.id).toBe("skirt");
    expect(matchStudioVrmSpringBoneChain("_end", "Bang_C", chains)?.id).toBe("shortHair");
  });

  it("일반 단어 오탐이 없다 — 'Skirt_Front' 는 앞머리가 아니라 치마다", () => {
    expect(matchStudioVrmSpringBoneChain("Skirt_Front_01", null, chains)?.id).toBe("skirt");
  });

  it("체인 순서가 우선순위다 — 'SideHair' 는 'hair' 패턴을 가진 긴 머리에 먼저 걸린다", () => {
    expect(matchStudioVrmSpringBoneChain("SideHair_01", null, chains)?.id).toBe("longHair");
  });

  it("비활성 체인은 후보에서 빠진다", () => {
    const disabled = chains.map((chain) => (chain.id === "longHair" ? { ...chain, enabled: false } : chain));
    expect(matchStudioVrmSpringBoneChain("J_Sec_Hair1_01", null, disabled)?.id).toBeUndefined();
  });

  it("매칭되는 키워드가 없으면 null", () => {
    expect(matchStudioVrmSpringBoneChain("J_Bip_C_Spine", null, chains)).toBeNull();
  });
});

/* ── 바인딩 ─────────────────────────────────────────────────────────── */

describe("조인트 바인딩", () => {
  it("체인별로 조인트 인덱스를 매기고, 매칭 실패 조인트는 제외한다", () => {
    const vrm = createFakeVrm(["Hair_01", "Hair_02", "Skirt_01", "J_Bip_C_Spine"]);
    const bindings = bindStudioVrmSpringBoneJoints(vrm, defaultStudioVrmSpringBoneAuthoring());
    expect(bindings).toHaveLength(3);
    expect(bindings.map((b) => [b.chainId, b.jointIndex])).toEqual([
      ["longHair", 0],
      ["longHair", 1],
      ["skirt", 0],
    ]);
    // chainIndex 는 오써링 배열 순서(프리셋 순서)를 따른다.
    expect(bindings[2]!.chainIndex).toBe(2);
  });

  it("springBoneManager 가 없는 모델은 빈 배열", () => {
    const vrm: SpringBoneVrmLike = { update() {}, springBoneManager: null };
    expect(bindStudioVrmSpringBoneJoints(vrm, defaultStudioVrmSpringBoneAuthoring())).toEqual([]);
  });
});

/* ── 설정 적용 ──────────────────────────────────────────────────────── */

describe("오써링 → three-vrm 조인트 설정", () => {
  it("체인 수치를 그대로 기록하고, 매칭 안 된 조인트는 건드리지 않는다", () => {
    const vrm = createFakeVrm(["Hair_01", "J_Bip_C_Spine"]);
    const authoring = defaultStudioVrmSpringBoneAuthoring();
    const preset = findStudioVrmSpringBonePreset("longHair")!;
    const bindings = bindStudioVrmSpringBoneJoints(vrm, authoring);

    expect(applyStudioVrmSpringBoneBindings(bindings, authoring)).toBe(1);
    const hair = vrm.jointList[0]!.settings;
    expect(hair.stiffness).toBe(preset.tuning.stiffness);
    expect(hair.dragForce).toBe(preset.tuning.drag);
    expect(hair.hitRadius).toBe(preset.tuning.hitRadius);
    expect(hair.gravityPower).toBeCloseTo(preset.tuning.gravityPower, 12);
    expect(hair.gravityDir.y).toBeCloseTo(-1, 12);

    const spine = vrm.jointList[1]!.settings;
    expect(spine.stiffness).toBe(1);
    expect(spine.dragForce).toBe(0.4);
  });

  it("여러 번 적용해도 결과가 같다(멱등 — 배율 누적 없음)", () => {
    const vrm = createFakeVrm(["Hair_01"]);
    const authoring = windyAuthoring();
    const bindings = bindStudioVrmSpringBoneJoints(vrm, authoring);
    applyStudioVrmSpringBoneBindings(bindings, authoring, 7);
    const first = { ...vrm.jointList[0]!.settings, gravityDir: { ...vrm.jointList[0]!.settings.gravityDir } };
    applyStudioVrmSpringBoneBindings(bindings, authoring, 7);
    const second = vrm.jointList[0]!.settings;
    expect(second.gravityPower).toBe(first.gravityPower);
    expect(second.gravityDir.x).toBe(first.gravityDir.x);
    expect(second.gravityDir.y).toBe(first.gravityDir.y);
  });

  it("바람이 없으면 중력 방향/세기가 그대로 유지된다", () => {
    const authoring = defaultStudioVrmSpringBoneAuthoring();
    const chain = authoring.chains[0]!;
    const gravity = composeStudioVrmSpringBoneGravity(chain, authoring, 0, 0, 0);
    expect(gravity.dir[1]).toBeCloseTo(-1, 12);
    expect(gravity.power).toBeCloseTo(chain.gravityPower, 12);
  });

  it("중력 0 + 바람만이면 합성 중력이 바람 방향이 된다", () => {
    const authoring = defaultStudioVrmSpringBoneAuthoring();
    authoring.wind = { ...authoring.wind, directionDeg: 0, strength: 0.5, turbulence: 0 };
    const chain = { ...authoring.chains[0]!, gravityPower: 0, windScale: 1 };
    const gravity = composeStudioVrmSpringBoneGravity(chain, authoring, 0, 0, 0);
    expect(gravity.dir[0]).toBeCloseTo(1, 9);
    expect(gravity.power).toBeCloseTo(0.5, 9);
  });

  it("중력·바람이 모두 0 이면 안전한 기본 방향으로 떨어진다", () => {
    const authoring = defaultStudioVrmSpringBoneAuthoring();
    const chain = { ...authoring.chains[0]!, gravityPower: 0 };
    const gravity = composeStudioVrmSpringBoneGravity(chain, authoring, 0, 0, 0);
    expect(gravity.power).toBe(0);
    expect(gravity.dir).toEqual([0, -1, 0]);
  });

  it("전역 스위치를 끄면 바람이 합성되지 않는다", () => {
    const authoring = windyAuthoring();
    authoring.enabled = false;
    const chain = { ...authoring.chains[0]!, gravityPower: 0 };
    expect(composeStudioVrmSpringBoneGravity(chain, authoring, 3, 0, 0).power).toBe(0);
  });

  it("돌풍은 스텝 인덱스에 따라 달라지지만 같은 스텝이면 항상 같다", () => {
    const authoring = windyAuthoring();
    const chain = authoring.chains[0]!;
    const a = composeStudioVrmSpringBoneGravity(chain, authoring, 3, 0, 0);
    const b = composeStudioVrmSpringBoneGravity(chain, authoring, 4, 0, 0);
    expect(a.power).not.toBeCloseTo(b.power, 6);
    expect(composeStudioVrmSpringBoneGravity(chain, authoring, 3, 0, 0)).toEqual(a);
  });
});

/* ── 런타임 정착 ────────────────────────────────────────────────────── */

describe("캡처 직전 런타임 정착", () => {
  it("reset 후 고정 dt 로만 전진하고, 수렴하면 상한 전에 멈춘다", () => {
    const vrm = createFakeVrm(["Hair_01", "Hair_02", "Skirt_01"]);
    const authoring = defaultStudioVrmSpringBoneAuthoring();
    const bindings = bindStudioVrmSpringBoneJoints(vrm, authoring);

    const report = settleStudioVrmSpringBoneRuntime(vrm, authoring, bindings);
    expect(report.applied).toBe(3);
    expect(report.settled).toBe(true);
    expect(report.steps).toBeGreaterThan(0);
    expect(report.steps).toBeLessThan(authoring.settle.maxSteps);
    expect(vrm.resetCount).toBe(1);
    // 모든 update 가 오써링의 고정 dt 로만 호출됐다 = 프레임 타이밍 의존 없음.
    expect(new Set(vrm.deltas)).toEqual(new Set([authoring.settle.dt]));
    expect(vrm.deltas).toHaveLength(report.steps);
  });

  it("같은 입력이면 같은 스텝 수·같은 최종 회전(캡처 재현)", () => {
    const authoring = windyAuthoring();
    const run = () => {
      const vrm = createFakeVrm(["Hair_01", "Hair_02", "Skirt_01"]);
      const bindings = bindStudioVrmSpringBoneJoints(vrm, authoring);
      const report = settleStudioVrmSpringBoneRuntime(vrm, authoring, bindings);
      return { report, rotations: measureStudioVrmSpringBoneRotations(bindings) };
    };
    const a = run();
    const b = run();
    expect(a.report).toEqual(b.report);
    expect(JSON.stringify(a.rotations)).toBe(JSON.stringify(b.rotations));
  });

  it("돌풍이 켜져 있으면 스텝마다 설정을 다시 밀어 넣는다", () => {
    const authoring = windyAuthoring();
    const vrm = createFakeVrm(["Hair_01"]);
    const bindings = bindStudioVrmSpringBoneJoints(vrm, authoring);
    const seen: number[] = [];
    const original = vrm.update.bind(vrm);
    vrm.update = (delta: number) => {
      seen.push(bindings[0]!.joint.settings.gravityPower);
      original(delta);
    };
    settleStudioVrmSpringBoneRuntime(vrm, authoring, bindings);
    expect(seen.length).toBeGreaterThan(2);
    expect(new Set(seen.map((v) => v.toFixed(9))).size).toBeGreaterThan(1);
  });

  it("돌풍이 꺼져 있으면 설정을 한 번만 적용한다(정상풍 = 정지점 존재)", () => {
    const authoring = defaultStudioVrmSpringBoneAuthoring();
    authoring.wind = { ...authoring.wind, strength: 0.4, turbulence: 0, phaseStep: 0 };
    const vrm = createFakeVrm(["Hair_01"]);
    const bindings = bindStudioVrmSpringBoneJoints(vrm, authoring);
    const seen: number[] = [];
    const original = vrm.update.bind(vrm);
    vrm.update = (delta: number) => {
      seen.push(bindings[0]!.joint.settings.gravityPower);
      original(delta);
    };
    settleStudioVrmSpringBoneRuntime(vrm, authoring, bindings);
    expect(new Set(seen.map((v) => v.toFixed(9))).size).toBe(1);
  });

  it("수렴하지 않으면 상한에서 멈추고 settled=false 로 보고한다", () => {
    const vrm = createFakeVrm(["Hair_01"], { converge: false });
    const authoring = defaultStudioVrmSpringBoneAuthoring();
    authoring.settle = { ...authoring.settle, maxSteps: 25 };
    const bindings = bindStudioVrmSpringBoneJoints(vrm, authoring);
    const report = settleStudioVrmSpringBoneRuntime(vrm, authoring, bindings);
    expect(report.steps).toBe(25);
    expect(report.settled).toBe(false);
  });

  it("흔들림 뼈가 없는 모델에서는 즉시 끝난다(update 호출 0회)", () => {
    let updates = 0;
    const vrm: SpringBoneVrmLike = {
      update() {
        updates += 1;
      },
      springBoneManager: null,
    };
    const report = settleStudioVrmSpringBoneRuntime(vrm, defaultStudioVrmSpringBoneAuthoring(), []);
    expect(report).toEqual({ steps: 0, maxDelta: 0, settled: true, applied: 0 });
    expect(updates).toBe(0);
  });

  it("오써링 체인에 매칭되지 않은 조인트도 정착 관측 대상에 포함된다", () => {
    const vrm = createFakeVrm(["J_Bip_C_Spine"]);
    const authoring = defaultStudioVrmSpringBoneAuthoring();
    const bindings = bindStudioVrmSpringBoneJoints(vrm, authoring);
    expect(bindings).toHaveLength(0);
    const report = settleStudioVrmSpringBoneRuntime(vrm, authoring, bindings);
    expect(report.applied).toBe(0);
    expect(report.steps).toBeGreaterThan(0);
    expect(report.settled).toBe(true);
  });
});
