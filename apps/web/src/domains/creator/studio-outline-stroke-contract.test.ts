import { beforeAll, describe, expect, it } from "vitest";

import {
  captureStudioOutlineStrokeContractV1,
  migrateLegacyStudioOutlineStrokeContractV1,
  normalizeStudioOutlineStrokeContract,
  planStudioPerfectFreehandRender,
  resolveStudioOutlineStrokeContract,
  STUDIO_OUTLINE_STROKE_ADAPTER_VERSION,
  STUDIO_OUTLINE_STROKE_PACKAGE_ALGORITHM,
  StudioOutlineStrokeContractError,
  type StudioPerfectFreehandOutlineStrokeContractV1,
} from "./studio-outline-stroke-contract";
import {
  loadStudioPerfectFreehandStroker,
  STUDIO_PERFECT_FREEHAND_PROFILES,
  type StudioPerfectFreehandStroker,
} from "./studio-perfect-freehand";

function capture(
  brushId = "perfect-ink",
  pressureSource: "recorded" | "simulated-distance" = "recorded",
): StudioPerfectFreehandOutlineStrokeContractV1 {
  const contract = captureStudioOutlineStrokeContractV1({
    brushId,
    pressureSource,
  });
  // 이 스위트의 픽스처 브러시는 전부 perfect-freehand 브랜치다(캡슐 브랜치는 자기 스위트 소유).
  if (!contract || contract.engine !== "perfect-freehand-outline") {
    throw new Error(`테스트 브러시 ${brushId}의 perfect-freehand 계약이 없습니다.`);
  }
  return contract;
}

function polygon(
  centerX: number,
  centerY: number,
  radius: number,
  count = 16,
): number[][] {
  return Array.from({ length: count }, (_, index) => {
    const angle = (Math.PI * 2 * index) / count;
    return [
      centerX + Math.cos(angle) * radius,
      centerY + Math.sin(angle) * radius,
    ];
  });
}

