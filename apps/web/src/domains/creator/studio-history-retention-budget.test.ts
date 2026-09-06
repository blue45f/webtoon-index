import { describe, expect, it } from "vitest";

import {
  applyStudioPagesHistoryRetention,
  describeStudioHistoryBudgetEviction,
  formatStudioHistoryBytes,
  measureStudioPagesHistoryEntryBytes,
  readStudioPagesHistoryRetainedBytes,
  STUDIO_HISTORY_DOUBLE_ARRAY_HEADER_BYTES,
  STUDIO_HISTORY_MEASURED_NUMERIC_CHANNELS,
  STUDIO_HISTORY_POINTER_ARRAY_HEADER_BYTES,
  STUDIO_HISTORY_POINTER_SLOT_BYTES,
  STUDIO_HISTORY_RETAINED_HEAP_CALIBRATION,
  STUDIO_PAGES_HISTORY_MAX_ENTRIES,
  STUDIO_PAGES_HISTORY_MIN_ENTRIES,
  STUDIO_PAGES_HISTORY_RETAINED_BYTES_BUDGET,
} from "./studio-history-retention-budget";

import type { El } from "./studio-element-model";

type TestElement = { id: string } & Record<string, unknown>;
type TestPage = { id: string; elements: TestElement[] };

function element(id: string, extra: Record<string, unknown> = {}): TestElement {
  return { id, ...extra };
}

function page(id: string, elementCount: number): TestPage {
  return {
    id,
    elements: Array.from({ length: elementCount }, (_, index) => element(`${id}-e${index}`)),
  };
}

function document(pageCount: number, elementsPerPage: number): TestPage[] {
  return Array.from({ length: pageCount }, (_, index) => page(`p${index}`, elementsPerPage));
}

/** `commit()` 이 만드는 모양 — 대상 페이지만 얕게 복사하고 요소 1개를 패치한다. */
function patchOneElement(pages: TestPage[], pageIndex = 0, elementIndex = 0): TestPage[] {
  return pages.map((current, index) =>
    index !== pageIndex
      ? current
      : {
          ...current,
          elements: current.elements.map((el, at) =>
            at === elementIndex ? { ...el, x: (Number(el.x) || 0) + 1 } : el
          ),
        }
  );
}

// ── 계량기가 실측 닫힌 형태와 일치하는가 ────────────────────────────────────────

