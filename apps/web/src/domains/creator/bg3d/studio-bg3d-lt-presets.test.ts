import { describe, expect, it } from "vitest";

import {
  STUDIO_BG3D_LT_BUILT_IN_PRESETS,
  STUDIO_BG3D_LT_PRESET_MAX_BYTES,
  STUDIO_BG3D_LT_PRESET_MAX_COUNT,
  STUDIO_BG3D_LT_PRESET_MAX_DESCRIPTION_LENGTH,
  STUDIO_BG3D_LT_PRESET_MAX_NAME_LENGTH,
  STUDIO_BG3D_LT_PRESET_PAYLOAD_KIND,
  STUDIO_BG3D_LT_PRESET_PAYLOAD_VERSION,
  applyStudioBg3dLtPreset,
  getStudioBg3dLtPreset,
  parseStudioBg3dLtPresetPayload,
  serializeStudioBg3dLtPresetPayload,
  type StudioBg3dLtPreset,
  type StudioBg3dLtPresetPayload,
} from "./studio-bg3d-lt-presets";
import {
  DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
  normalizeStudioBg3dSceneDocument,
  serializeStudioBg3dSceneDocument,
  type StudioBg3dSceneDocument,
} from "./studio-bg3d-scene-document";

function userPreset(id = "user.architecture", name = "내 건축 선화"): StudioBg3dLtPreset {
  const source = STUDIO_BG3D_LT_BUILT_IN_PRESETS[1];
  return {
    id,
    version: 1,
    name,
    description: "작업실에서 조정한 개인용 선화 설정입니다.",
    line: { ...source.line },
    tone: { ...source.tone },
  };
}

