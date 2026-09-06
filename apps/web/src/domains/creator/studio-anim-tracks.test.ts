import { describe, expect, it } from "vitest";

import {
  DEFAULT_TIMELINE_FRAME_COUNT,
  MAX_TIMELINE_FRAME_COUNT,
  MAX_TRACK_KEYFRAMES,
  canAddKeyframe,
  clampGlobalFrameIndex,
  createEmptyAnimationTimelineDoc,
  duplicateAnimationTracks,
  globalFrameDurationsMs,
  globalFrameIndexAtElapsed,
  hasTrack,
  moveKeyframe,
  normalizeAnimationTimelineDoc,
  onionSkinLayersForTrack,
  removeKeyframe,
  removeTrack,
  resolveTimelineComposite,
  resolveTrackFrameAt,
  setDocFps,
  setFrameCount,
  setKeyframe,
  trackKeyframeIndexOf,
  type AnimationTimelineDoc,
  type StudioAnimKeyframe,
} from "./studio-anim-tracks";
import { DEFAULT_ONION_SKIN } from "./studio-frame-animation";

import type { StudioAnimFrame } from "./studio-frame-animation";

function animFrame(id: string): StudioAnimFrame {
  return { id, src: `data:${id}` };
}

function kf(frameIndex: number, id: string): StudioAnimKeyframe {
  return { frameIndex, frame: animFrame(id) };
}

function makeDoc(tracks: Record<string, StudioAnimKeyframe[]>, frameCount = 10, fps = 12): AnimationTimelineDoc {
  return { fps, frameCount, tracks };
}

// ── 생성/정규화 ──────────────────────────────────────────────────────

describe("createEmptyAnimationTimelineDoc", () => {
  it("기본값으로 빈 문서를 만든다", () => {
    const doc = createEmptyAnimationTimelineDoc();
    expect(doc.frameCount).toBe(DEFAULT_TIMELINE_FRAME_COUNT);
    expect(doc.tracks).toEqual({});
  });

  it("frameCount/fps를 안전 범위로 클램프한다", () => {
    const doc = createEmptyAnimationTimelineDoc(999, 999);
    expect(doc.frameCount).toBe(MAX_TIMELINE_FRAME_COUNT);
    expect(doc.fps).toBe(30);
  });
});

describe("normalizeAnimationTimelineDoc", () => {
  it("undefined면 기본값 문서", () => {
    const doc = normalizeAnimationTimelineDoc(undefined);
    expect(doc.frameCount).toBe(DEFAULT_TIMELINE_FRAME_COUNT);
    expect(doc.tracks).toEqual({});
  });

  it("부분 patch(트랙만)도 기본 fps/frameCount로 채워진다", () => {
    const doc = normalizeAnimationTimelineDoc({ tracks: { a: [kf(0, "f0")] } });
    expect(doc.frameCount).toBe(DEFAULT_TIMELINE_FRAME_COUNT);
    expect(doc.fps).toBe(12);
    expect(doc.tracks.a).toEqual([kf(0, "f0")]);
  });

  it("fps는 normalizeFrameFps 규칙으로 클램프된다", () => {
    expect(normalizeAnimationTimelineDoc({ fps: 0 }).fps).toBe(1);
    expect(normalizeAnimationTimelineDoc({ fps: 999 }).fps).toBe(30);
  });

  it("frameCount 축소 시 범위 밖(frameIndex >= frameCount) 키프레임을 제거한다", () => {
    const doc = normalizeAnimationTimelineDoc({
      frameCount: 3,
      tracks: { a: [kf(0, "f0"), kf(2, "f2"), kf(5, "f5")] },
    });
    expect(doc.tracks.a).toEqual([kf(0, "f0"), kf(2, "f2")]);
  });

  it("정리 결과 트랙이 비면 트랙 키 자체를 지운다", () => {
    const doc = normalizeAnimationTimelineDoc({
      frameCount: 2,
      tracks: { a: [kf(5, "f5")] },
    });
    expect(doc.tracks).toEqual({});
    expect("a" in doc.tracks).toBe(false);
  });

  it("키프레임을 frameIndex 오름차순으로 정렬한다", () => {
    const doc = normalizeAnimationTimelineDoc({
      frameCount: 10,
      tracks: { a: [kf(5, "f5"), kf(1, "f1"), kf(3, "f3")] },
    });
    expect(doc.tracks.a!.map((k) => k.frameIndex)).toEqual([1, 3, 5]);
  });

  it("트랙 하나의 키프레임 수를 MAX_TRACK_KEYFRAMES로 캡한다", () => {
    const many = Array.from({ length: MAX_TRACK_KEYFRAMES + 10 }, (_, i) => kf(i, `f${i}`));
    const doc = normalizeAnimationTimelineDoc({ frameCount: MAX_TIMELINE_FRAME_COUNT, tracks: { a: many } });
    expect(doc.tracks.a).toHaveLength(MAX_TRACK_KEYFRAMES);
  });
});