describe("계량기 — Chrome 실측 닫힌 형태를 그대로 낸다", () => {
  it.each([
    { pageCount: 1, elementsPerPage: 50 },
    { pageCount: 5, elementsPerPage: 300 },
    { pageCount: 20, elementsPerPage: 500 },
    { pageCount: 10, elementsPerPage: 1_000 },
    { pageCount: 40, elementsPerPage: 80 },
  ])(
    "얕은 패치 커밋은 4 × (페이지수 + 편집 페이지 요소수) + 172 B ($pageCount p × $elementsPerPage el)",
    ({ pageCount, elementsPerPage }) => {
      const before = document(pageCount, elementsPerPage);
      const after = patchOneElement(before);

      expect(measureStudioPagesHistoryEntryBytes(before, after)).toBe(
        4 * (pageCount + elementsPerPage) + 172
      );
    }
  );

  it.each([500, 1_000, 2_000, 3_000, 6_000])(
    "points 재굽기는 샘플당 정확히 16.00 B 다 (%i 샘플)",
    (sampleCount) => {
      const pressures = Array.from({ length: sampleCount }, () => 0.5);
      const points = Array.from({ length: sampleCount * 2 }, () => 1);
      const before: TestPage[] = [
        { id: "p0", elements: [element("stroke", { points, pressures })] },
      ];
      const baseline = measureStudioPagesHistoryEntryBytes(before, patchOneElement(before));

      // 변형은 `{...el, points}` 스프레드 — points 만 새로 굽고 pressures 는 공유한다.
      const after: TestPage[] = [
        {
          ...before[0],
          elements: [{ ...before[0].elements[0], points: points.map((v) => v + 1) }],
        },
      ];

      const delta = measureStudioPagesHistoryEntryBytes(before, after) - baseline;
      expect(delta).toBe(16 * sampleCount + STUDIO_HISTORY_DOUBLE_ARRAY_HEADER_BYTES);
    }
  );

  it("정렬 채널을 공유하면 0 으로 센다 — 변형이 pressures 를 복사하지 않는 사실을 그대로 반영", () => {
    const channels = Object.fromEntries(
      STUDIO_HISTORY_MEASURED_NUMERIC_CHANNELS.map((channel) => [
        channel,
        Array.from({ length: 200 }, () => 1),
      ])
    );
    const before: TestPage[] = [{ id: "p0", elements: [element("stroke", channels)] }];
    // 채널을 하나도 갈아끼우지 않은 얕은 패치.
    const after = patchOneElement(before);

    expect(measureStudioPagesHistoryEntryBytes(before, after)).toBe(4 * (1 + 1) + 172);
  });

  it("모든 채널을 새로 구우면 채널마다 헤더 + 8 B/슬롯 을 센다", () => {
    const before: TestPage[] = [{ id: "p0", elements: [element("stroke")] }];
    const channels = Object.fromEntries(
      STUDIO_HISTORY_MEASURED_NUMERIC_CHANNELS.map((channel) => [
        channel,
        Array.from({ length: 100 }, () => 1),
      ])
    );
    const after: TestPage[] = [
      { ...before[0], elements: [{ ...before[0].elements[0], ...channels }] },
    ];

    const channelBytes = STUDIO_HISTORY_MEASURED_NUMERIC_CHANNELS.length
      * (STUDIO_HISTORY_DOUBLE_ARRAY_HEADER_BYTES + 8 * 100);
    expect(measureStudioPagesHistoryEntryBytes(before, after)).toBe(
      4 * (1 + 1) + 172 + channelBytes
    );
  });

  it("래스터 편집이 새로 구운 data URL 도 예산에 들어간다", () => {
    const src = `data:image/png;base64,${"A".repeat(4_000)}`;
    const before: TestPage[] = [{ id: "p0", elements: [element("img", { type: "image", src })] }];
    const after: TestPage[] = [
      {
        ...before[0],
        elements: [{ ...before[0].elements[0], src: `${src}B` }],
      },
    ];

    expect(measureStudioPagesHistoryEntryBytes(before, after)).toBe(
      4 * (1 + 1) + 172 + 16 + src.length + 1
    );
  });

  it("페이지 재정렬은 pages 포인터 배열만 센다 — 가장 싼 커밋", () => {
    const before = document(20, 500);
    const after = [...before.slice(1), before[0]];

    expect(measureStudioPagesHistoryEntryBytes(before, after)).toBe(
      STUDIO_HISTORY_POINTER_ARRAY_HEADER_BYTES + STUDIO_HISTORY_POINTER_SLOT_BYTES * 20
    );
  });

  it("레이어 재정렬은 요소를 전부 공유한 채 elements 포인터 배열만 센다", () => {
    const before = document(3, 200);
    const reordered = [...before[0].elements.slice(1), before[0].elements[0]];
    const after: TestPage[] = [{ ...before[0], elements: reordered }, before[1], before[2]];

    expect(measureStudioPagesHistoryEntryBytes(before, after)).toBe(
      STUDIO_HISTORY_POINTER_ARRAY_HEADER_BYTES + STUDIO_HISTORY_POINTER_SLOT_BYTES * 3
        + 60
        + STUDIO_HISTORY_POINTER_ARRAY_HEADER_BYTES + STUDIO_HISTORY_POINTER_SLOT_BYTES * 200
    );
  });

  it("협업 리코실처럼 문서 전체를 재-materialize 하면 문서 기하 전체를 센다", () => {
    const points = Array.from({ length: 240 }, () => 1);
    const before: TestPage[] = Array.from({ length: 2 }, (_, p) => ({
      id: `p${p}`,
      elements: Array.from({ length: 30 }, (_, e) => element(`p${p}-e${e}`, { points })),
    }));
    // `reconcileStudioCrdtSceneGraphPages` 처럼 페이지·요소·채널을 전부 새로 만든다.
    const after: TestPage[] = before.map((current) => ({
      ...current,
      elements: current.elements.map((el) => ({ ...el, points: [...points] })),
    }));

    const perStroke = 48 + STUDIO_HISTORY_DOUBLE_ARRAY_HEADER_BYTES + 8 * points.length;
    const perPage = 60 + STUDIO_HISTORY_POINTER_ARRAY_HEADER_BYTES
      + STUDIO_HISTORY_POINTER_SLOT_BYTES * 30 + 30 * perStroke;
    expect(measureStudioPagesHistoryEntryBytes(before, after)).toBe(
      STUDIO_HISTORY_POINTER_ARRAY_HEADER_BYTES + STUDIO_HISTORY_POINTER_SLOT_BYTES * 2
        + 2 * perPage
    );
  });

  it("문서 크기와 무관하게 요소 무게에는 불변이다 — 구조 공유가 실제로 동작한다", () => {
    const light = document(5, 300);
    const heavy: TestPage[] = light.map((current) => ({
      ...current,
      elements: current.elements.map((el) => ({
        ...el,
        points: Array.from({ length: 6_000 }, () => 1),
      })),
    }));

    expect(measureStudioPagesHistoryEntryBytes(light, patchOneElement(light))).toBe(
      measureStudioPagesHistoryEntryBytes(heavy, patchOneElement(heavy))
    );
  });

  it("같은 배열이면 새로 할당된 것이 없으므로 0 이다", () => {
    const pages = document(3, 10);
    expect(measureStudioPagesHistoryEntryBytes(pages, pages)).toBe(0);
  });
});

