import { afterEach, describe, expect, it, vi } from "vitest";

import {
  STUDIO_BG3D_CAPTURE_PROFILE_RGBA8_DEPTH_V1,
  STUDIO_BG3D_THREE_WEBGL_CAPTURE_IMPLEMENTATION_V1,
} from "./studio-bg3d-capture-adapter";
import {
  createStudioBg3dCaptureBackgroundSnapshot,
  studioBg3dCaptureBackgroundRequestFromSnapshot,
} from "./studio-bg3d-capture-background";
import {
  DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
  applyStudioBg3dShot,
  parseStudioBg3dSceneDocument,
  serializeStudioBg3dSceneDocument,
} from "./studio-bg3d-scene-document";
import {
  STUDIO_BG3D_SHOT_BATCH_MAX_FILES,
  STUDIO_BG3D_SHOT_BATCH_LT_PIPELINE_V1,
  STUDIO_BG3D_SHOT_BATCH_PNG_ENCODING_V1,
  STUDIO_BG3D_SHOT_BATCH_PSD_ENCODING_V1,
  STUDIO_BG3D_SHOT_BATCH_PASSES,
  createStudioBg3dShotBatchPlan,
  resolveStudioBg3dShotBatchCaptureSize,
  hydrateStudioBg3dShotBatchPlan,
  isStudioBg3dShotBatchPlan,
  pendingStudioBg3dShotBatchFiles,
  type CreateStudioBg3dShotBatchPlanOptions,
  type StudioBg3dShotBatchCaptureOwner,
  type StudioBg3dShotBatchSourceShot,
} from "./studio-bg3d-shot-batch-plan";

const SHOTS = [
  { id: "shot-a", name: "첫 컷" },
  { id: "shot-b", name: "둘째 컷" },
  { id: "shot-c", name: "셋째 컷" },
] as const;

const SCOPE = {
  durability: "durable",
  authUserId: "user-a",
  workId: "work-a",
  pageId: "page-a",
  elementId: "element-a",
} as const;

const SHOT_EXPORT_HEIGHTS = [720, 630, 540] as const;

function sourceRevisionForShots(
  shots: readonly StudioBg3dShotBatchSourceShot[] = SHOTS,
  exportHeight = DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.output.exportHeight,
): string {
  const serialized = serializeStudioBg3dSceneDocument({
    ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
    background: {
      ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.background,
      skyPresetId: "clear_day",
    },
    shots: shots.map((shot, index) => ({
      id: shot.id,
      name: shot.name,
      output: {
        exportHeight: SHOT_EXPORT_HEIGHTS[index % SHOT_EXPORT_HEIGHTS.length],
        transparentBackground: index % SHOT_EXPORT_HEIGHTS.length === 1,
        line: { depthEnabled: index % SHOT_EXPORT_HEIGHTS.length === 0 },
      },
    })),
    output: { ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.output, exportHeight },
  });
  if (!serialized) throw new Error("canonical test scene unavailable");
  return serialized;
}

const CAPTURE_OWNER: StudioBg3dShotBatchCaptureOwner = {
  backend: "three-webgl",
  engineId: "three",
  engineRevision: "184",
  implementationRevision: STUDIO_BG3D_THREE_WEBGL_CAPTURE_IMPLEMENTATION_V1,
  graphicsApi: "webgl2",
  profileId: STUDIO_BG3D_CAPTURE_PROFILE_RGBA8_DEPTH_V1,
  sourceWidth: 1_920,
  sourceHeight: 1_080,
  maxPixels: 8_388_608,
  maxEdge: 4_096,
  deviceProfile: "desktop",
  textureScale: 1,
  lodBias: 0,
  ltPipelineId: STUDIO_BG3D_SHOT_BATCH_LT_PIPELINE_V1,
  pngEncodingId: STUDIO_BG3D_SHOT_BATCH_PNG_ENCODING_V1,
  psdEncodingId: STUDIO_BG3D_SHOT_BATCH_PSD_ENCODING_V1,
};