// ── 문서 레벨 변경 ────────────────────────────────────────────────────

describe("setDocFps", () => {
  it("유효 범위 안이면 갱신", () => {
    const doc = makeDoc({});
    const next = setDocFps(doc, 24);
    expect(next.fps).toBe(24);
    expect(next).not.toBe(doc);
  });

  it("같은 값이면 no-op(동일 참조)", () => {
    const doc = makeDoc({}, 10, 12);
    expect(setDocFps(doc, 12)).toBe(doc);
  });

  it("키프레임 위치(frameIndex)는 건드리지 않는다", () => {
    const doc = makeDoc({ a: [kf(2, "f2")] });
    const next = setDocFps(doc, 24);
    expect(next.tracks.a).toEqual([kf(2, "f2")]);
  });
});

describe("setFrameCount", () => {
  it("같은 값이면 no-op(동일 참조)", () => {
    const doc = makeDoc({}, 10);
    expect(setFrameCount(doc, 10)).toBe(doc);
  });

  it("줄이면 범위 밖 키프레임을 제거(normalizeAnimationTimelineDoc과 동일 규칙)", () => {
    const doc = makeDoc({ a: [kf(0, "f0"), kf(8, "f8")] }, 10);
    const next = setFrameCount(doc, 5);
    expect(next.frameCount).toBe(5);
    expect(next.tracks.a).toEqual([kf(0, "f0")]);
  });

  it("늘리면 기존 키프레임은 그대로 유지", () => {
    const doc = makeDoc({ a: [kf(0, "f0")] }, 5);
    const next = setFrameCount(doc, 20);
    expect(next.frameCount).toBe(20);
    expect(next.tracks.a).toEqual([kf(0, "f0")]);
  });
});

// ── 트랙/키프레임 조회 ────────────────────────────────────────────────

describe("hasTrack / canAddKeyframe", () => {
  it("트랙에 키프레임이 있으면 true, 없거나 빈 배열이면 false", () => {
    const doc = makeDoc({ a: [kf(0, "f0")], b: [] });
    expect(hasTrack(doc, "a")).toBe(true);
    expect(hasTrack(doc, "b")).toBe(false);
    expect(hasTrack(doc, "missing")).toBe(false);
  });

  it("트랙이 상한 미만이면 추가 가능", () => {
    const doc = makeDoc({ a: [kf(0, "f0")] });
    expect(canAddKeyframe(doc, "a")).toBe(true);
    expect(canAddKeyframe(doc, "missing")).toBe(true);
  });

  it("트랙이 MAX_TRACK_KEYFRAMES에 도달하면 추가 불가", () => {
    const full = Array.from({ length: MAX_TRACK_KEYFRAMES }, (_, i) => kf(i, `f${i}`));
    const doc = makeDoc({ a: full }, MAX_TIMELINE_FRAME_COUNT);
    expect(canAddKeyframe(doc, "a")).toBe(false);
  });
});

describe("trackKeyframeIndexOf", () => {
  it("정확히 일치하는 frameIndex의 배열 위치를 찾는다", () => {
    const track = [kf(1, "a"), kf(3, "b"), kf(5, "c")];
    expect(trackKeyframeIndexOf(track, 3)).toBe(1);
    expect(trackKeyframeIndexOf(track, 2)).toBe(-1); // held 값이 있어도 정확매칭 아니면 -1
  });
});