// ── 계량기가 조용히 낡지 않는가 ─────────────────────────────────────────────────

type NumericArrayKeysOf<T> = {
  [K in keyof T]-?: NonNullable<T[K]> extends number[] ? K : never;
}[keyof T];
type ElNumericArrayKey = El extends unknown ? NumericArrayKeysOf<El> : never;

/**
 * 요소 타입의 숫자 배열 필드 목록을 **타입 수준에서** 뽑는다. `El` 에 새 `number[]` 필드가 생기면
 * 이 `Record` 가 그 키를 요구해 컴파일이 깨진다 — 계량기가 새 증폭 채널을 못 보고 예산이 소리 없이
 * 헐거워지는 것이 이 설계에서 가장 조용한 실패 모드라서, 런타임 단언이 아니라 컴파일 게이트로 둔다.
 */
const ELEMENT_NUMERIC_ARRAY_KEYS: Record<ElNumericArrayKey, true> = {
  points: true,
  pressures: true,
  tiltXs: true,
  tiltYs: true,
  twists: true,
  speeds: true,
  tangentialPressures: true,
  altitudeAngles: true,
  azimuthAngles: true,
  contactWidths: true,
  contactHeights: true,
  sampleTimeOffsets: true,
  customShapePoints: true,
};

describe("계량기 채널 커버리지", () => {
  it("El 의 숫자 배열 필드와 계량 채널 목록이 정확히 같다", () => {
    expect([...STUDIO_HISTORY_MEASURED_NUMERIC_CHANNELS].sort()).toEqual(
      Object.keys(ELEMENT_NUMERIC_ARRAY_KEYS).sort()
    );
  });
});

// ── 경계가 어디에 서는가 ────────────────────────────────────────────────────────

/** `appendStudioPagesHistorySnapshot` 이 하는 배열 조립을 그대로 재현한다(순수 계획 검증용). */
function appendWithRetention(
  history: TestPage[][],
  nextPages: TestPage[],
  options?: Parameters<typeof applyStudioPagesHistoryRetention>[0]["options"]
) {
  const nextHistory = history.slice();
  const keptLength = nextHistory.length;
  nextHistory.push(nextPages);
  const applied = applyStudioPagesHistoryRetention({
    sourceHistory: history,
    keptLength,
    nextHistory: nextHistory as unknown[],
    options,
  });
  return { history: nextHistory, ...applied };
}