function canonicalCapture(
  shots: readonly StudioBg3dShotBatchSourceShot[],
  sourceRevision: string,
  owner: StudioBg3dShotBatchCaptureOwner,
  exportHeight: "per-shot" | number,
  passes: readonly string[],
): CreateStudioBg3dShotBatchPlanOptions["capture"] {
  const document = parseStudioBg3dSceneDocument(sourceRevision);
  if (!document) throw new Error("canonical test scene could not be parsed");
  return {
    owner,
    shots: shots.map((shot) => {
      const applied = applyStudioBg3dShot(document, shot.id);
      if (!applied) throw new Error("canonical test shot could not be applied");
      const requestedHeight = exportHeight === "per-shot"
        ? applied.output.exportHeight
        : exportHeight;
      const size = resolveStudioBg3dShotBatchCaptureSize({
        sourceWidth: owner.sourceWidth,
        sourceHeight: owner.sourceHeight,
        requestedHeight,
        maxPixels: owner.maxPixels,
        maxEdge: owner.maxEdge,
        exportAspectRatio: owner.exportAspectRatio ?? applied.output.exportAspectRatio,
      });
      if (!size) throw new Error("canonical test capture size unavailable");
      const background = createStudioBg3dCaptureBackgroundSnapshot({
        background: applied.background,
        transparent: applied.output.transparentBackground,
      });
      return {
        shotId: shot.id,
        width: size.width,
        height: size.height,
        requestedHeight,
        wasReduced: size.wasReduced,
        includeDepth: applied.output.line.depthEnabled || passes.includes("depth"),
        shadows: true,
        shadowMapSize: 2_048,
        background: studioBg3dCaptureBackgroundRequestFromSnapshot(background),
      };
    }),
  };
}

function options(
  shots: readonly StudioBg3dShotBatchSourceShot[] = SHOTS,
  overrides: Partial<CreateStudioBg3dShotBatchPlanOptions> = {},
): CreateStudioBg3dShotBatchPlanOptions {
  const revision = overrides.sourceRevision ?? sourceRevisionForShots(shots);
  const exportHeight = overrides.exportHeight ?? "per-shot";
  const passes = overrides.passes ?? ["lt-composite"];
  return {
    sourceRevision: revision,
    scope: SCOPE,
    capture: canonicalCapture(shots, revision, CAPTURE_OWNER, exportHeight, passes),
    ...overrides,
  };
}

function reverseObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).reverse().map(([key, nested]) => [key, reverseObjectKeys(nested)]),
  );
}