describe("resolveTrackFrameAt", () => {
  it("빈 트랙이면 null", () => {
    expect(resolveTrackFrameAt([], 5)).toBeNull();
  });

  it("첫 키프레임보다 앞이면 null", () => {
    const track = [kf(3, "a")];
    expect(resolveTrackFrameAt(track, 0)).toBeNull();
    expect(resolveTrackFrameAt(track, 2)).toBeNull();
  });

  it("held-until-next — 가장 최근(≤ index) 키프레임 값을 유지", () => {
    const track = [kf(0, "a"), kf(3, "b"), kf(7, "c")];
    expect(resolveTrackFrameAt(track, 0)?.id).toBe("a");
    expect(resolveTrackFrameAt(track, 1)?.id).toBe("a");
    expect(resolveTrackFrameAt(track, 2)?.id).toBe("a");
    expect(resolveTrackFrameAt(track, 3)?.id).toBe("b");
    expect(resolveTrackFrameAt(track, 6)?.id).toBe("b");
    expect(resolveTrackFrameAt(track, 7)?.id).toBe("c");
  });

  it("globalIndex가 마지막 키프레임보다 커도(frameCount 밖) 마지막 값을 유지", () => {
    const track = [kf(0, "a"), kf(3, "b")];
    expect(resolveTrackFrameAt(track, 999)?.id).toBe("b");
  });
});

describe("resolveTimelineComposite", () => {
  it("zOrderIds 순서(삽입 순)를 보존한다", () => {
    const doc = makeDoc({
      front: [kf(0, "front0")],
      back: [kf(0, "back0")],
    });
    // zOrderIds는 BACK→FRONT 순서 — back이 먼저 와야 Map 삽입 순서가 뒤바뀌지 않는다.
    const composite = resolveTimelineComposite(doc, ["back", "front"], 0);
    expect([...composite.keys()]).toEqual(["back", "front"]);
    expect(composite.get("back")?.id).toBe("back0");
    expect(composite.get("front")?.id).toBe("front0");
  });

  it("트랙이 없거나 resolve가 null인 요소는 결과에서 제외된다", () => {
    const doc = makeDoc({ a: [kf(3, "a3")] });
    const composite = resolveTimelineComposite(doc, ["a", "b"], 0); // a는 첫 키프레임 이전, b는 트랙 없음
    expect(composite.size).toBe(0);
  });

  it("빈 doc이면 빈 Map", () => {
    const doc = makeDoc({});
    expect(resolveTimelineComposite(doc, ["a", "b"], 0).size).toBe(0);
  });
});

// ── 트랙/키프레임 편집 ────────────────────────────────────────────────

describe("setKeyframe", () => {
  it("신규 삽입 시 frameIndex 오름차순 정렬을 유지한다", () => {
    const doc = makeDoc({ a: [kf(0, "f0"), kf(5, "f5")] });
    const next = setKeyframe(doc, "a", 2, animFrame("f2"));
    expect(next.tracks.a!.map((k) => k.frameIndex)).toEqual([0, 2, 5]);
  });

  it("같은 frameIndex면 교체(길이 불변)", () => {
    const doc = makeDoc({ a: [kf(0, "f0"), kf(2, "old")] });
    const next = setKeyframe(doc, "a", 2, animFrame("new"));
    expect(next.tracks.a).toHaveLength(2);
    expect(next.tracks.a![1]).toEqual({ frameIndex: 2, frame: animFrame("new") });
  });

  it("frameIndex를 [0, frameCount-1]로 클램프한다", () => {
    const doc = makeDoc({}, 5);
    expect(setKeyframe(doc, "a", -3, animFrame("x")).tracks.a![0]!.frameIndex).toBe(0);
    expect(setKeyframe(doc, "a", 999, animFrame("x")).tracks.a![0]!.frameIndex).toBe(4);
  });

  it("MAX_TRACK_KEYFRAMES 상한에서 신규 삽입은 무추가(원본과 동일 참조)", () => {
    const full = Array.from({ length: MAX_TRACK_KEYFRAMES }, (_, i) => kf(i, `f${i}`));
    const doc = makeDoc({ a: full }, MAX_TIMELINE_FRAME_COUNT);
    // 상한에 도달했어도 "기존 frameIndex 교체"는 여전히 허용돼야 한다.
    const replaced = setKeyframe(doc, "a", 0, animFrame("replaced"));
    expect(replaced.tracks.a![0]).toEqual({ frameIndex: 0, frame: animFrame("replaced") });
  });
});

