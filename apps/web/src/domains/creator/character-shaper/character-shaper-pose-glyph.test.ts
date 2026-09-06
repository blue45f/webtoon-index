import { describe, expect, it } from "vitest";

import { EXTRA_POSE_PRESETS, NATURAL_IDLE_POSES } from "../studio-pose-presets";

import {
  CHARACTER_POSE_GLYPH_PRESETS,
  STANDING_CHARACTER_POSE_GLYPH,
  buildCharacterPoseGlyph,
  buildCharacterPoseGlyphDetail,
  characterPoseGlyphJoints,
  characterPoseGlyphToPolyline,
  findCharacterPosePreset,
  resolveCharacterPoseGlyph,
  resolveCharacterPoseGlyphDetail,
} from "./character-shaper-pose-glyph";

import type { StudioPosePreset } from "../studio-pose-presets";
import type { CharacterPoseGlyphFigure } from "./character-shaper-contract";

const JOINT_KEYS = [
  "head",
  "neck",
  "hips",
  "leftHand",
  "rightHand",
  "leftElbow",
  "rightElbow",
  "leftKnee",
  "rightKnee",
  "leftFoot",
  "rightFoot",
] as const;

function expectInUnitBox(figure: CharacterPoseGlyphFigure) {
  for (const key of JOINT_KEYS) {
    const [x, y] = figure[key];
    expect(Number.isFinite(x), `${key}.x`).toBe(true);
    expect(Number.isFinite(y), `${key}.y`).toBe(true);
    expect(x, `${key}.x`).toBeGreaterThanOrEqual(0);
    expect(x, `${key}.x`).toBeLessThanOrEqual(1);
    expect(y, `${key}.y`).toBeGreaterThanOrEqual(0);
    expect(y, `${key}.y`).toBeLessThanOrEqual(1);
  }
}

const deg = (value: number) => (value * Math.PI) / 180;

describe("STANDING_CHARACTER_POSE_GLYPH", () => {
  it("is an upright figure with hanging arms inside the unit box", () => {
    const figure = STANDING_CHARACTER_POSE_GLYPH;
    expectInUnitBox(figure);
    expect(figure.head[1]).toBeLessThan(figure.neck[1]);
    expect(figure.neck[1]).toBeLessThan(figure.hips[1]);
    expect(figure.hips[1]).toBeLessThan(figure.leftKnee[1]);
    expect(figure.leftKnee[1]).toBeLessThan(figure.leftFoot[1]);
    expect(figure.rightKnee[1]).toBeLessThan(figure.rightFoot[1]);
    // Character left lands on the viewer's right, exactly like the front camera.
    expect(figure.leftHand[0]).toBeGreaterThan(0.5);
    expect(figure.rightHand[0]).toBeLessThan(0.5);
    expect(figure.leftHand[1]).toBeGreaterThan(figure.hips[1]);
    expect(Object.isFrozen(figure)).toBe(true);
  });
});

describe("resolveCharacterPoseGlyph", () => {
  it("looks up NATURAL_IDLE_POSES and EXTRA_POSE_PRESETS by id", () => {
    expect(CHARACTER_POSE_GLYPH_PRESETS).toHaveLength(NATURAL_IDLE_POSES.length + EXTRA_POSE_PRESETS.length);
    expect(findCharacterPosePreset("ni_weight_left")?.label).toBe("자연 대기 A");
    expect(findCharacterPosePreset("xp_sprint")?.label).toBe("전력 질주");
    expect(findCharacterPosePreset("nope")).toBeNull();
  });

  it("falls back to the standing glyph for unknown ids", () => {
    expect(resolveCharacterPoseGlyph("does-not-exist")).toBe(STANDING_CHARACTER_POSE_GLYPH);
    expect(resolveCharacterPoseGlyph("")).toBe(STANDING_CHARACTER_POSE_GLYPH);
  });

  it("keeps a running pose distinct from standing while staying inside 0..1", () => {
    const sprint = resolveCharacterPoseGlyph("xp_sprint");
    const run = resolveCharacterPoseGlyph("xp_run");
    expectInUnitBox(sprint);
    expectInUnitBox(run);
    expect(sprint).not.toEqual(STANDING_CHARACTER_POSE_GLYPH);
    expect(run).not.toEqual(STANDING_CHARACTER_POSE_GLYPH);
    expect(sprint).not.toEqual(run);
    // Forward-swung sprint legs foreshorten: the feet sit well above the standing footprint.
    expect(sprint.leftFoot[1]).toBeLessThan(STANDING_CHARACTER_POSE_GLYPH.leftFoot[1]);
  });

  it("projects every bundled preset without NaN or overflow", () => {
    for (const preset of CHARACTER_POSE_GLYPH_PRESETS) {
      expectInUnitBox(resolveCharacterPoseGlyph(preset.id));
    }
  });

  it("is deterministic and memoized per id", () => {
    const first = resolveCharacterPoseGlyphDetail("xp_banzai");
    const second = resolveCharacterPoseGlyphDetail("xp_banzai");
    expect(second).toBe(first);
    const preset = findCharacterPosePreset("xp_banzai");
    expect(preset).not.toBeNull();
    expect(buildCharacterPoseGlyph(preset!)).toEqual(first.figure);
    expect(buildCharacterPoseGlyphDetail(preset!)).toEqual(first);
  });
});

