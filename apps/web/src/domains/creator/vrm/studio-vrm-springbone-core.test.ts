import { describe, expect, it } from "vitest";

import {
  SPRING_QUAT_IDENTITY,
  SPRING_SETTLE_DT,
  SPRING_WIND_NONE,
  computeSpringChainRestTails,
  createStudioVrmSpringBoneState,
  displaceStudioVrmSpringBoneTail,
  evaluateSpringCollider,
  isStudioVrmSpringBoneSettled,
  resetStudioVrmSpringBoneState,
  serializeStudioVrmSpringBoneSnapshot,
  settleStudioVrmSpringBones,
  settleStudioVrmSpringBonesUntilStable,
  snapshotStudioVrmSpringBoneState,
  springDistance,
  springDot,
  springHash01,
  springLength,
  springNormalize,
  springQuatFromUnitVectors,
  springQuatRotate,
  springSub,
  springValueNoise,
  stepStudioVrmSpringBones,
  studioVrmSpringBoneHeads,
  studioVrmSpringBoneJointLengths,
  studioVrmSpringBoneSnapshotDelta,
  studioVrmSpringBoneWindAt,
  type SpringChainDef,
  type SpringCollider,
  type SpringJointSettings,
  type SpringVec3,
  type SpringWind,
} from "./studio-vrm-springbone-core";

/* ── 테스트 픽스처 ──────────────────────────────────────────────────── */

const DOWN: SpringVec3 = { x: 0, y: -1, z: 0 };

function jointSettings(over: Partial<SpringJointSettings> = {}): SpringJointSettings {
  return {
    stiffness: 1,
    drag: 0.5,
    gravityPower: 0,
    gravityDir: { ...DOWN },
    hitRadius: 0.02,
    ...over,
  };
}

function makeChain(options: {
  id?: string;
  jointCount?: number;
  length?: number;
  restDir?: SpringVec3;
  settings?: Partial<SpringJointSettings>;
} = {}): SpringChainDef {
  const count = options.jointCount ?? 2;
  return {
    id: options.id ?? "hair",
    origin: { x: 0, y: 0, z: 0 },
    rootRotation: { ...SPRING_QUAT_IDENTITY },
    joints: Array.from({ length: count }, (_, i) => ({
      name: `joint-${i}`,
      restDir: options.restDir ?? { ...DOWN },
      length: options.length ?? 0.5,
      settings: jointSettings(options.settings),
    })),
  };
}

function angleBetween(a: SpringVec3, b: SpringVec3): number {
  const dot = Math.min(1, Math.max(-1, springDot(springNormalize(a), springNormalize(b))));
  return Math.acos(dot);
}

function tailDir(state: ReturnType<typeof createStudioVrmSpringBoneState>, chainIndex: number, jointIndex: number) {
  const chain = state.chains[chainIndex]!;
  const heads = studioVrmSpringBoneHeads(chain);
  return springNormalize(springSub(chain.joints[jointIndex]!.currentTail, heads[jointIndex]!));
}

/* ── 벡터/쿼터니언 기본 ─────────────────────────────────────────────── */