describe("StudioOutlineStrokeContractV1 capture / normalization", () => {
  it("pointer-start에서 프로필 수치와 정확한 어댑터·패키지 알고리즘을 JSON 계약으로 고정한다", () => {
    const contract = capture("gpen");

    expect(contract).toMatchObject({
      kind: "studio-outline-stroke-contract",
      version: 1,
      engine: "perfect-freehand-outline",
      adapterVersion: STUDIO_OUTLINE_STROKE_ADAPTER_VERSION,
      packageAlgorithm: STUDIO_OUTLINE_STROKE_PACKAGE_ALGORITHM,
      pressureSource: "recorded",
      profile: {
        id: "gpen",
        diameterScale: 1,
        thinning: STUDIO_PERFECT_FREEHAND_PROFILES.gpen.thinning,
        smoothing: STUDIO_PERFECT_FREEHAND_PROFILES.gpen.smoothing,
        streamline: STUDIO_PERFECT_FREEHAND_PROFILES.gpen.streamline,
      },
    });
    expect(Object.isFrozen(contract)).toBe(true);
    expect(Object.isFrozen(contract.profile)).toBe(true);
    expect(contract.profile).not.toBe(STUDIO_PERFECT_FREEHAND_PROFILES.gpen);

    const jsonRoundTrip: unknown = JSON.parse(JSON.stringify(contract));
    const resolution = resolveStudioOutlineStrokeContract(jsonRoundTrip);
    expect(resolution.status).toBe("ready");
    if (resolution.status === "ready") {
      expect(resolution.contract).toEqual(contract);
      expect(Object.isFrozen(resolution.contract.profile)).toBe(true);
    }
  });

  it("outline 엔진이 소유하지 않는 브러시는 null이며, 소유 브러시는 필압 출처 생략을 거부한다", () => {
    expect(captureStudioOutlineStrokeContractV1({
      brushId: "pen",
      pressureSource: "recorded",
    })).toBeNull();
    expect(() => captureStudioOutlineStrokeContractV1({
      brushId: "gpen",
      pressureSource: undefined,
    })).toThrowError(StudioOutlineStrokeContractError);
  });

  it("계약이 없으면 레거시로 보존하고 미래·변조 계약은 명시적인 unsupported로 분류한다", () => {
    expect(resolveStudioOutlineStrokeContract(undefined)).toEqual({
      status: "legacy",
      contract: null,
      reason: "missing-contract",
    });

    const contract = capture();
    expect(resolveStudioOutlineStrokeContract({
      ...contract,
      version: 2,
    })).toMatchObject({
      status: "unsupported",
      issue: { code: "unsupported-version", path: "version" },
    });
    expect(resolveStudioOutlineStrokeContract({
      ...contract,
      adapterVersion: "toonspectrum-perfect-freehand-adapter-v2",
    })).toMatchObject({
      status: "unsupported",
      issue: {
        code: "unsupported-adapter-version",
        path: "adapterVersion",
      },
    });
    expect(resolveStudioOutlineStrokeContract({
      ...contract,
      packageAlgorithm: "perfect-freehand@2.0.0:getStroke",
    })).toMatchObject({
      status: "unsupported",
      issue: {
        code: "unsupported-package-algorithm",
        path: "packageAlgorithm",
      },
    });
    expect(resolveStudioOutlineStrokeContract({
      ...contract,
      unexpected: true,
    })).toMatchObject({
      status: "unsupported",
      issue: { code: "malformed-contract", path: "$" },
    });
  });

  it("접근자·예외를 던지는 Proxy를 읽거나 실행하지 않고 malformed로 닫는다", () => {
    let getterCalled = false;
    const accessorContract = {};
    Object.defineProperty(accessorContract, "kind", {
      enumerable: true,
      get: () => {
        getterCalled = true;
        return "studio-outline-stroke-contract";
      },
    });
    expect(resolveStudioOutlineStrokeContract(accessorContract)).toMatchObject({
      status: "unsupported",
      issue: { code: "malformed-contract" },
    });
    expect(getterCalled).toBe(false);

    const hostile = new Proxy({}, {
      ownKeys: () => {
        throw new Error("hostile proxy");
      },
    });
    expect(resolveStudioOutlineStrokeContract(hostile)).toMatchObject({
      status: "unsupported",
      issue: { code: "malformed-contract" },
    });
  });

  it("프로필 스냅샷은 안전 범위 안의 과거 수치를 보존하고 알 수 없는 프로필은 거부한다", () => {
    const contract = capture();
    const historical = {
      ...contract,
      profile: {
        ...contract.profile,
        diameterScale: 0.72,
        thinning: 0.61,
        taperEndFactor: 4.25,
      },
    };
    const normalized = normalizeStudioOutlineStrokeContract(historical);
    const normalizedProfile = normalized?.engine === "perfect-freehand-outline"
      ? normalized.profile
      : null;
    expect(normalizedProfile?.diameterScale).toBe(0.72);
    expect(normalizedProfile?.thinning).toBe(0.61);
    expect(normalizedProfile?.taperEndFactor).toBe(4.25);

    expect(resolveStudioOutlineStrokeContract({
      ...contract,
      profile: { ...contract.profile, id: "future-ink" },
    })).toMatchObject({
      status: "unsupported",
      issue: { code: "unsupported-profile", path: "profile.id" },
    });
    expect(resolveStudioOutlineStrokeContract({
      ...contract,
      profile: { ...contract.profile, smoothing: 9 },
    })).toMatchObject({
      status: "unsupported",
      issue: { code: "unsupported-profile", path: "profile" },
    });
  });

  it("perfect-freehand 프리셋의 모든 프로필을 캡처하고 재생 계약으로 받아들인다", async () => {
    // maru-pen 은 프리셋·캡처에는 있었지만 계약의 허용 목록에 없어, 모든 마루펜 획이 캔버스에
    // 자홍색 진단 상자로 그려졌다. 프리셋 표와 허용 목록은 같은 집합이어야 한다.
    const stroker = await loadStudioPerfectFreehandStroker();
    for (const profileId of Object.keys(STUDIO_PERFECT_FREEHAND_PROFILES)) {
      const contract = captureStudioOutlineStrokeContractV1({
        brushId: profileId,
        pressureSource: "recorded",
      });
      expect(contract?.engine, profileId).toBe("perfect-freehand-outline");
      expect(resolveStudioOutlineStrokeContract(contract).status, profileId).toBe("ready");
      const plan = planStudioPerfectFreehandRender({
        contract,
        stroker,
        points: Array.from({ length: 25 }, (_, index) => [
          index * 6,
          40 + Math.sin(index / 4) * 24,
        ]).flat(),
        pressures: Array.from({ length: 25 }, (_, index) => 0.2 + index * 0.025),
        strokeWidth: 12,
        sampleSpacing: 0.8,
      });
      expect(plan.kind, profileId).toBe("outline");
    }
  });

  it("normalize은 missing만 null로 두고 unsupported를 조용히 레거시 처리하지 않는다", () => {
    expect(normalizeStudioOutlineStrokeContract(null)).toBeNull();
    expect(() => normalizeStudioOutlineStrokeContract({
      ...capture(),
      engine: "unknown-outline-engine",
    })).toThrowError(StudioOutlineStrokeContractError);
  });

  it("레거시 마이그레이션은 필압 출처를 명시한 소유 브러시에만 opt-in한다", () => {
    expect(migrateLegacyStudioOutlineStrokeContractV1({
      brushId: "mapping-pen",
      pressureSource: "recorded",
    })).toMatchObject({
      status: "migrated",
      contract: {
        pressureSource: "recorded",
        profile: { id: "gpen", diameterScale: 0.45 },
      },
    });
    expect(migrateLegacyStudioOutlineStrokeContractV1({
      brushId: "watercolor",
      pressureSource: "simulated-distance",
    })).toEqual({
      status: "legacy-ineligible",
      contract: null,
    });
    expect(() => migrateLegacyStudioOutlineStrokeContractV1({
      brushId: "perfect-ink",
      pressureSource: undefined,
    })).toThrowError(StudioOutlineStrokeContractError);
  });
});