function patchCaptureShot(
  base: CreateStudioBg3dShotBatchPlanOptions,
  index: number,
  patch: Partial<CreateStudioBg3dShotBatchPlanOptions["capture"]["shots"][number]>,
): CreateStudioBg3dShotBatchPlanOptions {
  return {
    ...base,
    capture: {
      ...base.capture,
      shots: base.capture.shots.map((shot, shotIndex) =>
        shotIndex === index ? { ...shot, ...patch } : shot
      ),
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Studio BG3D shot batch plan v2", () => {
  it("runtime-freezes the canonical pass ordering used by every digest", () => {
    expect(Object.isFrozen(STUDIO_BG3D_SHOT_BATCH_PASSES)).toBe(true);
    expect(Reflect.set(STUDIO_BG3D_SHOT_BATCH_PASSES, 0, "depth")).toBe(false);
    expect(STUDIO_BG3D_SHOT_BATCH_PASSES[0]).toBe("beauty");
  });

  it("preserves storyboard order and freezes canonical pass/capture requests", async () => {
    const result = await createStudioBg3dShotBatchPlan(SHOTS, options(SHOTS, {
      selectedShotIds: ["shot-c", "shot-a"],
      passes: ["main-line", "lt-composite", "tone"],
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.version).toBe(2);
    expect(result.plan.passes).toEqual(["lt-composite", "tone", "main-line"]);
    expect(result.plan.shots.map(({ shotId }) => shotId)).toEqual(["shot-a", "shot-c"]);
    expect(result.plan.shots.map(({ capture }) => capture)).toEqual([
      {
        width: 1_280,
        height: 720,
        requestedHeight: 720,
        wasReduced: false,
        includeDepth: true,
        shadows: true,
        shadowMapSize: 2_048,
        background: { color: "#bfe3f5", alpha: 1 },
      },
      {
        width: 960,
        height: 540,
        requestedHeight: 540,
        wasReduced: false,
        includeDepth: false,
        shadows: true,
        shadowMapSize: 2_048,
        background: { color: "#bfe3f5", alpha: 1 },
      },
    ]);
    expect(result.plan.files.map(({ key, path }) => ({ key, path }))).toEqual([
      { key: "shot-a:lt-composite", path: "shots/001/lt-composite.png" },
      { key: "shot-a:tone", path: "shots/001/tone.png" },
      { key: "shot-a:main-line", path: "shots/001/main-line.png" },
      { key: "shot-c:lt-composite", path: "shots/002/lt-composite.png" },
      { key: "shot-c:tone", path: "shots/002/tone.png" },
      { key: "shot-c:main-line", path: "shots/002/main-line.png" },
    ]);
    expect(result.plan.sourceDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.plan.scopeDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.plan.planDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.plan.recoveryDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.plan.resumeKey).toBe(`bg3d-batch-v2-${result.plan.recoveryDigest}`);
    expect(isStudioBg3dShotBatchPlan(result.plan)).toBe(true);
  });

  it("defaults to every shot and the backwards-compatible composite pass", async () => {
    const result = await createStudioBg3dShotBatchPlan(SHOTS, options());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.passes).toEqual(["lt-composite"]);
    expect(result.plan.files).toHaveLength(3);
  });

  it("hydrates a defensive canonical copy and deeply freezes every retained branch", async () => {
    const result = await createStudioBg3dShotBatchPlan(SHOTS, options(SHOTS, {
      passes: ["beauty", "depth"],
      layeredPsd: true,
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const hydrated = await hydrateStudioBg3dShotBatchPlan(result.plan);
    expect(hydrated).toEqual(result.plan);
    expect(hydrated).not.toBe(result.plan);
    expect(hydrated && Object.isFrozen(hydrated)).toBe(true);
    expect(hydrated && Object.isFrozen(hydrated.scope)).toBe(true);
    expect(hydrated && Object.isFrozen(hydrated.captureOwner)).toBe(true);
    expect(hydrated && Object.isFrozen(hydrated.passes)).toBe(true);
    expect(hydrated && Object.isFrozen(hydrated.shots)).toBe(true);
    expect(hydrated && Object.isFrozen(hydrated.shots[0])).toBe(true);
    expect(hydrated && Object.isFrozen(hydrated.shots[0]?.capture)).toBe(true);
    expect(hydrated && Object.isFrozen(hydrated.shots[0]?.capture.background)).toBe(true);
    expect(hydrated && Object.isFrozen(hydrated.shots[0]?.files)).toBe(true);
    expect(hydrated && Object.isFrozen(hydrated.shots[0]?.files[0])).toBe(true);
    expect(hydrated && Object.isFrozen(hydrated.files)).toBe(true);
    expect(hydrated?.files[0]).toBe(hydrated?.shots[0]?.files[0]);
  });

  it("rejects unknown fields and digest forgery at the hydration boundary", async () => {
    const result = await createStudioBg3dShotBatchPlan(SHOTS, options());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    await expect(hydrateStudioBg3dShotBatchPlan({
      ...result.plan,
      scope: { ...result.plan.scope, unexpected: true },
    })).resolves.toBeNull();
    await expect(hydrateStudioBg3dShotBatchPlan({
      ...result.plan,
      planDigest: "0".repeat(64),
    })).resolves.toBeNull();
  });

  it("accepts semantically identical reordered keys and restores canonical field order", async () => {
    const result = await createStudioBg3dShotBatchPlan(SHOTS, options(SHOTS, {
      passes: ["color", "main-line"],
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const reordered = {
      ...(reverseObjectKeys(result.plan) as Record<string, unknown>),
      // Deliberately use a different key order than each mirrored shot.files entry.
      files: result.plan.files.map((file) => ({
        key: file.key,
        shotId: file.shotId,
        shotName: file.shotName,
        shotIndex: file.shotIndex,
        pass: file.pass,
        path: file.path,
      })),
    };

    expect(isStudioBg3dShotBatchPlan(reordered)).toBe(true);
    const hydrated = await hydrateStudioBg3dShotBatchPlan(reordered);
    expect(hydrated).toEqual(result.plan);
    expect(JSON.stringify(hydrated)).toBe(JSON.stringify(result.plan));
  });

  it("keeps render identity stable while changing only the private recovery scope", async () => {
    const first = await createStudioBg3dShotBatchPlan(SHOTS, options());
    const rescoped = await createStudioBg3dShotBatchPlan(SHOTS, options(SHOTS, {
      scope: { ...SCOPE, pageId: "page-b", elementId: "element-b" },
    }));
    expect(first.ok).toBe(true);
    expect(rescoped.ok).toBe(true);
    if (!first.ok || !rescoped.ok) return;

    expect(rescoped.plan.sourceDigest).toBe(first.plan.sourceDigest);
    expect(rescoped.plan.planDigest).toBe(first.plan.planDigest);
    expect(rescoped.plan.scopeDigest).not.toBe(first.plan.scopeDigest);
    expect(rescoped.plan.recoveryDigest).not.toBe(first.plan.recoveryDigest);
    expect(rescoped.plan.resumeKey).not.toBe(first.plan.resumeKey);
  });

  it("uses SHA-256 identity sensitive to source, scope, capture profile, and output options", async () => {
    const first = await createStudioBg3dShotBatchPlan(SHOTS, options(SHOTS, {
      passes: ["color", "main-line"],
    }));
    const second = await createStudioBg3dShotBatchPlan(SHOTS, options(SHOTS, {
      passes: ["main-line", "color"],
    }));
    const revised = await createStudioBg3dShotBatchPlan(SHOTS, options(SHOTS, {
      passes: ["color", "main-line"],
      sourceRevision: sourceRevisionForShots(SHOTS, 1_280),
    }));
    const rescoped = await createStudioBg3dShotBatchPlan(SHOTS, options(SHOTS, {
      passes: ["color", "main-line"],
      scope: { ...SCOPE, pageId: "page-b" },
    }));
    const changedOwnerBase = options(SHOTS, { passes: ["color", "main-line"] });
    const changedOwnerOptions: CreateStudioBg3dShotBatchPlanOptions = {
      ...changedOwnerBase,
      capture: {
        ...changedOwnerBase.capture,
        owner: { ...changedOwnerBase.capture.owner, engineRevision: "185" },
      },
    };
    const changedOwner = await createStudioBg3dShotBatchPlan(SHOTS, changedOwnerOptions);
    const changedImplementation = await createStudioBg3dShotBatchPlan(SHOTS, {
      ...changedOwnerBase,
      capture: {
        ...changedOwnerBase.capture,
        owner: {
          ...changedOwnerBase.capture.owner,
          implementationRevision: "studio-three-webgl-capture-adapter-v2",
        },
      },
    });
    const withPsd = await createStudioBg3dShotBatchPlan(SHOTS, options(SHOTS, {
      passes: ["color", "main-line"],
      layeredPsd: true,
    }));
    const fixedHeight = await createStudioBg3dShotBatchPlan(SHOTS, options(SHOTS, {
      passes: ["color", "main-line"],
      exportHeight: 1_440,
    }));
    const withContactSheet = await createStudioBg3dShotBatchPlan(SHOTS, options(SHOTS, {
      passes: ["color", "main-line"],
      contactSheet: true,
    }));

    expect(first.ok && second.ok && first.plan.resumeKey).toBe(
      second.ok && second.plan.resumeKey,
    );
    for (const changed of [
      revised,
      rescoped,
      changedOwner,
      changedImplementation,
      withPsd,
      fixedHeight,
      withContactSheet,
    ]) {
      expect(first.ok && changed.ok && first.plan.resumeKey).not.toBe(
        changed.ok && changed.plan.resumeKey,
      );
    }
    expect(fixedHeight.ok && fixedHeight.plan.exportHeight).toBe(1_440);
    expect(withContactSheet.ok && withContactSheet.plan.includeContactSheet).toBe(true);
    expect(withPsd.ok && withPsd.plan.includeLayeredPsd).toBe(true);
  });

  it("rejects missing, duplicate, unknown, over-budget, and malformed plan prerequisites", async () => {
    await expect(createStudioBg3dShotBatchPlan(SHOTS, options(SHOTS, {
      selectedShotIds: [],
    }))).resolves.toMatchObject({ ok: false, code: "empty-selection" });
    await expect(createStudioBg3dShotBatchPlan(SHOTS, options(SHOTS, {
      selectedShotIds: ["shot-a", "shot-a"],
    }))).resolves.toMatchObject({ ok: false, code: "duplicate-selection" });
    await expect(createStudioBg3dShotBatchPlan(SHOTS, options(SHOTS, {
      selectedShotIds: ["shot-missing"],
    }))).resolves.toMatchObject({ ok: false, code: "unknown-selection" });
    await expect(createStudioBg3dShotBatchPlan(SHOTS, options(SHOTS, {
      passes: [],
    }))).resolves.toMatchObject({ ok: false, code: "empty-passes" });
    await expect(createStudioBg3dShotBatchPlan(SHOTS, options(SHOTS, {
      passes: ["color", "color"],
    }))).resolves.toMatchObject({ ok: false, code: "duplicate-pass" });

    const missingCaptureBase = options();
    const missingCapture: CreateStudioBg3dShotBatchPlanOptions = {
      ...missingCaptureBase,
      capture: {
        ...missingCaptureBase.capture,
        shots: missingCaptureBase.capture.shots.slice(0, -1),
      },
    };
    await expect(createStudioBg3dShotBatchPlan(SHOTS, missingCapture)).resolves.toMatchObject({
      ok: false,
      code: "invalid-capture",
    });
    const overBudgetBase = options();
    const overBudget: CreateStudioBg3dShotBatchPlanOptions = {
      ...overBudgetBase,
      capture: {
        owner: { ...overBudgetBase.capture.owner, maxPixels: 1_000_000 },
        shots: overBudgetBase.capture.shots.map((shot, index) => index === 0
          ? {
              ...shot,
              width: 4_096,
              height: 2_048,
              requestedHeight: 2_048,
              wasReduced: false,
            }
          : shot),
      },
    };
    await expect(createStudioBg3dShotBatchPlan(SHOTS, overBudget)).resolves.toMatchObject({
      ok: false,
      code: "invalid-capture",
    });
    const mismatchedEngineBase = options();
    await expect(createStudioBg3dShotBatchPlan(SHOTS, {
      ...mismatchedEngineBase,
      capture: {
        ...mismatchedEngineBase.capture,
        owner: { ...mismatchedEngineBase.capture.owner, backend: "babylon-webgl" },
      },
    })).resolves.toMatchObject({ ok: false, code: "invalid-capture" });
    const duplicateShots = [SHOTS[0], { ...SHOTS[1], id: SHOTS[0].id }];
    await expect(createStudioBg3dShotBatchPlan(
      duplicateShots,
      options(SHOTS),
    )).resolves.toMatchObject({ ok: false, code: "duplicate-shot-id" });
  });

  it("normalizes source-equivalent colors and rejects capture facts that disagree with the source", async () => {
    const uppercaseBase = options();
    const uppercase = patchCaptureShot(uppercaseBase, 0, {
      background: {
        ...uppercaseBase.capture.shots[0]!.background,
        color: uppercaseBase.capture.shots[0]!.background.color.toUpperCase(),
      },
    });
    const normalized = await createStudioBg3dShotBatchPlan(SHOTS, uppercase);
    expect(normalized.ok).toBe(true);
    if (normalized.ok) {
      expect(normalized.plan.shots[0]?.capture.background.color).toBe("#bfe3f5");
    }

    const perShotBase = options();
    const fixedBase = options(SHOTS, { exportHeight: 1_440 });
    const depthBase = options(SHOTS, { passes: ["depth"] });
    const invalidPlans = [
      patchCaptureShot(perShotBase, 0, {
        requestedHeight: perShotBase.capture.shots[0]!.requestedHeight + 1,
        wasReduced: true,
      }),
      patchCaptureShot(perShotBase, 0, {
        width: perShotBase.capture.shots[0]!.width - 1,
      }),
      patchCaptureShot(perShotBase, 1, {
        includeDepth: true,
      }),
      patchCaptureShot(depthBase, 1, {
        includeDepth: false,
      }),
      patchCaptureShot(perShotBase, 0, {
        background: { color: "#000000", alpha: 1 },
      }),
      patchCaptureShot(perShotBase, 0, {
        background: { color: "#bfe3f5", alpha: 0 },
      }),
      patchCaptureShot(perShotBase, 0, {
        background: { color: "#bfe3f5", alpha: 0.5 },
      }),
      patchCaptureShot(fixedBase, 0, {
        ...perShotBase.capture.shots[0],
      }),
    ];

    for (const invalid of invalidPlans) {
      await expect(createStudioBg3dShotBatchPlan(SHOTS, invalid)).resolves.toMatchObject({
        ok: false,
        code: "invalid-capture",
      });
    }
  });

  it("fails closed instead of falling back to a collision-prone hash", async () => {
    vi.stubGlobal("crypto", {});
    await expect(createStudioBg3dShotBatchPlan(SHOTS, options())).resolves.toMatchObject({
      ok: false,
      code: "digest-unavailable",
    });
  });

  it("plans the exact global file ceiling and filters completed recovery keys", async () => {
    const shots = Array.from({ length: 64 }, (_, index) => ({
      id: `shot-${index + 1}`,
      name: `컷 ${index + 1}`,
    }));
    const result = await createStudioBg3dShotBatchPlan(shots, options(shots, {
      passes: [
        "beauty",
        "lt-composite",
        "color",
        "tone",
        "texture-line",
        "main-line",
        "depth",
      ],
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.files).toHaveLength(STUDIO_BG3D_SHOT_BATCH_MAX_FILES);
    const completed = new Set([
      result.plan.files[0]!.key,
      result.plan.files[result.plan.files.length - 1]!.key,
      "foreign:color",
    ]);
    const pending = pendingStudioBg3dShotBatchFiles(result.plan, completed);
    expect(pending).toHaveLength(STUDIO_BG3D_SHOT_BATCH_MAX_FILES - 2);
    expect(pending.some(({ key }) => completed.has(key))).toBe(false);
  });
});


describe("resolveStudioBg3dShotBatchCaptureSize aspect parity", () => {
  it("freezes the same raster for different source viewports when exportAspectRatio is set", () => {
    const fixed = {
      requestedHeight: 1024,
      maxPixels: 16_777_216,
      maxEdge: 4_096,
      exportAspectRatio: 0.8, // 4:5 webtoon-ish
    } as const;
    const a = resolveStudioBg3dShotBatchCaptureSize({
      sourceWidth: 800,
      sourceHeight: 600,
      ...fixed,
    });
    const b = resolveStudioBg3dShotBatchCaptureSize({
      sourceWidth: 1920,
      sourceHeight: 1080,
      ...fixed,
    });
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a).toEqual(b);
    expect(a!.width / a!.height).toBeCloseTo(0.8, 2);
  });

  it("falls back to live source aspect when exportAspectRatio is omitted", () => {
    const wide = resolveStudioBg3dShotBatchCaptureSize({
      sourceWidth: 1920,
      sourceHeight: 1080,
      requestedHeight: 1080,
      maxPixels: 16_777_216,
      maxEdge: 4_096,
    });
    const tall = resolveStudioBg3dShotBatchCaptureSize({
      sourceWidth: 800,
      sourceHeight: 1600,
      requestedHeight: 1080,
      maxPixels: 16_777_216,
      maxEdge: 4_096,
    });
    expect(wide).not.toBeNull();
    expect(tall).not.toBeNull();
    expect(wide!.width / wide!.height).toBeCloseTo(1920 / 1080, 2);
    expect(tall!.width / tall!.height).toBeCloseTo(0.5, 2);
  });
});