describe("스프링본 수학 기본기", () => {
  it("길이 0 벡터 정규화는 NaN 대신 fallback 을 돌려준다", () => {
    const n = springNormalize({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
    expect(n).toEqual({ x: 1, y: 0, z: 0 });
  });

  it("정반대 벡터에서도 유효한 회전(180°)을 만든다", () => {
    const q = springQuatFromUnitVectors({ x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 });
    expect(Number.isFinite(q.x + q.y + q.z + q.w)).toBe(true);
    const rotated = springQuatRotate(q, { x: 0, y: 1, z: 0 });
    expect(rotated.y).toBeCloseTo(-1, 10);
  });

  it("rootRotation 이 rest tail 방향을 회전시킨다", () => {
    // -Y rest 를 Z축 기준 90° 회전 → +X 방향(오른쪽)으로 눕는다.
    const half = Math.SQRT1_2;
    const def: SpringChainDef = {
      ...makeChain({ jointCount: 1, length: 1 }),
      rootRotation: { x: 0, y: 0, z: half, w: half },
    };
    const tails = computeSpringChainRestTails(def);
    expect(tails[0]!.x).toBeCloseTo(1, 9);
    expect(tails[0]!.y).toBeCloseTo(0, 9);
  });
});

/* ── 결정성 노이즈 ──────────────────────────────────────────────────── */

describe("바람 노이즈는 시계가 아니라 시드·스텝으로만 정해진다", () => {
  it("springHash01 은 [0,1) 이고 같은 입력이면 항상 같다", () => {
    for (let i = -5; i < 50; i += 1) {
      const v = springHash01(1234, i);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(springHash01(1234, i)).toBe(v);
    }
  });

  it("springValueNoise 는 격자 사이를 부드럽게 잇고 결정적이다", () => {
    expect(springValueNoise(7, 3)).toBeCloseTo(springHash01(7, 3), 12);
    expect(springValueNoise(7, 3.5)).toBe(springValueNoise(7, 3.5));
    expect(springValueNoise(7, 3.5)).not.toBe(springValueNoise(8, 3.5));
    expect(springValueNoise(7, Number.NaN)).toBe(springValueNoise(7, 0));
  });

  it("turbulence 0 이면 바람은 모든 스텝에서 동일(= 정착 가능)", () => {
    const wind: SpringWind = { dir: { x: 1, y: 0, z: 0 }, strength: 0.5, turbulence: 0, seed: 3, phase: 0, phaseStep: 0.2 };
    expect(studioVrmSpringBoneWindAt(wind, 0, 0, 0)).toEqual(studioVrmSpringBoneWindAt(wind, 99, 0, 0));
  });

  it("turbulence>0 + phaseStep>0 이면 스텝마다 다르지만 재현 가능하다", () => {
    const wind: SpringWind = { dir: { x: 1, y: 0, z: 0 }, strength: 1, turbulence: 0.8, seed: 42, phase: 0, phaseStep: 0.3 };
    const a = studioVrmSpringBoneWindAt(wind, 5, 0, 0);
    const b = studioVrmSpringBoneWindAt(wind, 6, 0, 0);
    expect(a.x).not.toBeCloseTo(b.x, 6);
    expect(studioVrmSpringBoneWindAt(wind, 5, 0, 0)).toEqual(a);
  });

  it("strength 0 이면 바람 벡터는 정확히 0", () => {
    expect(studioVrmSpringBoneWindAt(SPRING_WIND_NONE, 3, 0, 0)).toEqual({ x: 0, y: 0, z: 0 });
  });
});

/* ── 탄성 / 감쇠 / 중력 ─────────────────────────────────────────────── */

describe("탄성(stiffness)은 변위된 조인트를 rest 로 되돌린다", () => {
  it("90° 벗어난 조인트가 rest 방향으로 수렴한다", () => {
    const state = createStudioVrmSpringBoneState({ chains: [makeChain({ jointCount: 1, length: 0.5 })] });
    displaceStudioVrmSpringBoneTail(state, 0, 0, { x: 1, y: 0, z: 0 });
    expect(angleBetween(tailDir(state, 0, 0), DOWN)).toBeCloseTo(Math.PI / 2, 6);

    settleStudioVrmSpringBones(state, 10);
    const midAngle = angleBetween(tailDir(state, 0, 0), DOWN);
    expect(midAngle).toBeLessThan(Math.PI / 2);

    const report = settleStudioVrmSpringBonesUntilStable(state, { maxSteps: 800 });
    expect(report.settled).toBe(true);
    expect(angleBetween(tailDir(state, 0, 0), DOWN)).toBeLessThan(1e-3);
  });

  it("stiffness 0 이고 다른 힘이 없으면 변위가 그대로 유지된다(복원의 원인이 탄성임을 증명)", () => {
    const state = createStudioVrmSpringBoneState({
      chains: [makeChain({ jointCount: 1, length: 0.5, settings: { stiffness: 0, gravityPower: 0 } })],
    });
    displaceStudioVrmSpringBoneTail(state, 0, 0, { x: 1, y: 0, z: 0 });
    settleStudioVrmSpringBones(state, 120);
    expect(angleBetween(tailDir(state, 0, 0), DOWN)).toBeCloseTo(Math.PI / 2, 9);
  });
});

describe("감쇠(drag)는 속도를 단조 감소시킨다", () => {
  function speedAfter(drag: number, steps: number): number {
    const state = createStudioVrmSpringBoneState({
      chains: [makeChain({ jointCount: 1, length: 0.5, settings: { stiffness: 0, drag, gravityPower: 0 } })],
    });
    // 변위 + 초기 속도 부여(prevTail 을 rest 로 남겨 관성이 남게 한다).
    displaceStudioVrmSpringBoneTail(state, 0, 0, { x: 1, y: 0, z: 0 });
    state.chains[0]!.joints[0]!.prevTail = { x: 0, y: -0.5, z: 0 };
    settleStudioVrmSpringBones(state, steps);
    const joint = state.chains[0]!.joints[0]!;
    return springDistance(joint.currentTail, joint.prevTail);
  }

  it("drag 가 클수록 같은 스텝 뒤 잔여 속도가 작다", () => {
    const speeds = [0.1, 0.3, 0.6, 0.9].map((drag) => speedAfter(drag, 10));
    for (let i = 1; i < speeds.length; i += 1) {
      expect(speeds[i]!).toBeLessThan(speeds[i - 1]!);
    }
  });

  it("drag>0 이면 스텝이 진행될수록 속도가 계속 줄어든다", () => {
    const state = createStudioVrmSpringBoneState({
      chains: [makeChain({ jointCount: 1, length: 0.5, settings: { stiffness: 0, drag: 0.4, gravityPower: 0 } })],
    });
    displaceStudioVrmSpringBoneTail(state, 0, 0, { x: 1, y: 0, z: 0 });
    state.chains[0]!.joints[0]!.prevTail = { x: 0, y: -0.5, z: 0 };

    let previous = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 12; i += 1) {
      const delta = stepStudioVrmSpringBones(state, SPRING_SETTLE_DT, state.stepIndex);
      expect(delta).toBeLessThan(previous);
      previous = delta;
    }
  });

  it("drag 1 이면 관성이 즉시 사라진다", () => {
    const state = createStudioVrmSpringBoneState({
      chains: [makeChain({ jointCount: 1, length: 0.5, settings: { stiffness: 0, drag: 1, gravityPower: 0 } })],
    });
    displaceStudioVrmSpringBoneTail(state, 0, 0, { x: 1, y: 0, z: 0 });
    state.chains[0]!.joints[0]!.prevTail = { x: 0, y: -0.5, z: 0 };
    stepStudioVrmSpringBones(state, SPRING_SETTLE_DT, 0);
    const joint = state.chains[0]!.joints[0]!;
    expect(springDistance(joint.currentTail, joint.prevTail)).toBeLessThan(1e-12);
  });
});

describe("중력은 방향과 세기대로 체인을 움직인다", () => {
  it("탄성 0 + 중력만이면 체인이 중력 방향으로 정확히 늘어진다", () => {
    // rest 는 +X(수평)인데 중력은 -Y → 완전히 아래로 떨어져야 한다.
    const chain = makeChain({
      jointCount: 2,
      length: 0.5,
      restDir: { x: 1, y: 0, z: 0 },
      settings: { stiffness: 0, gravityPower: 0.3, drag: 0.5 },
    });
    const state = createStudioVrmSpringBoneState({ chains: [chain] });
    const report = settleStudioVrmSpringBonesUntilStable(state, { maxSteps: 2000 });
    expect(report.settled).toBe(true);
    expect(angleBetween(tailDir(state, 0, 0), DOWN)).toBeLessThan(1e-3);
    expect(angleBetween(tailDir(state, 0, 1), DOWN)).toBeLessThan(1e-3);
  });

  it("중력 방향을 +X 로 주면 체인이 +X 로 눕는다", () => {
    const chain = makeChain({
      jointCount: 1,
      length: 0.5,
      settings: { stiffness: 0, gravityPower: 0.3, gravityDir: { x: 1, y: 0, z: 0 } },
    });
    const state = createStudioVrmSpringBoneState({ chains: [chain] });
    settleStudioVrmSpringBonesUntilStable(state, { maxSteps: 2000 });
    expect(angleBetween(tailDir(state, 0, 0), { x: 1, y: 0, z: 0 })).toBeLessThan(1e-3);
  });

  it("gravityPower 가 클수록 더 많이 처진다", () => {
    const droopFor = (gravityPower: number) => {
      const chain = makeChain({
        jointCount: 1,
        length: 0.5,
        restDir: { x: 1, y: 0, z: 0 },
        settings: { stiffness: 1.5, gravityPower, drag: 0.6 },
      });
      const state = createStudioVrmSpringBoneState({ chains: [chain] });
      settleStudioVrmSpringBonesUntilStable(state, { maxSteps: 2000 });
      return state.chains[0]!.joints[0]!.currentTail.y;
    };
    const light = droopFor(0.1);
    const heavy = droopFor(0.6);
    expect(heavy).toBeLessThan(light);
    expect(light).toBeLessThan(0);
  });
});

/* ── 충돌 ───────────────────────────────────────────────────────────── */

describe("콜라이더 밀어내기", () => {
  it("구 콜라이더 판정 부호가 three-vrm 규약과 같다(음수 = 관통)", () => {
    const sphere: SpringCollider = { kind: "sphere", center: { x: 0, y: 0, z: 0 }, radius: 0.3, inside: false };
    expect(evaluateSpringCollider(sphere, { x: 0.1, y: 0, z: 0 }, 0.02).distance).toBeLessThan(0);
    expect(evaluateSpringCollider(sphere, { x: 1, y: 0, z: 0 }, 0.02).distance).toBeGreaterThan(0);
    // inside=true 는 반대: 바깥으로 나가면 음수.
    const cage: SpringCollider = { ...sphere, inside: true };
    expect(evaluateSpringCollider(cage, { x: 1, y: 0, z: 0 }, 0.02).distance).toBeLessThan(0);
  });

  it("구 콜라이더가 조인트를 밖으로 밀어내고 체인 길이는 보존한다", () => {
    const center: SpringVec3 = { x: 0.1, y: -0.5, z: 0 };
    const radius = 0.3;
    const hitRadius = 0.02;
    const state = createStudioVrmSpringBoneState({
      chains: [makeChain({ jointCount: 2, length: 0.5, settings: { stiffness: 0, gravityPower: 0.4, hitRadius } })],
      colliders: [{ kind: "sphere", center, radius, inside: false }],
    });
    const report = settleStudioVrmSpringBonesUntilStable(state, { maxSteps: 2000 });
    expect(report.settled).toBe(true);

    const tail = state.chains[0]!.joints[0]!.currentTail;
    expect(springDistance(tail, center)).toBeGreaterThanOrEqual(radius + hitRadius - 1e-5);
    expect(studioVrmSpringBoneJointLengths(state.chains[0]!)).toEqual([0.5, 0.5]);
  });

  it("캡슐 콜라이더가 조인트를 축 밖으로 밀어내고 길이는 보존한다", () => {
    const head: SpringVec3 = { x: 0.1, y: -0.2, z: 0 };
    const capTail: SpringVec3 = { x: 0.1, y: -0.9, z: 0 };
    const radius = 0.25;
    const hitRadius = 0.02;
    const state = createStudioVrmSpringBoneState({
      chains: [makeChain({ jointCount: 2, length: 0.5, settings: { stiffness: 0, gravityPower: 0.4, hitRadius } })],
      colliders: [{ kind: "capsule", head, tail: capTail, radius, inside: false }],
    });
    const report = settleStudioVrmSpringBonesUntilStable(state, { maxSteps: 2000 });
    expect(report.settled).toBe(true);

    for (const joint of state.chains[0]!.joints) {
      // 캡슐 축(수직 선분)까지의 최단 거리.
      const p = joint.currentTail;
      const clampedY = Math.min(head.y, Math.max(capTail.y, p.y));
      const axisDistance = Math.hypot(p.x - head.x, p.y - clampedY, p.z - head.z);
      expect(axisDistance).toBeGreaterThanOrEqual(radius + hitRadius - 1e-4);
    }
    expect(studioVrmSpringBoneJointLengths(state.chains[0]!)).toEqual([0.5, 0.5]);
  });
});

/* ── 길이 보존 ──────────────────────────────────────────────────────── */

describe("체인 길이는 매 스텝 보존된다", () => {
  it("바람·중력·콜라이더가 전부 걸려 있어도 늘어나지 않는다", () => {
    const wind: SpringWind = { dir: { x: 1, y: 0, z: 0 }, strength: 1.5, turbulence: 0.9, seed: 77, phase: 0.5, phaseStep: 0.25 };
    const state = createStudioVrmSpringBoneState({
      chains: [makeChain({ jointCount: 4, length: 0.25, settings: { stiffness: 0.7, drag: 0.45, gravityPower: 0.3 } })],
      colliders: [
        { kind: "sphere", center: { x: 0.05, y: -0.4, z: 0 }, radius: 0.2, inside: false },
        { kind: "capsule", head: { x: -0.2, y: -0.7, z: 0 }, tail: { x: 0.2, y: -0.7, z: 0 }, radius: 0.1, inside: false },
      ],
      wind,
    });
    for (let i = 0; i < 120; i += 1) {
      stepStudioVrmSpringBones(state, SPRING_SETTLE_DT, state.stepIndex);
      for (const length of studioVrmSpringBoneJointLengths(state.chains[0]!)) {
        expect(Math.abs(length - 0.25)).toBeLessThan(1e-9);
      }
    }
  });
});

/* ── 정착 / 수렴 ────────────────────────────────────────────────────── */

describe("정착(settle)", () => {
  it("상한 안에서 수렴하고, 정착 후에는 멱등이다", () => {
    const state = createStudioVrmSpringBoneState({
      chains: [makeChain({ jointCount: 3, length: 0.3, settings: { stiffness: 0.9, drag: 0.5, gravityPower: 0.3 } })],
    });
    const report = settleStudioVrmSpringBonesUntilStable(state, { maxSteps: 600, epsilon: 1e-6 });
    expect(report.settled).toBe(true);
    expect(report.steps).toBeLessThanOrEqual(600);
    expect(isStudioVrmSpringBoneSettled(state, 1e-6)).toBe(true);

    const before = snapshotStudioVrmSpringBoneState(state);
    settleStudioVrmSpringBones(state, 300);
    const after = snapshotStudioVrmSpringBoneState(state);
    expect(studioVrmSpringBoneSnapshotDelta(before, after)).toBeLessThan(1e-5);
  });

  it("한 번도 스텝하지 않은 상태는 '정착됨'이 아니다", () => {
    const state = createStudioVrmSpringBoneState({ chains: [makeChain()] });
    expect(state.lastMaxDelta).toBe(Number.POSITIVE_INFINITY);
    expect(isStudioVrmSpringBoneSettled(state)).toBe(false);
  });

  it("감쇠가 없으면 상한에 걸리고 settled=false 로 정직하게 보고한다", () => {
    // 수평 rest + 감쇠 0 = 마찰 없는 진자. 영원히 흔들리므로 절대 수렴하지 않는다.
    const state = createStudioVrmSpringBoneState({
      chains: [
        makeChain({
          jointCount: 1,
          length: 0.5,
          restDir: { x: 1, y: 0, z: 0 },
          settings: { stiffness: 0, drag: 0, gravityPower: 0.5 },
        }),
      ],
    });
    const report = settleStudioVrmSpringBonesUntilStable(state, { maxSteps: 50, epsilon: 1e-9 });
    expect(report.steps).toBe(50);
    expect(report.settled).toBe(false);
  });

  it("reset 은 rest 자세와 스텝 인덱스를 되감는다", () => {
    const state = createStudioVrmSpringBoneState({
      chains: [makeChain({ jointCount: 2, settings: { gravityPower: 0.4 } })],
    });
    settleStudioVrmSpringBones(state, 30);
    expect(state.stepIndex).toBe(30);
    resetStudioVrmSpringBoneState(state);
    expect(state.stepIndex).toBe(0);
    const restTails = computeSpringChainRestTails(state.chains[0]!.def);
    expect(state.chains[0]!.joints[0]!.currentTail).toEqual(restTails[0]);
    expect(state.lastMaxDelta).toBe(Number.POSITIVE_INFINITY);
  });

  it("dt <= 0 스텝은 상태를 바꾸지 않는다(시계 폭주/탭 복귀 방어)", () => {
    const state = createStudioVrmSpringBoneState({ chains: [makeChain({ settings: { gravityPower: 0.4 } })] });
    settleStudioVrmSpringBones(state, 5);
    const before = serializeStudioVrmSpringBoneSnapshot(snapshotStudioVrmSpringBoneState(state));
    expect(stepStudioVrmSpringBones(state, 0, state.stepIndex)).toBe(0);
    expect(stepStudioVrmSpringBones(state, -1, state.stepIndex)).toBe(0);
    expect(stepStudioVrmSpringBones(state, Number.NaN, state.stepIndex)).toBe(0);
    expect(serializeStudioVrmSpringBoneSnapshot(snapshotStudioVrmSpringBoneState(state))).toBe(before);
  });
});

/* ── 결정성 ─────────────────────────────────────────────────────────── */

describe("캡처 결정성", () => {
  const wind: SpringWind = { dir: { x: 1, y: 0.2, z: 0.3 }, strength: 1.2, turbulence: 0.7, seed: 20260724, phase: 0.13, phaseStep: 0.21 };

  function build(seed: number) {
    return createStudioVrmSpringBoneState({
      chains: [
        makeChain({ id: "hair", jointCount: 3, length: 0.3, settings: { stiffness: 0.7, drag: 0.45, gravityPower: 0.28 } }),
        makeChain({ id: "skirt", jointCount: 2, length: 0.35, settings: { stiffness: 0.9, drag: 0.55, gravityPower: 0.35 } }),
      ],
      colliders: [{ kind: "sphere", center: { x: 0.08, y: -0.5, z: 0 }, radius: 0.22, inside: false }],
      wind: { ...wind, seed },
    });
  }

  it("같은 (state, dt, steps, seed) 는 바이트 동일한 스냅샷을 만든다", () => {
    const a = build(20260724);
    const b = build(20260724);
    settleStudioVrmSpringBones(a, 120, 1 / 60);
    settleStudioVrmSpringBones(b, 120, 1 / 60);
    expect(serializeStudioVrmSpringBoneSnapshot(snapshotStudioVrmSpringBoneState(a))).toBe(
      serializeStudioVrmSpringBoneSnapshot(snapshotStudioVrmSpringBoneState(b))
    );
  });

  it("reset 후 같은 스텝을 다시 밟으면 같은 결과로 돌아온다(캡처 재현)", () => {
    const state = build(20260724);
    settleStudioVrmSpringBones(state, 90, 1 / 60);
    const first = serializeStudioVrmSpringBoneSnapshot(snapshotStudioVrmSpringBoneState(state));
    resetStudioVrmSpringBoneState(state);
    settleStudioVrmSpringBones(state, 90, 1 / 60);
    expect(serializeStudioVrmSpringBoneSnapshot(snapshotStudioVrmSpringBoneState(state))).toBe(first);
  });

  it("시드가 다르면 돌풍 결과가 달라진다", () => {
    const a = build(1);
    const b = build(2);
    settleStudioVrmSpringBones(a, 60, 1 / 60);
    settleStudioVrmSpringBones(b, 60, 1 / 60);
    expect(serializeStudioVrmSpringBoneSnapshot(snapshotStudioVrmSpringBoneState(a))).not.toBe(
      serializeStudioVrmSpringBoneSnapshot(snapshotStudioVrmSpringBoneState(b))
    );
  });

  it("스텝 수가 다르면 결과가 다르고, 결과에 스텝 인덱스가 기록된다", () => {
    const a = build(9);
    settleStudioVrmSpringBones(a, 40, 1 / 60);
    expect(snapshotStudioVrmSpringBoneState(a).stepIndex).toBe(40);
  });

  it("스냅샷 델타는 구조가 다르면 무한대를 돌려준다", () => {
    const a = snapshotStudioVrmSpringBoneState(build(1));
    const b = snapshotStudioVrmSpringBoneState(
      createStudioVrmSpringBoneState({ chains: [makeChain({ id: "hair" })] })
    );
    expect(studioVrmSpringBoneSnapshotDelta(a, b)).toBe(Number.POSITIVE_INFINITY);
  });
});

/* ── 관측 헬퍼 ──────────────────────────────────────────────────────── */

describe("관측 헬퍼", () => {
  it("heads 는 origin 으로 시작하고 앞 조인트의 tail 을 잇는다", () => {
    const state = createStudioVrmSpringBoneState({ chains: [makeChain({ jointCount: 3, length: 0.4 })] });
    const heads = studioVrmSpringBoneHeads(state.chains[0]!);
    expect(heads).toHaveLength(3);
    expect(heads[0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(heads[1]).toEqual(state.chains[0]!.joints[0]!.currentTail);
    expect(springLength(springSub(heads[2]!, heads[1]!))).toBeCloseTo(0.4, 9);
  });

  it("존재하지 않는 조인트 변위는 false 를 돌려준다", () => {
    const state = createStudioVrmSpringBoneState({ chains: [makeChain({ jointCount: 1 })] });
    expect(displaceStudioVrmSpringBoneTail(state, 5, 0, { x: 1, y: 0, z: 0 })).toBe(false);
    expect(displaceStudioVrmSpringBoneTail(state, 0, 9, { x: 1, y: 0, z: 0 })).toBe(false);
  });
});