function payload(...presets: StudioBg3dLtPreset[]): StudioBg3dLtPresetPayload {
  return {
    kind: STUDIO_BG3D_LT_PRESET_PAYLOAD_KIND,
    version: STUDIO_BG3D_LT_PRESET_PAYLOAD_VERSION,
    presets,
  };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("Studio BG3D LT built-in presets", () => {
  it("provides five commercial workflow presets with immutable canonical settings", () => {
    expect(STUDIO_BG3D_LT_BUILT_IN_PRESETS.map((preset) => preset.name)).toEqual([
      "배경 콘티",
      "깔끔한 건축 선화",
      "흑백 만화",
      "거친 펜",
      "컬러 웹툰 배경",
    ]);
    expect(Object.isFrozen(STUDIO_BG3D_LT_BUILT_IN_PRESETS)).toBe(true);
    for (const preset of STUDIO_BG3D_LT_BUILT_IN_PRESETS) {
      expect(Object.isFrozen(preset)).toBe(true);
      expect(Object.isFrozen(preset.line)).toBe(true);
      expect(Object.isFrozen(preset.tone)).toBe(true);
      // The current LT exporter produces editable, separated raster PNG layers. Keep built-ins
      // truthful until a real vector-path exporter is connected end to end.
      expect(preset.line.layerType).toBe("raster");
      const applied = applyStudioBg3dLtPreset(
        DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
        preset.id
      );
      expect(applied?.output.line).toEqual(preset.line);
      expect(applied?.output.tone).toEqual(preset.tone);
    }
    expect(STUDIO_BG3D_LT_BUILT_IN_PRESETS.at(-1)?.tone).toMatchObject({
      mode: "flat",
      type: "color",
    });
  });

  it("returns stable built-in identities and never allows a user payload to shadow them", () => {
    const builtIn = STUDIO_BG3D_LT_BUILT_IN_PRESETS[0];
    expect(getStudioBg3dLtPreset(builtIn.id)).toBe(builtIn);
    expect(
      serializeStudioBg3dLtPresetPayload(
        payload({ ...userPreset(), id: builtIn.id })
      )
    ).toBeNull();
  });
});

describe("Studio BG3D LT user preset persistence", () => {
  it("serializes deterministically, sorts ids, and round-trips a deeply frozen payload", () => {
    const alpha = userPreset("user.alpha", "알파");
    const zulu = userPreset("user.zulu", "줄루");
    const first = serializeStudioBg3dLtPresetPayload(payload(zulu, alpha));
    const second = serializeStudioBg3dLtPresetPayload(payload(alpha, zulu));

    expect(first).not.toBeNull();
    expect(first).toBe(second);
    const parsed = parseStudioBg3dLtPresetPayload(first!);
    expect(parsed?.presets.map((preset) => preset.id)).toEqual(["user.alpha", "user.zulu"]);
    expect(serializeStudioBg3dLtPresetPayload(parsed)).toBe(first);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed?.presets)).toBe(true);
    expect(Object.isFrozen(parsed?.presets[0]?.line)).toBe(true);
  });

  it("accepts only the canonical sorted wire order produced by the serializer", () => {
    const unsorted = JSON.stringify(payload(userPreset("user.z"), userPreset("user.a")));
    expect(parseStudioBg3dLtPresetPayload(unsorted)).toBeNull();
    const canonical = serializeStudioBg3dLtPresetPayload(JSON.parse(unsorted) as unknown);
    expect(canonical).not.toBeNull();
    expect(parseStudioBg3dLtPresetPayload(canonical!)).not.toBeNull();
  });

  it("rejects unknown keys, missing keys, and unknown root or preset versions", () => {
    const valid = payload(userPreset());
    expect(serializeStudioBg3dLtPresetPayload({ ...valid, secret: "must-not-survive" })).toBeNull();
    expect(
      serializeStudioBg3dLtPresetPayload({ ...valid, version: 2 })
    ).toBeNull();
    expect(
      serializeStudioBg3dLtPresetPayload({ ...valid, kind: "future-kind" })
    ).toBeNull();
    expect(
      serializeStudioBg3dLtPresetPayload(
        payload({ ...userPreset(), version: 2 as 1 })
      )
    ).toBeNull();

    const missingDescription = cloneJson(userPreset()) as unknown as Record<string, unknown>;
    delete missingDescription.description;
    expect(
      serializeStudioBg3dLtPresetPayload({ ...valid, presets: [missingDescription] })
    ).toBeNull();

    expect(
      serializeStudioBg3dLtPresetPayload(
        payload({ ...userPreset(), debug: true } as StudioBg3dLtPreset)
      )
    ).toBeNull();
  });

  it("rejects duplicate ids, reserved ids, and payloads above the preset-count limit", () => {
    const duplicate = userPreset("user.duplicate");
    expect(
      serializeStudioBg3dLtPresetPayload(payload(duplicate, cloneJson(duplicate)))
    ).toBeNull();
    expect(
      serializeStudioBg3dLtPresetPayload(payload(userPreset("constructor")))
    ).toBeNull();
    const tooMany = Array.from({ length: STUDIO_BG3D_LT_PRESET_MAX_COUNT + 1 }, (_, index) =>
      userPreset(`user.${String(index).padStart(2, "0")}`)
    );
    expect(serializeStudioBg3dLtPresetPayload(payload(...tooMany))).toBeNull();
  });

  it("enforces canonical bounded names and descriptions", () => {
    expect(
      serializeStudioBg3dLtPresetPayload(
        payload(userPreset("user.long-name", "가".repeat(STUDIO_BG3D_LT_PRESET_MAX_NAME_LENGTH + 1)))
      )
    ).toBeNull();
    expect(
      serializeStudioBg3dLtPresetPayload(
        payload({
          ...userPreset("user.long-description"),
          description: "가".repeat(STUDIO_BG3D_LT_PRESET_MAX_DESCRIPTION_LENGTH + 1),
        })
      )
    ).toBeNull();
    expect(
      serializeStudioBg3dLtPresetPayload(payload(userPreset("user.whitespace", " 앞뒤 공백 ")))
    ).toBeNull();
    expect(
      serializeStudioBg3dLtPresetPayload(
        payload({ ...userPreset("user.bidi"), description: "안전하지 않은\u202e표시" })
      )
    ).toBeNull();
  });

  it("delegates finite-number, range, integer, enum, color, and exact-field checks to the scene contract", () => {
    const nonFinite = {
      ...userPreset("user.non-finite"),
      line: { ...userPreset().line, widthPx: Number.NaN },
    };
    expect(serializeStudioBg3dLtPresetPayload(payload(nonFinite))).toBeNull();
    expect(
      serializeStudioBg3dLtPresetPayload(
        payload({
          ...nonFinite,
          line: { ...nonFinite.line, widthPx: Number.POSITIVE_INFINITY },
        })
      )
    ).toBeNull();

    const outOfRange = {
      ...userPreset("user.range"),
      line: { ...userPreset().line, widthPx: 8.01 },
    };
    expect(serializeStudioBg3dLtPresetPayload(payload(outOfRange))).toBeNull();

    const fractionalLevels = {
      ...userPreset("user.levels"),
      tone: { ...userPreset().tone, levels: 3.5 },
    };
    expect(serializeStudioBg3dLtPresetPayload(payload(fractionalLevels))).toBeNull();

    const nonCanonicalColor = {
      ...userPreset("user.color"),
      line: { ...userPreset().line, color: "#ABCDEF" },
    };
    expect(serializeStudioBg3dLtPresetPayload(payload(nonCanonicalColor))).toBeNull();

    const unknownLineKey = cloneJson(userPreset("user.line-key"));
    (unknownLineKey.line as unknown as Record<string, unknown>).apiKey = "secret";
    expect(serializeStudioBg3dLtPresetPayload(payload(unknownLineKey))).toBeNull();

    const missingToneKey = cloneJson(userPreset("user.tone-key"));
    delete (missingToneKey.tone as unknown as Record<string, unknown>).frequency;
    expect(serializeStudioBg3dLtPresetPayload(payload(missingToneKey))).toBeNull();
  });

  it("rejects prototype-pollution keys, hostile prototypes, accessors, and oversized JSON", () => {
    const serialized = serializeStudioBg3dLtPresetPayload(payload(userPreset()));
    expect(serialized).not.toBeNull();
    const pollutedRoot = serialized!.replace(
      "{",
      '{"__proto__":{"polluted":true},'
    );
    expect(parseStudioBg3dLtPresetPayload(pollutedRoot)).toBeNull();
    const pollutedLine = serialized!.replace(
      '"line":{',
      '"line":{"constructor":{"prototype":{"polluted":true}},'
    );
    expect(parseStudioBg3dLtPresetPayload(pollutedLine)).toBeNull();
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();

    const inherited = Object.create({ polluted: true }) as Record<string, unknown>;
    Object.assign(inherited, payload(userPreset("user.inherited")));
    expect(serializeStudioBg3dLtPresetPayload(inherited)).toBeNull();

    let getterInvoked = false;
    const accessorPayload = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(accessorPayload, "presets", {
      enumerable: true,
      get() {
        getterInvoked = true;
        return [];
      },
    });
    accessorPayload.kind = STUDIO_BG3D_LT_PRESET_PAYLOAD_KIND;
    accessorPayload.version = 1;
    expect(serializeStudioBg3dLtPresetPayload(accessorPayload)).toBeNull();
    expect(getterInvoked).toBe(false);

    expect(
      parseStudioBg3dLtPresetPayload(" ".repeat(STUDIO_BG3D_LT_PRESET_MAX_BYTES + 1))
    ).toBeNull();
  });
});

