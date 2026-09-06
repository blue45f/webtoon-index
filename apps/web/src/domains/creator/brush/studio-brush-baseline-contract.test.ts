import { describe, expect, it } from "vitest";


import { BRUSH_PRESETS } from "../studio-brush";

import {
  createStudioCatalogBrushBaseline,
  createStudioSavedBrushBaseline,
  inspectStudioBrushBaseline,
  STUDIO_BRUSH_BASELINE_EXCLUDED_FIELDS,
  STUDIO_BRUSH_BASELINE_FIELD_CONTRACT_COMPLETE,
  studioBrushBaselineAccountedFields,
  transitionStudioBrushBaseline,
} from "./studio-brush-baseline-contract";
import { STUDIO_BRUSH_DEFAULT_RESTORE_FIELDS } from "./studio-brush-default-restore";
import { studioBrushDynamicsPresetSettings } from "./studio-brush-dynamics";
import { studioBrushEngineProgramSetFromOil } from "./studio-brush-engine-program-set";
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
    ...overrides,
  };
}

function savedBrush(
  overrides: Partial<StudioSavedBrush> = {},
): StudioSavedBrush {
  return {
    ...snapshot({
      brushId: "dry-media",
      sourcePresetId: "essentials:rough-pencil",
      sourcePresetName: "거친 연필",
      strokeWidth: 4,
      brushOpacity: 0.84,
      brushDynamics: studioBrushDynamicsPresetSettings("dry-media"),
    }),
    id: "saved-rough-pencil",
    name: "내 거친 연필",
    createdAt: 10,
    updatedAt: 20,
    pinned: false,
    lastUsedAt: null,
    ...overrides,
  };
}

