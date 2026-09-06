import { describe, expect, it } from "vitest";

import { BRUSH_PRESETS } from "../studio-brush";

import {
  createStudioBuiltInBrushDefaultRestoreProfile,
  createStudioSavedBrushDefaultRestoreProfile,
  planStudioBrushDefaultRestore,
  resolveStudioCoreBrushDefaultRestoreProfile,
  studioBrushDefaultRestoreValuesEqual,
  studioBrushSnapshotForDefaultRestore,
} from "./studio-brush-default-restore";
import {
  studioBrushDynamicsPresetSettings,
  studioBrushDynamicsSettingsEqual,
} from "./studio-brush-dynamics";
import {
  DEFAULT_STUDIO_BRUSH_SNAPSHOT,
  type StudioBrushSnapshot,
  type StudioSavedBrush,
} from "./studio-brush-library";
import { studioCoreBrushCatalogSelection } from "./studio-brush-selection";

function snapshot(
  overrides: Partial<StudioBrushSnapshot> = {},
): StudioBrushSnapshot {
  return {
    ...DEFAULT_STUDIO_BRUSH_SNAPSHOT,
    brushDynamics: studioBrushDynamicsPresetSettings("ink-particle"),
    ...overrides,
  };
}

describe("studio brush default restore contract", () => {
  it("resolves the exact core width, opacity and dynamics without changing brush identity or color", () => {
    const current = snapshot({
      brushId: "spray",
      strokeWidth: 11,
      brushOpacity: 0.9,
      color: "#123456",
      stabilizer: 8,
      postCorrection: 7,
      pressureCurve: 1.8,
      pressureMinSize: 0.7,
      tipAngle: 75,
      tipRoundness: 0.9,
      brushDynamics: studioBrushDynamicsPresetSettings("ink-particle"),
    });
    const profile = resolveStudioCoreBrushDefaultRestoreProfile("spray");
    const sprayPreset = BRUSH_PRESETS.find((preset) => preset.id === "spray")!;
    const canonicalSelection = studioCoreBrushCatalogSelection(sprayPreset);

    expect(profile).not.toBeNull();
    expect(profile).toMatchObject({
      source: "built-in",
      sourceId: "spray",
      sourceName: "미세 스프레이",
      values: {
        strokeWidth: 40,
        brushOpacity: 0.55,
        // 2026-08-14: 기본 선 보정이 속도 적응 3(느린 장선 손떨림 절반)으로 바뀌었다.
        stabilizer: 3,
        postCorrection: 0,
        pressureCurve: 1,
        pressureMinSize: 0,
        tipAngle: -30,
        tipRoundness: 0.24,
      },
    });
    expect(studioBrushDynamicsSettingsEqual(
      profile!.values.brushDynamics,
      canonicalSelection.brushDynamics,
    )).toBe(true);

    const transaction = planStudioBrushDefaultRestore(current, profile!);
    const restored = studioBrushSnapshotForDefaultRestore(current, transaction, "redo");

    expect(restored.brushId).toBe("spray");
    expect(restored.color).toBe("#123456");
    expect(restored.strokeWidth).toBe(40);
    expect(restored.brushOpacity).toBe(0.55);
    expect(transaction.changes.map(({ field }) => field)).toEqual(expect.arrayContaining([
      "strokeWidth",
      "brushOpacity",
      "brushDynamics",
      "stabilizer",
      "postCorrection",
      "pressureCurve",
      "pressureMinSize",
      "tipAngle",
      "tipRoundness",
    ]));
    expect(transaction.summary).toContain("외");
  });

  it("uses the canonical catalogue selection defaults for every core restore profile", () => {
    for (const preset of BRUSH_PRESETS) {
      const selection = studioCoreBrushCatalogSelection(preset);
      const profile = resolveStudioCoreBrushDefaultRestoreProfile(preset.id);

      expect(profile, `${preset.id}: missing restore profile`).not.toBeNull();
      expect(profile, `${preset.id}: identity or scalar defaults drifted`).toMatchObject({
        source: "built-in",
        sourceId: selection.catalogId,
        sourceName: selection.catalogName,
        values: {
          strokeWidth: selection.defaultWidth,
          brushOpacity: selection.defaultOpacity,
        },
      });
      expect(
        studioBrushDynamicsSettingsEqual(
          profile!.values.brushDynamics,
          selection.brushDynamics,
        ),
        `${preset.id}: restore dynamics drifted from catalogue selection`,
      ).toBe(true);
    }
  });

  it("creates a detached full profile from an extended catalogue selection", () => {
    const dynamics = studioBrushDynamicsPresetSettings("dry-media");
    const profile = createStudioBuiltInBrushDefaultRestoreProfile({
      catalogId: "pro-pencil",
      catalogName: "프로 연필",
      runtimeBrushId: "dry-media",
      operation: "paint",
      defaultWidth: 3.25,
      defaultOpacity: 0.82,
      brushDynamics: dynamics,
    });

    dynamics.width.base = 70;

    expect(profile.values.strokeWidth).toBe(3.25);
    expect(profile.values.brushOpacity).toBe(0.82);
    expect(profile.values.brushDynamics.width.base).not.toBe(70);
    expect(profile.values.stampTuning).toBeNull();
  });

  it("restores a user brush only from its own persisted snapshot", () => {
    const saved: StudioSavedBrush = {
      ...snapshot({
        brushId: "calligraphy",
        strokeWidth: 17,
        brushOpacity: 0.72,
        color: "#884422",
        pressureCurve: 0.65,
        pressureMinSize: 0.12,
        tiltEnabled: true,
        tipAngle: -45,
        tipRoundness: 0.18,
      }),
      id: "saved-1",
      name: "내 레터링 붓",
      createdAt: 1,
      updatedAt: 2,
      pinned: false,
      lastUsedAt: null,
    };
    const current = {
      ...saved,
      strokeWidth: 44,
      brushOpacity: 1,
      pressureCurve: 2.2,
      tipAngle: 80,
    };
    const profile = createStudioSavedBrushDefaultRestoreProfile(saved);
    const transaction = planStudioBrushDefaultRestore(current, profile);
    const restored = studioBrushSnapshotForDefaultRestore(current, transaction, "redo");

    expect(profile).toMatchObject({
      source: "saved",
      sourceId: "saved-1",
      sourceName: "내 레터링 붓",
    });
    expect(restored).toMatchObject({
      strokeWidth: 17,
      brushOpacity: 0.72,
      pressureCurve: 0.65,
      tipAngle: -45,
    });
    // Resetting feel never resets the artist's currently selected drawing color.
    expect(restored.color).toBe("#884422");
  });

  it("carries a complete before state for one-step undo", () => {
    const current = snapshot({
      brushId: "gpen",
      strokeWidth: 33,
      brushOpacity: 0.4,
      stabilizer: 6,
      stabilizerMode: "precision",
      postCorrection: 4,
      preserveCorners: false,
      pressureCurve: 1.8,
      pressureMinSize: 0.45,
      useVelocityPressure: true,
      velocitySensitivity: 0.95,
      tiltEnabled: false,
      tipAngle: 90,
      tipRoundness: 0.8,
      stampTuning: { flow: 0.2, hardness: 0.3, minSize: 0.4 },
    });
    const profile = resolveStudioCoreBrushDefaultRestoreProfile("gpen")!;
    const transaction = planStudioBrushDefaultRestore(current, profile);
    const restored = studioBrushSnapshotForDefaultRestore(current, transaction, "redo");
    const undone = studioBrushSnapshotForDefaultRestore(restored, transaction, "undo");

    expect(undone).toMatchObject({
      strokeWidth: 33,
      brushOpacity: 0.4,
      stabilizer: 6,
      stabilizerMode: "precision",
      postCorrection: 4,
      preserveCorners: false,
      pressureCurve: 1.8,
      pressureMinSize: 0.45,
      useVelocityPressure: true,
      velocitySensitivity: 0.95,
      tiltEnabled: false,
      tipAngle: 90,
      tipRoundness: 0.8,
      stampTuning: { flow: 0.2, hardness: 0.3, minSize: 0.4 },
    });
    expect(studioBrushDynamicsSettingsEqual(
      undone.brushDynamics,
      current.brushDynamics,
    )).toBe(true);
  });

  it("reports a stable no-op when the full profile already matches", () => {
    const profile = resolveStudioCoreBrushDefaultRestoreProfile("pen")!;
    const current = snapshot({
      brushId: "pen",
      ...profile.values,
    });
    const transaction = planStudioBrushDefaultRestore(current, profile);

    expect(transaction.changes).toEqual([]);
    expect(transaction.summary).toBe("이미 이 브러시의 기본값입니다.");
    expect(studioBrushDefaultRestoreValuesEqual(
      transaction.before,
      transaction.after,
    )).toBe(true);
  });

  it("restores stamp flow, hardness and minimum size with the core stamp renderer", () => {
    const profile = resolveStudioCoreBrushDefaultRestoreProfile("ink-brush");
    expect(profile?.values.stampTuning).not.toBeNull();

    const current = snapshot({
      brushId: "ink-brush",
      stampTuning: { flow: 0, hardness: 0, minSize: 0 },
    });
    const transaction = planStudioBrushDefaultRestore(current, profile!);

    expect(transaction.changes).toContainEqual({
      field: "stampTuning",
      label: "스탬프 도포",
    });
    expect(transaction.after.stampTuning).toEqual(profile!.values.stampTuning);
  });
});