describe("Studio BG3D LT lookup and application", () => {
  it("looks up a parsed custom preset and rejects forged payload objects", () => {
    const serialized = serializeStudioBg3dLtPresetPayload(
      payload(userPreset("user.lookup", "조회 프리셋"))
    );
    const parsed = parseStudioBg3dLtPresetPayload(serialized!);
    expect(getStudioBg3dLtPreset("user.lookup", parsed)?.name).toBe("조회 프리셋");
    expect(getStudioBg3dLtPreset("missing", parsed)).toBeNull();

    const forged = {
      ...parsed,
      presets: [{ ...parsed!.presets[0], extra: "secret" }],
    } as unknown as StudioBg3dLtPresetPayload;
    expect(getStudioBg3dLtPreset("user.lookup", forged)).toBeNull();
  });

  it("updates only line/tone and preserves all other canonical scene data without loss", () => {
    const scene = normalizeStudioBg3dSceneDocument({
      ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
      camera: {
        position: [9, 8, 7],
        target: [1, 2, 3],
        fovDegrees: 42,
      },
      output: {
        ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.output,
        transparentBackground: true,
        exportHeight: 2_048,
      },
      nodes: [
        {
          id: "building-1",
          name: "건물",
          kind: "primitive",
          primitiveKind: "box",
          color: "#8899aa",
          transform: {
            position: [4, 5, 6],
            rotation: [0.1, 0.2, 0.3],
            scale: [2, 3, 4],
          },
          visible: true,
          locked: false,
          castsShadow: false,
          receivesShadow: true,
        },
      ],
    });
    const originalWire = serializeStudioBg3dSceneDocument(scene);
    const applied = applyStudioBg3dLtPreset(scene, "monochrome-manga");

    expect(originalWire).not.toBeNull();
    expect(applied).not.toBeNull();
    expect(Object.isFrozen(applied)).toBe(true);
    for (const key of [
      "kind",
      "version",
      "camera",
      "render",
      "background",
      "lighting",
      "quality",
      "budgets",
      "attachments",
      "nodes",
    ] as const) {
      expect(applied?.[key]).toEqual(scene[key]);
    }
    expect(applied?.output.transparentBackground).toBe(scene.output.transparentBackground);
    expect(applied?.output.exportHeight).toBe(scene.output.exportHeight);
    expect(applied?.output.line).toEqual(getStudioBg3dLtPreset("monochrome-manga")?.line);
    expect(applied?.output.tone).toEqual(getStudioBg3dLtPreset("monochrome-manga")?.tone);
  });

  it("applies validated custom presets and fails closed for non-canonical scenes or presets", () => {
    const serialized = serializeStudioBg3dLtPresetPayload(
      payload(userPreset("user.apply", "적용 프리셋"))
    );
    const parsed = parseStudioBg3dLtPresetPayload(serialized!);
    const applied = applyStudioBg3dLtPreset(
      DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
      "user.apply",
      parsed
    );
    expect(applied?.output.line).toEqual(parsed?.presets[0]?.line);

    const invalidScene = {
      ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
      camera: { ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.camera, fovDegrees: 999 },
    } as StudioBg3dSceneDocument;
    expect(applyStudioBg3dLtPreset(invalidScene, "monochrome-manga")).toBeNull();

    const invalidPreset = {
      ...userPreset("user.invalid"),
      line: { ...userPreset().line, widthPx: 999 },
    } as StudioBg3dLtPreset;
    expect(
      applyStudioBg3dLtPreset(DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT, invalidPreset)
    ).toBeNull();
  });
});