describe("removeKeyframe", () => {
  it("존재하는 키프레임을 제거한다", () => {
    const doc = makeDoc({ a: [kf(0, "f0"), kf(2, "f2")] });
    const next = removeKeyframe(doc, "a", 0);
    expect(next.tracks.a).toEqual([kf(2, "f2")]);
  });

  it("존재하지 않는 frameIndex는 no-op(동일 참조)", () => {
    const doc = makeDoc({ a: [kf(0, "f0")] });
    expect(removeKeyframe(doc, "a", 9)).toBe(doc);
  });

  it("트랙 자체가 없으면 no-op(동일 참조)", () => {
    const doc = makeDoc({});
    expect(removeKeyframe(doc, "missing", 0)).toBe(doc);
  });

  it("마지막 1개를 제거하면 트랙 키 자체를 지운다(단일-셀의 '마지막 1장 삭제 거부'와 의도적으로 다름)", () => {
    const doc = makeDoc({ a: [kf(0, "only")] });
    const next = removeKeyframe(doc, "a", 0);
    expect(next.tracks).toEqual({});
    expect("a" in next.tracks).toBe(false);
  });
});

describe("moveKeyframe", () => {
  it("정상 이동", () => {
    const doc = makeDoc({ a: [kf(0, "f0"), kf(2, "f2")] });
    const next = moveKeyframe(doc, "a", 0, 5);
    expect(next.tracks.a!.map((k) => [k.frameIndex, k.frame.id])).toEqual([
      [2, "f2"],
      [5, "f0"],
    ]);
  });

  it("목적지에 이미 키프레임이 있으면 덮어쓴다", () => {
    const doc = makeDoc({ a: [kf(0, "moving"), kf(3, "victim")] });
    const next = moveKeyframe(doc, "a", 0, 3);
    expect(next.tracks.a).toEqual([kf(3, "moving")]);
  });

  it("존재하지 않는 fromFrameIndex는 no-op(동일 참조)", () => {
    const doc = makeDoc({ a: [kf(0, "f0")] });
    expect(moveKeyframe(doc, "a", 9, 1)).toBe(doc);
  });

  it("트랙 자체가 없으면 no-op(동일 참조)", () => {
    const doc = makeDoc({});
    expect(moveKeyframe(doc, "missing", 0, 1)).toBe(doc);
  });

  it("from과 to가 같으면 no-op(동일 참조)", () => {
    const doc = makeDoc({ a: [kf(2, "f2")] });
    expect(moveKeyframe(doc, "a", 2, 2)).toBe(doc);
  });

  it("toFrameIndex를 [0, frameCount-1]로 클램프한다", () => {
    const doc = makeDoc({ a: [kf(0, "f0")] }, 5);
    const next = moveKeyframe(doc, "a", 0, 999);
    expect(next.tracks.a![0]!.frameIndex).toBe(4);
  });
});

describe("removeTrack", () => {
  it("트랙을 지운다", () => {
    const doc = makeDoc({ a: [kf(0, "f0")], b: [kf(0, "b0")] });
    const next = removeTrack(doc, "a");
    expect(next.tracks).toEqual({ b: [kf(0, "b0")] });
  });

  it("없는 트랙은 no-op(동일 참조)", () => {
    const doc = makeDoc({});
    expect(removeTrack(doc, "missing")).toBe(doc);
  });
});

describe("duplicateAnimationTracks", () => {
  it("duplicates mapped tracks with independent frame ids and preserves timing/source data", () => {
    const doc = makeDoc({
      source: [
        {
          frameIndex: 0,
          frame: { id: "frame-a", src: "data:a", durationMs: 80 },
          transform: { x: 12, y: -4, rotation: 15, scaleX: 1.2, scaleY: 0.8 },
          ease: "ease-in-out",
        },
        { frameIndex: 4, frame: { id: "frame-b", src: "data:b", durationMs: 120 } },
      ],
      untouched: [kf(1, "untouched")],
    });
    let sequence = 0;
    const next = duplicateAnimationTracks(
      doc,
      new Map([
        ["source", "copy"],
        ["missing", "missing-copy"],
      ]),
      () => `copy-frame-${++sequence}`
    );

    expect(next).not.toBe(doc);
    expect(next.tracks.source).toBe(doc.tracks.source);
    expect(next.tracks.untouched).toBe(doc.tracks.untouched);
    expect(next.tracks.copy).toEqual([
      {
        frameIndex: 0,
        frame: { id: "copy-frame-1", src: "data:a", durationMs: 80 },
        transform: { x: 12, y: -4, rotation: 15, scaleX: 1.2, scaleY: 0.8 },
        ease: "ease-in-out",
      },
      { frameIndex: 4, frame: { id: "copy-frame-2", src: "data:b", durationMs: 120 } },
    ]);
    expect(next.tracks.copy![0]!.transform).not.toBe(doc.tracks.source![0]!.transform);
  });

  it("returns the original document when no mapped source has a track", () => {
    const doc = makeDoc({ source: [kf(0, "a")] });
    expect(
      duplicateAnimationTracks(doc, new Map([["missing", "copy"]]), () => "unused")
    ).toBe(doc);
  });
});

