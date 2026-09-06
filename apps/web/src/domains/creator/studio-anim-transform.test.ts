import { describe, expect, it } from "vitest";

import {
  createEmptyAnimationTimelineDoc,
  easeStudioAnimProgress,
  easeStudioAnimProgressExtended,
  isFrameInActiveClipExposure,
  normalizeAnimationTimelineDoc,
  normalizeStudioAnimTransform,
  removeTimelineClip,
  renameTimelineClip,
  resolveActiveClipExposure,
  resolveTimelineTransforms,
  resolveTrackTransformAt,
  setActiveTimelineClip,
  setKeyframeEase,
  setTimelineClip,
  type AnimationTimelineDoc,
  type StudioAnimKeyframe,
} from "./studio-anim-tracks";

describe("studio anim transform tween", () => {
  it("eases and normalizes transform poses", () => {
    expect(easeStudioAnimProgress(0.5, "linear")).toBe(0.5);
    expect(easeStudioAnimProgress(0.5, "ease-in-out")).toBeCloseTo(0.5, 10);
    expect(easeStudioAnimProgress(0.5, "ease-in")).toBeCloseTo(0.25, 10);
    expect(easeStudioAnimProgress(0.5, "ease-out")).toBeCloseTo(0.75, 10);
    expect(easeStudioAnimProgressExtended(0.5, "ease-in")).toBe(
      easeStudioAnimProgress(0.5, "ease-in"),
    );
    expect(normalizeStudioAnimTransform({ scaleX: 0 }).scaleX).toBe(0.01);
  });

  it("interpolates between transform keyframes with ease-in-out", () => {
    const track: StudioAnimKeyframe[] = [
      {
        frameIndex: 0,
        frame: { id: "f0", src: "a", durationMs: 100 },
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        ease: "linear",
      },
      {
        frameIndex: 10,
        frame: { id: "f1", src: "b", durationMs: 100 },
        transform: { x: 100, y: 50, rotation: 90, scaleX: 2, scaleY: 2 },
        ease: "linear",
      },
    ];
    const mid = resolveTrackTransformAt(track, 5);
    expect(mid.x).toBeCloseTo(50, 8);
    expect(mid.y).toBeCloseTo(25, 8);
    expect(mid.rotation).toBeCloseTo(45, 8);
    expect(mid.scaleX).toBeCloseTo(1.5, 8);
  });

  it("holds previous transform when past last keyframe", () => {
    const track: StudioAnimKeyframe[] = [
      {
        frameIndex: 2,
        frame: { id: "f0", src: "a", durationMs: 100 },
        transform: { x: 10, y: 20, rotation: 0, scaleX: 1, scaleY: 1 },
      },
    ];
    expect(resolveTrackTransformAt(track, 0)).toEqual(
      normalizeStudioAnimTransform({ x: 10, y: 20, rotation: 0, scaleX: 1, scaleY: 1 })
    );
    expect(resolveTrackTransformAt(track, 9).x).toBe(10);
  });

  it("resolveTimelineTransforms returns poses only for tracks with transform keyframes", () => {
    const doc = createEmptyAnimationTimelineDoc(12, 12);
    doc.tracks["a"] = [
      {
        frameIndex: 0,
        frame: { id: "f0", src: "a", durationMs: 100 },
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
      },
      {
        frameIndex: 10,
        frame: { id: "f1", src: "b", durationMs: 100 },
        transform: { x: 20, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
      },
    ];
    doc.tracks["b"] = [
      { frameIndex: 0, frame: { id: "f2", src: "c", durationMs: 100 } },
    ];
    const map = resolveTimelineTransforms(doc, ["a", "b", "c"], 5);
    expect(map.has("a")).toBe(true);
    expect(map.get("a")!.x).toBeCloseTo(10, 8);
    expect(map.has("b")).toBe(false);
    expect(map.has("c")).toBe(false);
  });
});

describe("studio anim named clip exposure ranges", () => {
  it("normalizes, activates, and resolves clip exposure windows", () => {
    let doc = createEmptyAnimationTimelineDoc(24, 12);
    doc = setTimelineClip(doc, {
      id: "intro",
      name: "인트로",
      startFrame: 0,
      endFrame: 5,
    });
    doc = setTimelineClip(doc, {
      id: "climax",
      name: "클라이맥스",
      startFrame: 10,
      endFrame: 18,
    });
    expect(doc.clips).toHaveLength(2);

    doc = setActiveTimelineClip(doc, "climax");
    expect(resolveActiveClipExposure(doc)).toMatchObject({
      startFrame: 10,
      endFrame: 18,
      clip: { id: "climax" },
    });
    expect(isFrameInActiveClipExposure(doc, 12)).toBe(true);
    expect(isFrameInActiveClipExposure(doc, 2)).toBe(false);

    const reloaded = normalizeAnimationTimelineDoc(
      JSON.parse(JSON.stringify(doc)) as Partial<AnimationTimelineDoc>
    );
    expect(reloaded.activeClipId).toBe("climax");
    expect(reloaded.clips?.[1]).toMatchObject({ name: "클라이맥스", startFrame: 10, endFrame: 18 });

    doc = removeTimelineClip(doc, "climax");
    expect(doc.activeClipId).toBeUndefined();
    expect(doc.clips).toHaveLength(1);
    expect(resolveActiveClipExposure(doc).startFrame).toBe(0);

    doc = renameTimelineClip(doc, "intro", "  오프닝  ");
    expect(doc.clips?.[0]?.name).toBe("오프닝");
    expect(renameTimelineClip(doc, "missing", "x")).toBe(doc);
  });

  it("patches keyframe ease without dropping transform or frame data", () => {
    let doc = createEmptyAnimationTimelineDoc(12, 12);
    doc = {
      ...doc,
      tracks: {
        layer: [
          {
            frameIndex: 0,
            frame: { id: "f0", src: "a", durationMs: 80 },
            transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
          },
          {
            frameIndex: 6,
            frame: { id: "f1", src: "b", durationMs: 80 },
            transform: { x: 10, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
            ease: "linear",
          },
        ],
      },
    };
    const eased = setKeyframeEase(doc, "layer", 6, "ease-in");
    expect(eased.tracks.layer?.[1]).toMatchObject({
      frameIndex: 6,
      ease: "ease-in",
      frame: { id: "f1", src: "b" },
      transform: { x: 10 },
    });
    expect(setKeyframeEase(eased, "layer", 6, "ease-in")).toBe(eased);
    const cleared = setKeyframeEase(eased, "layer", 6, null);
    expect(cleared.tracks.layer?.[1]?.ease).toBeUndefined();
  });
});