describe("studio brush applied baseline contract", () => {
  it("accounts for every snapshot field exactly once as restorable or explicitly excluded", () => {
    expect(STUDIO_BRUSH_BASELINE_FIELD_CONTRACT_COMPLETE).toBe(true);
    expect(new Set(studioBrushBaselineAccountedFields())).toEqual(new Set([
      ...Object.keys(DEFAULT_STUDIO_BRUSH_SNAPSHOT),
      "sourcePresetId",
      "sourcePresetName",
    ]));
    expect(STUDIO_BRUSH_BASELINE_EXCLUDED_FIELDS).toEqual([
      "brushId",
      "sourcePresetId",
      "sourcePresetName",
      "color",
    ]);
    expect(STUDIO_BRUSH_DEFAULT_RESTORE_FIELDS).not.toContain("color");
    expect(STUDIO_BRUSH_DEFAULT_RESTORE_FIELDS).not.toContain("brushId");
  });

  it("reports all brush-feel fields, counts, and canonical Korean labels from one restore plan", () => {
    const preset = BRUSH_PRESETS.find(({ id }) => id === "pen")!;
    const baseline = createStudioCatalogBrushBaseline(
      studioCoreBrushCatalogSelection(preset),
    );
    const current = snapshot({
      brushId: "pen",
      strokeWidth: 72,
      brushOpacity: 0.23,
      color: "#123456",
      stabilizer: 6,
      stabilizerMode: "precision",
      postCorrection: 5,
      preserveCorners: false,
      pressureCurve: 2.2,
      pressureMinSize: 0.54,
      // Differs from the default, which is now true — this snapshot's job is to make EVERY
      // brush-feel field dirty at once, so it has to be the opposite of whatever ships.
      useVelocityPressure: false,
      velocitySensitivity: 0.91,
      tiltEnabled: false,
      tipAngle: 88,
      tipRoundness: 0.82,
      brushDynamics: studioBrushDynamicsPresetSettings("ink-particle"),
      stampTuning: { flow: 0.2, hardness: 0.3, minSize: 0.4 },
      // pen 의 베이스라인 조합은 null(브러시 id 의 기본 조합)이므로, 세트를 실으면 dirty 다.
      enginePrograms: studioBrushEngineProgramSetFromOil({
        bristlePhysics: true,
        bristleLoadDynamics: false,
        impastoRelief: true,
      }),
    });

    const inspected = inspectStudioBrushBaseline(baseline, current);

    expect(inspected.status).toBe("modified");
    expect(inspected.dirtyFields).toEqual(STUDIO_BRUSH_DEFAULT_RESTORE_FIELDS);
    expect(inspected.dirtyCount).toBe(STUDIO_BRUSH_DEFAULT_RESTORE_FIELDS.length);
    expect(inspected.dirtyLabels).toEqual([
      "굵기",
      "불투명도",
      "브러시 반응·질감",
      "스탬프 도포",
      "엔진 조합",
      "손떨림 보정",
      "보정 방식",
      "후보정",
      "각점 보존",
      "필압 곡선",
      "최소 굵기",
      "속도 압력",
      "속도 민감도",
      "기울기",
      "촉 각도",
      "촉 원형도",
    ]);
    expect(inspected.transaction?.changes.map(({ field }) => field)).toEqual(
      inspected.dirtyFields,
    );
  });

  it("keeps color and display identity outside dirty state while guarding renderer identity", () => {
    const preset = BRUSH_PRESETS.find(({ id }) => id === "pen")!;
    const selection = studioCoreBrushCatalogSelection(preset);
    const baseline = createStudioCatalogBrushBaseline(selection);
    const sameBrush = snapshot({
      brushId: "pen",
      color: "#abcdef",
      sourcePresetName: "표시 이름만 바뀜",
      ...baseline.profile.values,
    });

    expect(inspectStudioBrushBaseline(baseline, sameBrush)).toMatchObject({
      status: "clean",
      dirtyCount: 0,
      dirtyFields: [],
    });
    expect(inspectStudioBrushBaseline(
      baseline,
      { ...sameBrush, brushId: "pencil" },
    )).toMatchObject({
      status: "invalid",
      reason: "selection-changed",
      transaction: null,
      dirtyCount: 0,
    });
  });

  it("keeps locked size and opacity out of both the modified count and restore payload", () => {
    const preset = BRUSH_PRESETS.find(({ id }) => id === "marker")!;
    const baseline = createStudioCatalogBrushBaseline(
      studioCoreBrushCatalogSelection(preset),
    );
    const current = snapshot({
      brushId: "marker",
      ...baseline.profile.values,
      strokeWidth: 37,
      brushOpacity: 0.21,
      stabilizer: baseline.profile.values.stabilizer + 1,
    });

    const inspected = inspectStudioBrushBaseline(baseline, current, {
      preserveStrokeWidth: true,
      preserveBrushOpacity: true,
    });

    expect(inspected).toMatchObject({
      status: "modified",
      dirtyFields: ["stabilizer"],
      dirtyLabels: ["손떨림 보정"],
      dirtyCount: 1,
    });
    expect(inspected.transaction?.after.strokeWidth).toBe(37);
    expect(inspected.transaction?.after.brushOpacity).toBe(0.21);
    expect(inspected.transaction?.changes.map(({ field }) => field)).not.toContain(
      "strokeWidth",
    );
    expect(inspected.transaction?.changes.map(({ field }) => field)).not.toContain(
      "brushOpacity",
    );
  });

  it("preserves an extended catalogue baseline through edits and invalidates another preset", () => {
    const selection = {
      catalogId: "essentials:rough-pencil",
      catalogName: "거친 연필",
      runtimeBrushId: "dry-media",
      operation: "paint" as const,
      defaultWidth: 4,
      defaultOpacity: 0.84,
      brushDynamics: studioBrushDynamicsPresetSettings("dry-media"),
    };
    const baseline = createStudioCatalogBrushBaseline(selection);
    const edited = snapshot({
      brushId: "dry-media",
      sourcePresetId: selection.catalogId,
      sourcePresetName: selection.catalogName,
      strokeWidth: 18,
      brushOpacity: 0.42,
    });

    expect(baseline.identity).toEqual({
      key: "catalog:essentials:rough-pencil",
      kind: "extended",
      runtimeBrushId: "dry-media",
      sourcePresetId: "essentials:rough-pencil",
      savedBrushId: null,
    });
    expect(inspectStudioBrushBaseline(baseline, edited)).toMatchObject({
      status: "modified",
      dirtyFields: ["strokeWidth", "brushOpacity", "brushDynamics"],
      dirtyCount: 3,
    });
    expect(inspectStudioBrushBaseline(
      baseline,
      { ...edited, sourcePresetId: "essentials:soft-pencil" },
    ).status).toBe("invalid");
  });

  it("keeps an applied saved identity after settings edits instead of deriving it from equality", () => {
    const saved = savedBrush();
    const baseline = transitionStudioBrushBaseline(null, {
      type: "brush-selected",
      selection: { kind: "saved", brush: saved },
    });
    const edited = snapshot({
      ...saved,
      strokeWidth: 31,
      brushOpacity: 0.37,
      color: "#eecc88",
    });

    expect(baseline?.identity).toMatchObject({
      key: "saved:saved-rough-pencil",
      kind: "saved",
      savedBrushId: "saved-rough-pencil",
    });
    expect(inspectStudioBrushBaseline(baseline!, edited)).toMatchObject({
      status: "modified",
      dirtyFields: ["strokeWidth", "brushOpacity"],
      dirtyCount: 2,
    });

    // Property edits dispatch no selection action, so the applied baseline remains exact.
    expect(baseline).toBe(baseline);
  });

  it("detaches saved baseline values from later mutations of the library record", () => {
    const saved = savedBrush({
      stampTuning: { flow: 0.7, hardness: 0.4, minSize: 0.2 },
    });
    const baseline = createStudioSavedBrushBaseline(saved);
    const capturedDynamicsBase = baseline.profile.values.brushDynamics.width.base;

    saved.strokeWidth = 77;
    saved.brushDynamics.width.base = 0.01;
    saved.stampTuning!.flow = 0.01;

    expect(baseline.profile.values.strokeWidth).toBe(4);
    expect(baseline.profile.values.brushDynamics.width.base).toBe(capturedDynamicsBase);
    expect(baseline.profile.values.stampTuning?.flow).toBe(0.7);
  });

  it("reconciles harmless saved metadata but fails closed for deletion or changed feel", () => {
    const saved = savedBrush();
    const baseline = createStudioSavedBrushBaseline(saved);
    const metadataOnly = {
      ...saved,
      name: "이름만 변경",
      color: "#ffffff",
      pinned: true,
      lastUsedAt: 99,
      updatedAt: 100,
    };
    const refreshed = transitionStudioBrushBaseline(baseline, {
      type: "saved-library-reconciled",
      brushes: [metadataOnly],
    });

    expect(refreshed).not.toBeNull();
    expect(refreshed).not.toBe(baseline);
    expect(refreshed?.profile.sourceName).toBe("이름만 변경");
    expect(refreshed?.profile.values).toEqual(baseline.profile.values);
    expect(transitionStudioBrushBaseline(baseline, {
      type: "saved-library-reconciled",
      brushes: [{ ...saved, pinned: true, lastUsedAt: 99 }],
    })).toBe(baseline);
    expect(transitionStudioBrushBaseline(baseline, {
      type: "saved-library-reconciled",
      brushes: [],
    })).toBeNull();
    expect(transitionStudioBrushBaseline(baseline, {
      type: "saved-library-reconciled",
      brushes: [{ ...saved, strokeWidth: 33, updatedAt: 101 }],
    })).toBeNull();
    expect(transitionStudioBrushBaseline(baseline, {
      type: "saved-library-reconciled",
      brushes: [{
        ...saved,
        brushId: "pencil",
        sourcePresetId: undefined,
        updatedAt: 102,
      }],
    })).toBeNull();
  });

  it("replaces identical-renderer saved selections by explicit id and clears unknown selections", () => {
    const first = savedBrush({ id: "saved-a", name: "A" });
    const second = savedBrush({ id: "saved-b", name: "B" });
    const firstBaseline = createStudioSavedBrushBaseline(first);
    const secondBaseline = transitionStudioBrushBaseline(firstBaseline, {
      type: "brush-selected",
      selection: { kind: "saved", brush: second },
    });

    expect(secondBaseline?.identity.key).toBe("saved:saved-b");
    expect(secondBaseline?.profile.sourceName).toBe("B");
    expect(transitionStudioBrushBaseline(secondBaseline, {
      type: "selection-invalidated",
    })).toBeNull();
  });
});