// ── 재생 타이밍 ──────────────────────────────────────────────────────

describe("globalFrameDurationsMs / globalFrameIndexAtElapsed", () => {
  it("fps 기반 균등 시간 배열을 frameCount 길이로 만든다", () => {
    const doc = makeDoc({}, 4, 10); // 100ms씩 4프레임
    expect(globalFrameDurationsMs(doc)).toEqual([100, 100, 100, 100]);
  });

  it("frameIndexAtElapsed에 올바른 인자로 위임한다(경과시간 → 인덱스)", () => {
    const doc = makeDoc({}, 3, 10); // 100ms씩 3프레임, 총 300ms
    expect(globalFrameIndexAtElapsed(doc, 0, true)).toBe(0);
    expect(globalFrameIndexAtElapsed(doc, 150, true)).toBe(1);
    expect(globalFrameIndexAtElapsed(doc, 250, true)).toBe(2);
    expect(globalFrameIndexAtElapsed(doc, 300, true)).toBe(0); // loop=true면 래핑
  });
});

describe("clampGlobalFrameIndex", () => {
  it("[0, frameCount-1]로 클램프", () => {
    expect(clampGlobalFrameIndex(10, -5)).toBe(0);
    expect(clampGlobalFrameIndex(10, 999)).toBe(9);
    expect(clampGlobalFrameIndex(10, 4)).toBe(4);
  });

  it("frameCount가 0 이하면 0", () => {
    expect(clampGlobalFrameIndex(0, 5)).toBe(0);
  });
});

// ── 어니언스키닝 다리 ──────────────────────────────────────────────────

describe("onionSkinLayersForTrack", () => {
  it("트랙이 비어 있으면 빈 배열", () => {
    expect(onionSkinLayersForTrack([], 5, DEFAULT_ONION_SKIN)).toEqual([]);
  });

  it("activeFrameIndex에 가장 가까운 트랙 내 위치를 기준으로 위임한다", () => {
    // 트랙 키프레임: 인덱스 위치 0=frameIndex 0, 위치 1=frameIndex 5, 위치 2=frameIndex 10
    const track = [kf(0, "a"), kf(5, "b"), kf(10, "c")];
    // activeFrameIndex=7 → "가장 최근 keyframe.frameIndex <= 7"은 frameIndex=5(배열 위치 1)
    const layers = onionSkinLayersForTrack(track, 7, { ...DEFAULT_ONION_SKIN, prevCount: 1, nextCount: 1 });
    expect(layers.map((l) => l.frame.id)).toEqual(["a", "c"]); // 위치1 기준 이전=위치0(a), 다음=위치2(c)
  });

  it("disabled면 빈 배열(onionSkinLayers 위임 확인)", () => {
    const track = [kf(0, "a"), kf(1, "b")];
    expect(onionSkinLayersForTrack(track, 1, { ...DEFAULT_ONION_SKIN, enabled: false })).toEqual([]);
  });

  it("activeFrameIndex가 첫 키프레임보다 앞이면 빈 배열(resolveTrackFrameAt=null과 동일 계약)", () => {
    // 회귀 테스트: 트랙이 아직 시작되지 않은 구간(첫 keyframe 이전)에서 pos가 0으로
    // 초기화된 채 방치되면 "아직 오지 않은 미래 키프레임"이 온스킨 레이어로 새어 나온다.
    const track = [kf(5, "a"), kf(10, "b")];
    expect(onionSkinLayersForTrack(track, 2, { ...DEFAULT_ONION_SKIN, prevCount: 1, nextCount: 1 })).toEqual([]);
    expect(onionSkinLayersForTrack(track, 4, { ...DEFAULT_ONION_SKIN, prevCount: 1, nextCount: 1 })).toEqual([]);
    // 첫 키프레임에 정확히 도달하면 그때부터는 정상적으로 계산된다.
    expect(onionSkinLayersForTrack(track, 5, { ...DEFAULT_ONION_SKIN, prevCount: 1, nextCount: 1 }).map((l) => l.frame.id)).toEqual(["b"]);
  });
});