describe("buildCharacterPoseGlyph", () => {
  it("raises both arms symmetrically for 만세 (y up in the preset → up on screen)", () => {
    const figure = resolveCharacterPoseGlyph("xp_banzai");
    expect(figure.leftHand[1]).toBeLessThan(figure.head[1]);
    expect(figure.rightHand[1]).toBeLessThan(figure.head[1]);
    expect(figure.leftHand[0] - 0.5).toBeCloseTo(0.5 - figure.rightHand[0], 3);
  });

  it("raises only the waving hand for 손들어 인사", () => {
    const figure = resolveCharacterPoseGlyph("xp_wave_greeting");
    expect(figure.rightHand[1]).toBeLessThan(figure.neck[1]);
    expect(figure.leftHand[1]).toBeGreaterThan(figure.hips[1]);
  });

  it("foreshortens a limb aimed at the camera but keeps a visible stub", () => {
    const detail = resolveCharacterPoseGlyphDetail("xp_point_you");
    const joints = characterPoseGlyphJoints(detail.figure);
    const reach = Math.hypot(
      detail.figure.rightHand[0] - joints.rightShoulder[0],
      detail.figure.rightHand[1] - joints.rightShoulder[1],
    );
    const standingReach = Math.hypot(
      STANDING_CHARACTER_POSE_GLYPH.rightHand[0] - joints.rightShoulder[0],
      STANDING_CHARACTER_POSE_GLYPH.rightHand[1] - joints.rightShoulder[1],
    );
    expect(reach).toBeGreaterThan(0.05);
    expect(reach).toBeLessThan(standingReach * 0.6);
    expect(detail.depth.rightHand).toBeGreaterThan(0.8);
    expect(detail.depth.leftHand).toBeLessThan(0.3);
  });

  it("lowers the head for a bow and ignores yOffset", () => {
    const bow = resolveCharacterPoseGlyph("xp_polite_bow");
    expect(bow.head[1]).toBeGreaterThan(STANDING_CHARACTER_POSE_GLYPH.head[1]);
    expect(bow.hips).toEqual(STANDING_CHARACTER_POSE_GLYPH.hips);
    expect(bow.neck).toEqual(STANDING_CHARACTER_POSE_GLYPH.neck);
  });

  it("rotates the T-pose rest direction for rotation-only limbs and carries the parent frame", () => {
    const preset: StudioPosePreset = {
      id: "test:rotation-only",
      label: "회전",
      tone: "테스트",
      bones: {
        leftUpperArm: { rotation: [0, 0, deg(-90)] },
        rightUpperArm: { direction: [0, -1, 0] },
        rightLowerArm: { rotation: [0, 0, deg(-90)] },
      },
    };
    const figure = buildCharacterPoseGlyph(preset);
    const joints = characterPoseGlyphJoints(figure);
    expectInUnitBox(figure);
    // Left upper arm rolled −90° about Z hangs straight down from the shoulder.
    expect(figure.leftElbow[1]).toBeGreaterThan(joints.leftShoulder[1] + 0.1);
    expect(figure.leftElbow[0]).toBeCloseTo(joints.leftShoulder[0], 3);
    // The right forearm rotates inside the aimed (hanging) upper-arm frame: its −90° Z roll turns
    // the rest direction to +Y, which the frame carries to world −X — a forearm swung outward.
    expect(figure.rightHand[0]).toBeLessThan(figure.rightElbow[0] - 0.05);
    expect(figure.rightHand[1]).toBeCloseTo(figure.rightElbow[1], 2);
  });

  it("survives degenerate or missing bone data", () => {
    const preset: StudioPosePreset = {
      id: "test:degenerate",
      label: "빈 포즈",
      tone: "테스트",
      bones: {
        leftUpperArm: { direction: [0, 0, 0] },
        leftLowerArm: { direction: { sideX: Number.NaN, y: Number.NaN } },
        rightUpperLeg: { direction: [0, 0, 1] },
        head: { rotation: [Number.POSITIVE_INFINITY, 0, 0] },
      },
    };
    const figure = buildCharacterPoseGlyph(preset);
    expectInUnitBox(figure);
    // A leg pointing straight at the camera still draws a stub below the hip.
    expect(figure.rightKnee[1]).toBeGreaterThan(figure.hips[1]);
    expect(buildCharacterPoseGlyph({ id: "empty", label: "", tone: "", bones: {} })).toEqual(
      buildCharacterPoseGlyph({ id: "empty2", label: "", tone: "", bones: {} }),
    );
  });
});

describe("characterPoseGlyphToPolyline", () => {
  it("returns spine, shoulder line, arms and legs anchored on the derived joints", () => {
    const figure = STANDING_CHARACTER_POSE_GLYPH;
    const joints = characterPoseGlyphJoints(figure);
    const polylines = characterPoseGlyphToPolyline(figure);
    expect(polylines).toHaveLength(6);
    expect(polylines[0]).toEqual([figure.hips, figure.neck, figure.head]);
    expect(polylines[2]).toEqual([joints.leftShoulder, figure.leftElbow, figure.leftHand]);
    expect(polylines[5]).toEqual([joints.rightHip, figure.rightKnee, figure.rightFoot]);
    expect(joints.leftShoulder[0]).toBeGreaterThan(joints.rightShoulder[0]);
    expect(joints.leftHip[0]).toBeGreaterThan(joints.rightHip[0]);
  });
});