describe("유지 경계 — 개수가 아니라 바이트가 게이트다", () => {
  it("가벼운 편집은 예산에 닿지 않고 개수 방벽까지 자란다", () => {
    let history: TestPage[][] = [document(1, 50)];
    let last = appendWithRetention(history, patchOneElement(history[0]));
    for (let step = 0; step < 400; step += 1) {
      history = last.history;
      last = appendWithRetention(history, patchOneElement(history[history.length - 1]));
    }

    // 오늘의 상한 200 이면 여기서 200 이었다. 예산은 근처에도 안 갔다.
    expect(last.history).toHaveLength(402);
    expect(last.evictedCount).toBe(0);
    expect(last.retainedBytes).toBeLessThan(STUDIO_PAGES_HISTORY_RETAINED_BYTES_BUDGET);
  });

  it("예산을 넘기면 한 커밋이 여러 엔트리를 앞에서 버린다 — 오늘까지 없던 경로", () => {
    const budgetBytes = 4_000;
    let history: TestPage[][] = [document(1, 4)];
    let last = appendWithRetention(history, patchOneElement(history[0]), {
      budgetBytes,
      minEntries: 2,
    });
    for (let step = 0; step < 12; step += 1) {
      history = last.history;
      last = appendWithRetention(history, patchOneElement(history[history.length - 1]), {
        budgetBytes,
        minEntries: 2,
      });
    }
    const depthBeforeHeavyCommit = last.history.length;

    // 3,000 샘플 획 하나를 굽는 커밋 — 혼자서 예산을 여러 엔트리분 넘긴다.
    const base = last.history[last.history.length - 1];
    const heavy: TestPage[] = [
      {
        ...base[0],
        elements: base[0].elements.map((el, index) =>
          index === 0 ? { ...el, points: Array.from({ length: 6_000 }, () => 1) } : el
        ),
      },
    ];
    const heavyAppend = appendWithRetention(last.history, heavy, { budgetBytes, minEntries: 2 });

    expect(heavyAppend.evictedForBudget).toBe(true);
    expect(heavyAppend.evictedCount).toBeGreaterThan(1);
    expect(heavyAppend.history.length).toBeLessThan(depthBeforeHeavyCommit);
    expect(heavyAppend.history).toHaveLength(
      depthBeforeHeavyCommit + 1 - heavyAppend.evictedCount
    );
  });

  it("바닥 아래로는 절대 내려가지 않는다 — 예산을 넘겨서라도 최근 단계를 지킨다", () => {
    const minEntries = 3;
    let history: TestPage[][] = [document(1, 2)];
    let last = appendWithRetention(history, patchOneElement(history[0]), {
      budgetBytes: 1,
      minEntries,
    });
    for (let step = 0; step < 20; step += 1) {
      history = last.history;
      last = appendWithRetention(history, patchOneElement(history[history.length - 1]), {
        budgetBytes: 1,
        minEntries,
      });
    }

    expect(last.history).toHaveLength(minEntries);
    expect(last.retainedBytes).toBeGreaterThan(1);
  });

  it("개수 방벽은 예산이 헐거워도 배열 길이를 묶는다", () => {
    const maxEntries = 12; // 바닥(기본 8)보다 커야 방벽이 실제로 무는 쪽을 본다.
    let history: TestPage[][] = [document(1, 2)];
    let last = appendWithRetention(history, patchOneElement(history[0]), { maxEntries });
    for (let step = 0; step < 20; step += 1) {
      history = last.history;
      last = appendWithRetention(history, patchOneElement(history[history.length - 1]), {
        maxEntries,
      });
    }

    expect(last.history).toHaveLength(maxEntries);
    // 개수 방벽만 물었을 때는 예산 안내를 띄우지 않는다.
    expect(last.evictedForBudget).toBe(false);
    expect(last.evictedCount).toBe(1);
  });

  it("퇴출은 항상 앞에서만 일어난다 — 최신 스냅샷이 마지막 자리를 지킨다", () => {
    const budgetBytes = 3_000;
    let history: TestPage[][] = [document(1, 3)];
    let last = appendWithRetention(history, patchOneElement(history[0]), {
      budgetBytes,
      minEntries: 2,
    });
    for (let step = 0; step < 30; step += 1) {
      history = last.history;
      const next = patchOneElement(history[history.length - 1]);
      last = appendWithRetention(history, next, { budgetBytes, minEntries: 2 });
      expect(last.history[last.history.length - 1]).toBe(next);
    }
  });

  it("장부 누계는 히스토리 배열마다 따로 살아 있다", () => {
    const history: TestPage[][] = [document(2, 10)];
    const appended = appendWithRetention(history, patchOneElement(history[0]));

    expect(readStudioPagesHistoryRetainedBytes(appended.history)).toBe(appended.retainedBytes);
    expect(appended.retainedBytes).toBeGreaterThan(appended.appendedEntryBytes);
  });

  it("장부 미스(밖에서 조립된 히스토리)는 새 엔트리 한계비용으로 대체 계상한다", () => {
    // CRDT 리베이스처럼 이 모듈을 통하지 않고 만들어진 배열.
    const foreign: TestPage[][] = Array.from({ length: 5 }, () => document(1, 4));
    const appended = appendWithRetention(foreign, patchOneElement(foreign[4]));

    // 알려진 엔트리가 하나도 없으므로 5개 전부 새 엔트리 비용으로 물린다(+ 새 엔트리 자신).
    expect(appended.retainedBytes).toBe(appended.appendedEntryBytes * 6);
  });

  it("기본 상수는 출하 값에 고정된다", () => {
    expect(STUDIO_PAGES_HISTORY_RETAINED_BYTES_BUDGET).toBe(192 * 1024 * 1024);
    expect(STUDIO_PAGES_HISTORY_MAX_ENTRIES).toBe(2_000);
    expect(STUDIO_PAGES_HISTORY_MIN_ENTRIES).toBe(8);
    // 브라우저 A/B 실측 1.88배를 안전한 쪽으로 올림한 값. 근거는 모듈 docblock 참고.
    expect(STUDIO_HISTORY_RETAINED_HEAP_CALIBRATION).toBe(2);
  });

  /**
   * 계량기는 V8 슬롯 회계를 그대로 내고, 실제 힙 보정은 예산 장부에서 한 번만 곱한다.
   * 두 사실이 섞이면 닫힌 형태 회귀와 힙 대조 중 하나가 다른 하나를 가린다.
   */
  it("보정 계수는 계량기가 아니라 장부에만 적용된다", () => {
    const history: TestPage[][] = [document(1, 50)];
    const next = patchOneElement(history[0]);
    const appended = appendWithRetention(history, next);

    expect(measureStudioPagesHistoryEntryBytes(history[0], next)).toBe(4 * (1 + 50) + 172);
    expect(appended.appendedEntryBytes).toBe(
      (4 * (1 + 50) + 172) * STUDIO_HISTORY_RETAINED_HEAP_CALIBRATION
    );
  });
});

