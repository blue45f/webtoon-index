import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_BONE_SMOOTHER,
  oneEuroAlpha,
  smoothQuaternionStep,
  VrmBoneSmoother,
} from "./studio-vrm-bone-smoother";

const DT = 1 / 60;
const IDENT = new THREE.Quaternion();

/** 두 quaternion 사이 측지 각도(rad). */
function angleBetween(a: THREE.Quaternion, b: THREE.Quaternion): number {
  return 2 * Math.acos(Math.min(1, Math.abs(a.dot(b))));
}

function rotX(rad: number): readonly [number, number, number] {
  return [rad, 0, 0];
}

describe("studio-vrm-bone-smoother", () => {
  describe("oneEuroAlpha", () => {
    it("속도가 클수록 α가 커진다(빠른 동작에 더 즉각 반응)", () => {
      const slow = oneEuroAlpha(0, DT, 1.5, 0.4);
      const mid = oneEuroAlpha(10, DT, 1.5, 0.4);
      const fast = oneEuroAlpha(100, DT, 1.5, 0.4);
      expect(slow).toBeLessThan(mid);
      expect(mid).toBeLessThan(fast);
      expect(slow).toBeGreaterThan(0);
      expect(fast).toBeLessThanOrEqual(1);
    });
  });

  describe("smoothQuaternionStep", () => {
    it("이전 값이 없으면 raw 를 그대로 반환(첫 프레임 스냅)", () => {
      const q = smoothQuaternionStep(null, rotX(0.5), DT, DEFAULT_BONE_SMOOTHER);
      const raw = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.5, 0, 0, "XYZ"));
      expect(angleBetween(q, raw)).toBeLessThan(1e-6);
    });

    it("데드밴드보다 작은 변화는 이전 값을 유지한다", () => {
      const tiny = DEFAULT_BONE_SMOOTHER.deadBand / 2;
      const q = smoothQuaternionStep(IDENT, rotX(tiny), DT, DEFAULT_BONE_SMOOTHER);
      expect(angleBetween(q, IDENT)).toBeLessThan(1e-6);
    });

    it("중간 변화는 raw 까지 일부만 보간한다(slerp)", () => {
      const q = smoothQuaternionStep(IDENT, rotX(0.5), DT, DEFAULT_BONE_SMOOTHER);
      const a = angleBetween(q, IDENT);
      expect(a).toBeGreaterThan(0.05);
      expect(a).toBeLessThan(0.5); // 한 번에 다 가지 않음
    });

    it("급격한 변화는 max-step 으로 제한된다", () => {
      const q = smoothQuaternionStep(IDENT, rotX(Math.PI), DT, DEFAULT_BONE_SMOOTHER);
      expect(angleBetween(q, IDENT)).toBeLessThanOrEqual(DEFAULT_BONE_SMOOTHER.maxStep + 1e-3);
    });

    it("부호가 반대인 quaternion도 최단경로로 보간한다(반구 정렬)", () => {
      // raw 를 -q 로 줘도 같은 회전 → 작은 각으로 수렴해야 한다.
      const target = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0, 0, "XYZ"));
      const negTargetEuler = (() => {
        const e = new THREE.Euler().setFromQuaternion(
          new THREE.Quaternion(-target.x, -target.y, -target.z, -target.w),
          "XYZ"
        );
        return [e.x, e.y, e.z] as const;
      })();
      const q = smoothQuaternionStep(IDENT, negTargetEuler, DT, DEFAULT_BONE_SMOOTHER);
      // 결과가 target(또는 그 근방)으로 짧게 이동하지 반대편으로 크게 돌지 않는다.
      expect(angleBetween(q, IDENT)).toBeLessThan(0.25);
    });
  });

  describe("VrmBoneSmoother", () => {
    it("같은 타깃을 반복 입력하면 점진 수렴한다", () => {
      const s = new VrmBoneSmoother();
      let last = 0;
      for (let i = 0; i < 120; i++) {
        const q = s.smooth("leftLowerArm", rotX(0.6), DT);
        last = angleBetween(q, IDENT);
      }
      expect(last).toBeCloseTo(0.6, 1); // 충분히 반복하면 타깃 도달
    });

    it("forget 후에는 다음 입력이 즉시 스냅된다", () => {
      const s = new VrmBoneSmoother();
      s.smooth("a", rotX(0.3), DT);
      s.forget("a");
      const q = s.smooth("a", rotX(0.9), DT);
      const raw = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.9, 0, 0, "XYZ"));
      expect(angleBetween(q, raw)).toBeLessThan(1e-6);
    });

    it("retainOnly 는 활성 본 외 상태를 제거한다", () => {
      const s = new VrmBoneSmoother();
      s.smooth("a", rotX(0.3), DT);
      s.smooth("b", rotX(0.3), DT);
      s.retainOnly(["a"]);
      // b 는 잊혔으므로 다음 입력이 즉시 스냅(첫 프레임처럼).
      const qb = s.smooth("b", rotX(0.9), DT);
      const raw = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.9, 0, 0, "XYZ"));
      expect(angleBetween(qb, raw)).toBeLessThan(1e-6);
    });

    it("fadeToward: 추적된 적 없는 본은 null(페이드 안 함)", () => {
      const s = new VrmBoneSmoother();
      expect(s.fadeToward("x", rotX(0), DT, 0.2)).toBeNull();
    });

    it("fadeToward: 끊긴 본을 rest(0)로 점진 복귀시키고 도달하면 null", () => {
      const s = new VrmBoneSmoother();
      s.smooth("arm", rotX(1.0), DT); // 1rad 까지 추적됨
      let lastNonNull = s.fadeToward("arm", rotX(0), DT, 0.2);
      let settled = false;
      for (let i = 0; i < 300; i++) {
        const q = s.fadeToward("arm", rotX(0), DT, 0.2);
        if (q === null) {
          settled = true;
          break;
        }
        lastNonNull = q;
      }
      expect(settled).toBe(true); // 결국 rest 도달 → null
      expect(lastNonNull).not.toBeNull();
      expect(angleBetween(lastNonNull!, IDENT)).toBeLessThan(0.05); // 거의 rest
    });
  });
});
