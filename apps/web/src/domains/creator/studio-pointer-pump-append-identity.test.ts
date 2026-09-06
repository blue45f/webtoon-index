/**
 * Pointer-pump append identity — 긴 드래그가 길어질수록 느려지던 O(n²) 누적을 없애면서
 * **출력이 한 점도 달라지지 않았음**을 증명한다.
 *
 * 세 가지를 각각 n = 50 / 400 / 3200 및 경계 길이(0·1·2)에서 검증한다.
 *  1. 마스크/히스토리 브러시 궤적: appendBrushPointInPlace ≡ appendBrushPoint (deep-equal)
 *  2. 브라우저 전달 1회당 12배열 복제 → 스트로크당 1회 복제(소유권 토큰): 최종 draft deep-equal
 *  3. appendStylusValue: Array.from + spread → 단일 순회 (같은 값·순서·길이)
 *
 * 2·3의 클로저는 export 되지 않으므로 이 파일의 모델과 **실제 소스 문자열**을 함께 대조한다
 * (레포의 boundary 소스 스캔 관례와 동일 — 모델이 배포 코드와 갈라지면 테스트가 깨진다).
 */
import { describe, expect, it } from "vitest";

import { readStudioCuttoonStagePointersSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";
import {
  appendBrushPoint,
  appendBrushPointInPlace,
  appendLassoPoint,
  appendLassoPointInPlace,
  type SelPoint,
} from "./studio-selection-tools";

const POINTER_SOURCE = readStudioCuttoonStagePointersSource();

/** 실제 드래그처럼 대부분은 채택되고 일부는 최소간격에 걸려 버려지는 궤적. */
function dragSamples(count: number): SelPoint[] {
  const out: SelPoint[] = [];
  for (let index = 0; index < count; index += 1) {
    // 4개 중 1개는 직전 점과 거의 같은 좌표 → 최소간격 필터가 실제로 작동한다.
    const jitter = index % 4 === 3 ? 0 : 0.0009;
    out.push({
      x: 0.1 + index * jitter,
      y: 0.5 + Math.sin(index * 0.37) * 0.03,
    });
  }
  return out;
}

const LENGTHS = [0, 1, 2, 50, 400, 3200];

describe("마스크 브러시 궤적 — 제자리 추가가 불변 추가와 동일", () => {
  for (const count of LENGTHS) {
    it(`appendBrushPointInPlace ≡ appendBrushPoint (n=${count})`, () => {
      const samples = dragSamples(count);

      let immutableTrail: SelPoint[] = [];
      const mutableTrail: SelPoint[] = [];
      const immutableAccepted: boolean[] = [];
      const mutableAccepted: boolean[] = [];

      for (const sample of samples) {
        const grown = appendBrushPoint(immutableTrail, sample, 0.01);
        immutableAccepted.push(grown !== immutableTrail);
        immutableTrail = grown;
        mutableAccepted.push(appendBrushPointInPlace(mutableTrail, sample, 0.01));
      }

      expect(mutableTrail).toEqual(immutableTrail);
      expect(mutableAccepted).toEqual(immutableAccepted);
      // 채택 판정이 실제로 갈리는 입력인지(테스트가 헛돌지 않는지) 확인.
      if (count > 4) expect(mutableAccepted).toContain(false);
    });
  }

  it("appendLassoPointInPlace 도 같은 규약(반경 대신 기본 최소간격)", () => {
    const samples = dragSamples(400);
    let immutableTrail: SelPoint[] = [];
    const mutableTrail: SelPoint[] = [];
    for (const sample of samples) {
      immutableTrail = appendLassoPoint(immutableTrail, sample);
      appendLassoPointInPlace(mutableTrail, sample);
    }
    expect(mutableTrail).toEqual(immutableTrail);
  });

  it("NaN 좌표·NaN 간격에서도 불변 경로와 같은 판정", () => {
    const dirty: SelPoint[] = [{ x: Number.NaN, y: 0.5 }];
    const probe = { x: 0.5, y: 0.5 };
    const immutableResult = appendLassoPoint(dirty, probe);
    const mutable = [...dirty];
    const appended = appendLassoPointInPlace(mutable, probe);
    expect(appended).toBe(immutableResult !== dirty);
    expect(mutable).toEqual(immutableResult);

    const clean: SelPoint[] = [{ x: 0.5, y: 0.5 }];
    const nanDist = Number.NaN;
    const immutableNanDist = appendLassoPoint(clean, probe, nanDist);
    const mutableNanDist = [...clean];
    expect(appendLassoPointInPlace(mutableNanDist, probe, nanDist)).toBe(
      immutableNanDist !== clean,
    );
    expect(mutableNanDist).toEqual(immutableNanDist);
  });

  it("제자리 추가는 거부된 점에서 배열을 건드리지 않는다", () => {
    const trail: SelPoint[] = [];
    expect(appendBrushPointInPlace(trail, { x: 0.5, y: 0.5 }, 0.1)).toBe(true);
    const snapshot = [...trail];
    expect(appendBrushPointInPlace(trail, { x: 0.501, y: 0.5 }, 0.1)).toBe(false);
    expect(trail).toEqual(snapshot);
  });

  it("다섯 개 픽셀 브러시 드래그 전부가 제자리 추가를 쓴다", () => {
    const inPlaceCalls = POINTER_SOURCE.match(/appendBrushPointInPlace\(session\.points/gu) ?? [];
    expect(inPlaceCalls).toHaveLength(5);
    // 궤적을 통째로 다시 만드는 옛 경로가 남아 있으면 안 된다.
    expect(POINTER_SOURCE).not.toContain("session.points = nextPoints");
  });
});

// ---------------------------------------------------------------------------
// 브라우저 전달 1회당 12배열 복제 → 스트로크당 1회
// ---------------------------------------------------------------------------

const BATCH_CHANNELS = [
  "pressures",
  "tiltXs",
  "tiltYs",
  "twists",
  "speeds",
  "tangentialPressures",
  "altitudeAngles",
  "azimuthAngles",
  "contactWidths",
  "contactHeights",
  "sampleTimeOffsets",
] as const;

type BatchDraft = {
  id: string;
  points: number[];
} & { [K in (typeof BATCH_CHANNELS)[number]]: number[] | undefined };

function seedDraft(sampleCount: number, omitted: readonly string[] = []): BatchDraft {
  const points: number[] = [];
  for (let index = 0; index < sampleCount; index += 1) points.push(index * 3, index * 2 + 1);
  const draft = { id: "stroke", points } as BatchDraft;
  for (const channel of BATCH_CHANNELS) {
    draft[channel] = omitted.includes(channel)
      ? undefined
      : Array.from({ length: sampleCount }, (_, index) => index * 0.125);
  }
  return draft;
}

/** BEFORE — 전달마다 12번 spread. */
function cloneEveryDelivery(current: BatchDraft): BatchDraft {
  return {
    ...current,
    points: [...current.points],
    pressures: current.pressures ? [...current.pressures] : undefined,
    tiltXs: current.tiltXs ? [...current.tiltXs] : undefined,
    tiltYs: current.tiltYs ? [...current.tiltYs] : undefined,
    twists: current.twists ? [...current.twists] : undefined,
    speeds: current.speeds ? [...current.speeds] : undefined,
    tangentialPressures: current.tangentialPressures ? [...current.tangentialPressures] : undefined,
    altitudeAngles: current.altitudeAngles ? [...current.altitudeAngles] : undefined,
    azimuthAngles: current.azimuthAngles ? [...current.azimuthAngles] : undefined,
    contactWidths: current.contactWidths ? [...current.contactWidths] : undefined,
    contactHeights: current.contactHeights ? [...current.contactHeights] : undefined,
    sampleTimeOffsets: current.sampleTimeOffsets ? [...current.sampleTimeOffsets] : undefined,
  };
}

/** AFTER — 소유권 토큰이 맞으면 배열을 그대로 이어 쓴다(배포 코드와 같은 형태). */
function cloneWhenUnowned(current: BatchDraft, ownedPoints: number[] | null): BatchDraft {
  const ownsBatchArrays = current.points === ownedPoints;
  const reuseOrCloneBatch = <T,>(values: T[] | undefined): T[] | undefined => {
    if (!values) return values;
    return ownsBatchArrays ? values : [...values];
  };
  return {
    ...current,
    points: ownsBatchArrays ? current.points : [...current.points],
    pressures: reuseOrCloneBatch(current.pressures),
    tiltXs: reuseOrCloneBatch(current.tiltXs),
    tiltYs: reuseOrCloneBatch(current.tiltYs),
    twists: reuseOrCloneBatch(current.twists),
    speeds: reuseOrCloneBatch(current.speeds),
    tangentialPressures: reuseOrCloneBatch(current.tangentialPressures),
    altitudeAngles: reuseOrCloneBatch(current.altitudeAngles),
    azimuthAngles: reuseOrCloneBatch(current.azimuthAngles),
    contactWidths: reuseOrCloneBatch(current.contactWidths),
    contactHeights: reuseOrCloneBatch(current.contactHeights),
    sampleTimeOffsets: reuseOrCloneBatch(current.sampleTimeOffsets),
  };
}

/** 한 번의 전달 안에서 coalesced 샘플을 draft 에 제자리 추가하는 루프(appendFreehandStrokePoint 축약). */
function appendCoalescedSamples(draft: BatchDraft, samples: readonly number[]): void {
  for (const value of samples) {
    const sampleIndex = Math.floor(draft.points.length / 2);
    draft.points.push(value, value + 1);
    for (const channel of BATCH_CHANNELS) {
      const values = draft[channel];
      if (!values) continue;
      if (values.length > sampleIndex) values.length = sampleIndex;
      while (values.length < sampleIndex) values.push(0);
      values.push(value * 0.5);
    }
  }
}

describe("coalesced batch draft — 소유권 토큰이 출력을 바꾸지 않는다", () => {
  for (const deliveries of [25, 200, 1600]) {
    it(`전달 ${deliveries}회(샘플 2개씩) 후 draft 가 deep-equal`, () => {
      let before = seedDraft(1);
      let after = seedDraft(1);
      let owned: number[] | null = null;
      const beforeSnapshots: number[][] = [];
      const afterSnapshots: number[][] = [];

      for (let delivery = 0; delivery < deliveries; delivery += 1) {
        const samples = [delivery * 2, delivery * 2 + 1];

        before = cloneEveryDelivery(before);
        appendCoalescedSamples(before, samples);
        beforeSnapshots.push([...before.points]);

        after = cloneWhenUnowned(after, owned);
        owned = after.points;
        appendCoalescedSamples(after, samples);
        afterSnapshots.push([...after.points]);
      }

      expect(after).toEqual(before);
      // 각 전달이 게시하는 내용도 전달별로 동일하다(값 기준 — 배열 참조만 재사용된다).
      expect(afterSnapshots).toEqual(beforeSnapshots);
    });
  }

  it("첫 전달은 여전히 복제한다 — 이전에 게시된 draft 는 불변으로 남는다", () => {
    const published = seedDraft(400);
    const publishedPoints = published.points;
    const publishedPressures = published.pressures!;

    const draft = cloneWhenUnowned(published, null);
    expect(draft.points).not.toBe(publishedPoints);
    expect(draft.pressures).not.toBe(publishedPressures);

    appendCoalescedSamples(draft, [1, 2, 3]);
    expect(published.points).toHaveLength(800);
    expect(published.pressures).toHaveLength(400);
  });

  it("소유권이 성립한 뒤에는 배열 참조가 유지된다(압력 alias 캐시 적중 조건)", () => {
    const first = cloneWhenUnowned(seedDraft(400), null);
    const second = cloneWhenUnowned(first, first.points);
    expect(second.points).toBe(first.points);
    expect(second.pressures).toBe(first.pressures);
    // 바깥 DrawEl 객체는 매 전달 새로 만들어져야 한다(참조 기반 변경 감지 유지).
    expect(second).not.toBe(first);
  });

  it("points 배열이 교체되면(QuickShape/Shift) 다시 한 번 복제한다", () => {
    const owned = cloneWhenUnowned(seedDraft(400), null);
    const replaced: BatchDraft = { ...owned, points: [...owned.points] };
    const next = cloneWhenUnowned(replaced, owned.points);
    expect(next.points).not.toBe(replaced.points);
    expect(next.pressures).not.toBe(replaced.pressures);
    expect(next.points).toEqual(replaced.points);
  });

  it("없는 채널은 undefined 로 남는다", () => {
    const sparse = seedDraft(50, ["twists", "contactWidths"]);
    const cloned = cloneWhenUnowned(sparse, null);
    expect(cloned.twists).toBeUndefined();
    expect(cloned.contactWidths).toBeUndefined();
    expect(cloned).toEqual(cloneEveryDelivery(sparse));
  });

  it("배포 코드가 이 모델과 같은 소유권 토큰을 쓴다", () => {
    expect(POINTER_SOURCE).toContain(
      "const ownsBatchArrays = current.points === drawingFixedRateOwnedPointsRef.current;",
    );
    expect(POINTER_SOURCE).toContain(
      "points: ownsBatchArrays ? current.points : [...current.points],",
    );
    expect(POINTER_SOURCE).toContain("drawingFixedRateOwnedPointsRef.current = batchDraft.points;");
    for (const channel of BATCH_CHANNELS) {
      expect(POINTER_SOURCE).toContain(`${channel}: reuseOrCloneBatch(current.${channel}),`);
    }
  });
});

// ---------------------------------------------------------------------------
// appendStylusValue
// ---------------------------------------------------------------------------

function appendStylusValueBefore(
  values: number[] | undefined,
  value: number,
  previousPointCount: number,
): number[] {
  const aligned = Array.from({ length: previousPointCount }, (_, index) => values?.[index] ?? 0);
  return [...aligned, value];
}

function appendStylusValueAfter(
  values: number[] | undefined,
  value: number,
  previousPointCount: number,
): number[] {
  const aligned: number[] = [];
  for (let index = 0; index < previousPointCount; index += 1) {
    aligned.push(values?.[index] ?? 0);
  }
  aligned.push(value);
  return aligned;
}

describe("appendStylusValue — 단일 순회가 정렬 복사와 동일", () => {
  for (const pointCount of [0, 1, 2, 50, 400, 3200]) {
    it(`정확히 정렬된 채널 (n=${pointCount})`, () => {
      const values = Array.from({ length: pointCount }, (_, index) => index * 0.03125);
      expect(appendStylusValueAfter(values, 0.75, pointCount)).toEqual(
        appendStylusValueBefore(values, 0.75, pointCount),
      );
    });

    it(`짧은/긴/없는 채널도 동일 (n=${pointCount})`, () => {
      const short = Array.from({ length: Math.max(0, pointCount - 7) }, (_, i) => i * 0.5);
      const long = Array.from({ length: pointCount + 9 }, (_, i) => i * 0.25);
      expect(appendStylusValueAfter(short, 1, pointCount)).toEqual(
        appendStylusValueBefore(short, 1, pointCount),
      );
      expect(appendStylusValueAfter(long, 1, pointCount)).toEqual(
        appendStylusValueBefore(long, 1, pointCount),
      );
      expect(appendStylusValueAfter(undefined, 1, pointCount)).toEqual(
        appendStylusValueBefore(undefined, 1, pointCount),
      );
    });
  }

  it("배포 코드가 이 모델과 같은 단일 순회를 쓴다", () => {
    expect(POINTER_SOURCE).toContain(
      "const appendStylusValue = (values: number[] | undefined, value: number): number[] => {\n"
        + "      const aligned: number[] = [];\n"
        + "      for (let index = 0; index < previousPointCount; index += 1) {\n"
        + "        aligned.push(values?.[index] ?? 0);\n"
        + "      }\n"
        + "      aligned.push(value);\n"
        + "      return aligned;\n"
        + "    };",
    );
    expect(POINTER_SOURCE).not.toContain("(_, index) => values?.[index] ?? 0");
  });
});