// ── 아티스트에게 하는 말 ────────────────────────────────────────────────────────

describe("경계가 물었을 때의 안내", () => {
  it("KB · MB 를 사람이 읽는 크기로 적는다", () => {
    expect(formatStudioHistoryBytes(0)).toBe("0 KB");
    expect(formatStudioHistoryBytes(640 * 1024)).toBe("640 KB");
    expect(formatStudioHistoryBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
    expect(formatStudioHistoryBytes(192 * 1024 * 1024)).toBe("192 MB");
  });

  it("무엇이 정리됐는지·단계당 얼마인지·앞으로 몇 단계인지를 전부 말한다", () => {
    const message = describeStudioHistoryBudgetEviction({
      evictedSteps: 412,
      budgetBytes: 192 * 1024 * 1024,
      entryBytes: 581_600,
      retainedSteps: 346,
    });

    expect(message).toContain("192 MB");
    expect(message).toContain("412단계");
    expect(message).toContain("568 KB");
    expect(message).toContain("346단계");
  });

  it("협업 절벽은 원인까지 말한다 — 숨기지 않는다", () => {
    const message = describeStudioHistoryBudgetEviction({
      evictedSteps: 120,
      budgetBytes: 192 * 1024 * 1024,
      entryBytes: 6.46 * 1024 * 1024,
      retainedSteps: 29,
      collaborating: true,
    });

    expect(message).toContain("함께 편집 중에는");
    expect(message).toContain("원격 반영 경로");
  });

  it("솔로 세션에서는 협업 문장을 붙이지 않는다", () => {
    const message = describeStudioHistoryBudgetEviction({
      evictedSteps: 3,
      budgetBytes: 192 * 1024 * 1024,
      entryBytes: 2_252,
      retainedSteps: 1_999,
      collaborating: false,
    });

    expect(message).not.toContain("함께 편집");
  });
});