describe("planStudioPerfectFreehandRender", () => {
  let stroker: StudioPerfectFreehandStroker;

  beforeAll(async () => {
    stroker = await loadStudioPerfectFreehandStroker();
  });

  it("같은 계약·점·필압으로 라이브/커밋/SVG가 재사용할 결정적 outline 계획을 만든다", () => {
    const points = Array.from({ length: 25 }, (_, index) => {
      const x = index * 6;
      return [x, 40 + Math.sin(index / 4) * 24];
    }).flat();
    const input = {
      contract: capture("gpen"),
      stroker,
      points,
      pressures: Array.from({ length: 25 }, (_, index) => 0.2 + index * 0.025),
      strokeWidth: 12,
      sampleSpacing: 0.8,
    };

    const first = planStudioPerfectFreehandRender(input);
    const second = planStudioPerfectFreehandRender(input);
    expect(first.kind).toBe("outline");
    expect(second).toEqual(first);
    if (first.kind === "outline") {
      expect(first.pathData).toMatch(/^M/u);
      expect(first.pathData.endsWith("Z")).toBe(true);
      expect(first.outline.length).toBeGreaterThan(12);
      expect(first.metrics.outlineDistance).toBeGreaterThan(0);
    }
  });

  it("저장된 브러시 지름 배율을 사용해 이후 카탈로그 조회 없이 매핑펜 굵기를 재생한다", () => {
    const points = Array.from({ length: 25 }, (_, index) => [
      index * 8,
      30 + Math.sin(index / 3) * 16,
    ]).flat();
    const pressures = Array.from(
      { length: 25 },
      (_, index) => 0.35 + (index % 7) * 0.07,
    );
    const gpen = planStudioPerfectFreehandRender({
      contract: capture("gpen"),
      stroker,
      points,
      pressures,
      strokeWidth: 20,
    });
    const mappingPen = planStudioPerfectFreehandRender({
      contract: capture("mapping-pen"),
      stroker,
      points,
      pressures,
      strokeWidth: 20,
    });
    expect(gpen.kind).toBe("outline");
    expect(mappingPen.kind).toBe("outline");
    if (gpen.kind !== "outline" || mappingPen.kind !== "outline") return;

    const verticalSpan = (outline: readonly (readonly number[])[]) => {
      const ys = outline.map((point) => point[1]!);
      return Math.max(...ys) - Math.min(...ys);
    };
    expect(mappingPen.contract.profile.diameterScale).toBe(0.45);
    expect(verticalSpan(mappingPen.outline)).toBeLessThan(verticalSpan(gpen.outline));
    expect(mappingPen.pathData).not.toBe(gpen.pathData);
  });

  it("계약의 pressureSource가 getStroke simulatePressure 권한을 명시적으로 결정한다", () => {
    const received: Array<boolean | undefined> = [];
    const captureOptions: StudioPerfectFreehandStroker = (_points, options) => {
      received.push(options?.simulatePressure);
      return polygon(50, 0, 60);
    };
    const base = {
      stroker: captureOptions,
      points: [0, 0, 50, 4, 100, 0],
      pressures: [0.1, 0.5, 0.9],
      strokeWidth: 10,
      sampleSpacing: 1,
    };

    expect(planStudioPerfectFreehandRender({
      ...base,
      contract: capture("gpen", "recorded"),
    }).kind).toBe("outline");
    expect(planStudioPerfectFreehandRender({
      ...base,
      contract: capture("gpen", "simulated-distance"),
    }).kind).toBe("outline");
    expect(received).toEqual([false, true]);
  });

  it("recorded 계약의 필압 누락·손상을 렌더 폴백으로 숨기지 않는다", () => {
    const base = {
      contract: capture("gpen", "recorded"),
      stroker,
      points: [0, 0, 40, 5, 80, 0],
      strokeWidth: 10,
    };
    expect(planStudioPerfectFreehandRender(base)).toEqual({
      kind: "invalid-input",
      reason: "missing-recorded-pressure",
    });
    expect(planStudioPerfectFreehandRender({
      ...base,
      pressures: [0.2, Number.NaN, 0.8],
    })).toEqual({
      kind: "invalid-input",
      reason: "invalid-recorded-pressure",
    });
  });

  it("perfect-*의 짧은 획은 endpoint cap이 있는 공용 Line 폴백으로 계획한다", () => {
    const plan = planStudioPerfectFreehandRender({
      contract: capture("perfect-ink"),
      stroker,
      points: [10, 10, 14, 14],
      pressures: [0.5, 0.5],
      strokeWidth: 4,
      sampleSpacing: 1,
    });
    expect(plan).toMatchObject({
      kind: "fallback-line",
      reason: "very-short-perfect",
      line: {
        points: [10, 10, 14, 14],
        tension: 0.32,
        strokeWidth: 4,
        endpointCapRadius: 2,
      },
      metrics: { pointCount: 2 },
    });
  });

  it("G펜의 짧은 두 점 flick은 compact fallback으로 강등하지 않는다", () => {
    const wideOutline: StudioPerfectFreehandStroker = () => polygon(4, 4, 12);
    const plan = planStudioPerfectFreehandRender({
      contract: capture("gpen"),
      stroker: wideOutline,
      points: [0, 0, 7, 7],
      pressures: [0.4, 0.8],
      strokeWidth: 8,
      sampleSpacing: 1,
    });
    expect(plan.kind).toBe("outline");
  });

  it("단일 탭은 live/commit/SVG가 함께 그릴 명시적인 endpoint cap을 계획한다", () => {
    const plan = planStudioPerfectFreehandRender({
      contract: capture("gpen"),
      stroker,
      points: [12, 18],
      pressures: [0.45],
      strokeWidth: 7,
      sampleSpacing: 0,
    });
    expect(plan).toMatchObject({
      kind: "fallback-line",
      reason: "insufficient-points",
      line: {
        points: [12, 18],
        strokeWidth: 6.4575,
        endpointCapRadius: 3.22875,
      },
      metrics: { pointCount: 1 },
    });
  });

  it("장거리 희소 perfect-ink 입력은 getStroke 전에 공용 capped Line 폴백을 고른다", () => {
    let called = false;
    const shouldNotRun: StudioPerfectFreehandStroker = () => {
      called = true;
      return [];
    };
    const plan = planStudioPerfectFreehandRender({
      contract: capture("perfect-ink"),
      stroker: shouldNotRun,
      points: [0, 0, 100, 0, 200, 0, 300, 0],
      pressures: [0.5, 0.5, 0.5, 0.5],
      strokeWidth: 10,
      sampleSpacing: 1,
    });
    expect(plan).toMatchObject({
      kind: "fallback-line",
      reason: "sparse-long-perfect-ink",
      line: { endpointCapRadius: 5 },
    });
    expect(called).toBe(false);
  });

  it("비어 있거나 지나치게 작은 outline을 Canvas/SVG 공통 폴백으로 분류한다", () => {
    const base = {
      contract: capture("gpen"),
      points: [0, 0, 50, 0, 100, 0],
      pressures: [0.6, 0.6, 0.6],
      strokeWidth: 10,
      sampleSpacing: 1,
    };
    expect(planStudioPerfectFreehandRender({
      ...base,
      stroker: () => [],
    })).toMatchObject({
      kind: "fallback-line",
      reason: "invalid-outline",
    });
    expect(planStudioPerfectFreehandRender({
      ...base,
      stroker: () => polygon(0, 0, 1),
    })).toMatchObject({
      kind: "fallback-line",
      reason: "degenerate-outline",
      metrics: { outlinePointCount: 16 },
    });
  });

  it("missing/unknown 계약과 비유한 입력을 눈에 보이는 상태로 반환한다", () => {
    const base = {
      stroker,
      points: [0, 0, 100, 0],
      pressures: [0.5, 0.5],
      strokeWidth: 8,
    };
    expect(planStudioPerfectFreehandRender({
      ...base,
      contract: null,
    })).toEqual({
      kind: "legacy-contract",
      reason: "missing-contract",
    });
    expect(planStudioPerfectFreehandRender({
      ...base,
      contract: { ...capture(), version: 99 },
    })).toMatchObject({
      kind: "unsupported-contract",
      issue: { code: "unsupported-version" },
    });
    expect(planStudioPerfectFreehandRender({
      ...base,
      contract: capture(),
      points: [0, Number.NaN, 10, 10],
    })).toEqual({
      kind: "invalid-input",
      reason: "invalid-points",
    });
    expect(planStudioPerfectFreehandRender({
      ...base,
      contract: capture(),
      strokeWidth: 0,
    })).toEqual({
      kind: "invalid-input",
      reason: "invalid-stroke-width",
    });
  });

  it("stroker가 준비되지 않은 상태도 임의 엔진으로 바꾸지 않고 명시적인 Line 계획을 준다", () => {
    const plan = planStudioPerfectFreehandRender({
      contract: capture("gpen"),
      stroker: null,
      points: [0, 0, 40, 5, 80, 0],
      pressures: [0.4, 0.7, 0.5],
      strokeWidth: 9,
      sampleSpacing: 1,
    });
    expect(plan).toMatchObject({
      kind: "fallback-line",
      reason: "stroker-unavailable",
      line: {
        points: [0, 0, 40, 5, 80, 0],
        tension: 0.32,
        strokeWidth: 9,
        endpointCapRadius: null,
      },
    });
  });
});
