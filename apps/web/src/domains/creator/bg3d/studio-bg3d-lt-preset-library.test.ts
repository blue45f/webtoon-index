import { describe, expect, it } from "vitest";

import {
  EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD,
  EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD_JSON,
  createStudioBg3dLtUserPreset,
  deleteStudioBg3dLtUserPreset,
  loadStudioBg3dLtUserPresetLibrary,
  renameStudioBg3dLtUserPreset,
  upsertStudioBg3dLtUserPreset,
  type StudioBg3dLtUserPresetDraft,
  type StudioBg3dLtUserPresetMutationResult,
  type StudioBg3dLtUserPresetMutationSuccess,
} from "./studio-bg3d-lt-preset-library";
import {
  STUDIO_BG3D_LT_BUILT_IN_PRESETS,
  STUDIO_BG3D_LT_PRESET_MAX_BYTES,
  STUDIO_BG3D_LT_PRESET_MAX_COUNT,
  STUDIO_BG3D_LT_PRESET_MAX_NAME_LENGTH,
  STUDIO_BG3D_LT_PRESET_PAYLOAD_KIND,
  STUDIO_BG3D_LT_PRESET_PAYLOAD_VERSION,
  parseStudioBg3dLtPresetPayload,
  serializeStudioBg3dLtPresetPayload,
  type StudioBg3dLtPreset,
  type StudioBg3dLtPresetPayload,
} from "./studio-bg3d-lt-presets";

function draft(
  id = "user.architecture",
  name = "내 건축 선화",
  overrides: Partial<StudioBg3dLtUserPresetDraft> = {}
): StudioBg3dLtUserPresetDraft {
  const source = STUDIO_BG3D_LT_BUILT_IN_PRESETS[1];
  return {
    id,
    name,
    description: "작업실에서 조정한 개인용 LT 설정입니다.",
    line: { ...source.line },
    tone: { ...source.tone },
    ...overrides,
  };
}

function fullPreset(value: StudioBg3dLtUserPresetDraft): StudioBg3dLtPreset {
  return { ...value, version: 1 };
}

function canonicalPayload(...drafts: StudioBg3dLtUserPresetDraft[]): StudioBg3dLtPresetPayload {
  const serialized = serializeStudioBg3dLtPresetPayload({
    kind: STUDIO_BG3D_LT_PRESET_PAYLOAD_KIND,
    version: STUDIO_BG3D_LT_PRESET_PAYLOAD_VERSION,
    presets: drafts.map(fullPreset),
  });
  if (!serialized) throw new Error("Invalid test fixture.");
  const parsed = parseStudioBg3dLtPresetPayload(serialized);
  if (!parsed) throw new Error("Invalid canonical test fixture.");
  return parsed;
}

function success(
  result: StudioBg3dLtUserPresetMutationResult
): StudioBg3dLtUserPresetMutationSuccess {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`Expected success, received ${result.reason}.`);
  return result;
}

describe("Studio BG3D LT user preset library empty and load boundaries", () => {
  it("exports one deeply immutable canonical empty payload and deterministic wire value", () => {
    expect(EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD).toEqual({
      kind: STUDIO_BG3D_LT_PRESET_PAYLOAD_KIND,
      version: STUDIO_BG3D_LT_PRESET_PAYLOAD_VERSION,
      presets: [],
    });
    expect(Object.isFrozen(EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD)).toBe(true);
    expect(Object.isFrozen(EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD.presets)).toBe(true);
    expect(EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD_JSON).toBe(
      serializeStudioBg3dLtPresetPayload(EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD)
    );
    expect(parseStudioBg3dLtPresetPayload(EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD_JSON)).toEqual(
      EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD
    );
  });

  it("treats nullish storage as missing without requesting an unnecessary write", () => {
    for (const raw of [null, undefined]) {
      const loaded = loadStudioBg3dLtUserPresetLibrary(raw);
      expect(loaded).toEqual({
        status: "missing",
        payload: EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD,
        canonicalJson: EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD_JSON,
        shouldRewrite: false,
      });
      expect(loaded.payload).toBe(EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD);
      expect(Object.isFrozen(loaded)).toBe(true);
    }
  });

  it("loads only canonical wire JSON and returns frozen canonical data", () => {
    const wire = serializeStudioBg3dLtPresetPayload(
      canonicalPayload(draft("user.alpha"), draft("user.zulu"))
    );
    const loaded = loadStudioBg3dLtUserPresetLibrary(wire);

    expect(loaded.status).toBe("loaded");
    expect(loaded.shouldRewrite).toBe(false);
    expect(loaded.canonicalJson).toBe(wire);
    expect(loaded.payload.presets.map((preset) => preset.id)).toEqual(["user.alpha", "user.zulu"]);
    expect(Object.isFrozen(loaded)).toBe(true);
    expect(Object.isFrozen(loaded.payload)).toBe(true);
    expect(Object.isFrozen(loaded.payload.presets[0]?.line)).toBe(true);
  });

  it("recovers malformed, oversized, future, noncanonical, and non-string storage values", () => {
    const unsorted = JSON.stringify({
      kind: STUDIO_BG3D_LT_PRESET_PAYLOAD_KIND,
      version: STUDIO_BG3D_LT_PRESET_PAYLOAD_VERSION,
      presets: [fullPreset(draft("user.zulu")), fullPreset(draft("user.alpha"))],
    });
    const invalidValues: unknown[] = [
      "",
      "{not-json",
      " ".repeat(STUDIO_BG3D_LT_PRESET_MAX_BYTES + 1),
      JSON.stringify({ kind: STUDIO_BG3D_LT_PRESET_PAYLOAD_KIND, version: 2, presets: [] }),
      unsorted,
      {},
      7,
      false,
    ];

    for (const raw of invalidValues) {
      const loaded = loadStudioBg3dLtUserPresetLibrary(raw);
      expect(loaded.status).toBe("recovered");
      expect(loaded.shouldRewrite).toBe(true);
      expect(loaded.payload).toBe(EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD);
      expect(loaded.canonicalJson).toBe(EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD_JSON);
    }
  });

  it("does not inspect accessors on a non-string value supplied by a storage adapter", () => {
    let invoked = false;
    const hostile = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(hostile, "value", {
      enumerable: true,
      get() {
        invoked = true;
        return EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD_JSON;
      },
    });

    expect(loadStudioBg3dLtUserPresetLibrary(hostile).status).toBe("recovered");
    expect(invoked).toBe(false);
  });
});

describe("Studio BG3D LT user preset creation", () => {
  it("creates a canonical immutable preset, preserves its caller id, and leaves inputs untouched", () => {
    const base = canonicalPayload(draft("user.zulu"));
    const input = draft("User.Alpha", "알파");
    const inputSnapshot = JSON.stringify(input);
    const result = success(createStudioBg3dLtUserPreset(base, input));

    expect(result.operation).toBe("created");
    expect(result.payload.presets.map((preset) => preset.id)).toEqual(["User.Alpha", "user.zulu"]);
    expect(result.preset?.id).toBe("User.Alpha");
    expect(result.preset?.name).toBe("알파");
    expect(result.canonicalJson).toBe(serializeStudioBg3dLtPresetPayload(result.payload));
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.payload)).toBe(true);
    expect(Object.isFrozen(result.preset)).toBe(true);
    expect(result.payload).not.toBe(base);
    expect(result.preset?.line).not.toBe(input.line);
    expect(JSON.stringify(input)).toBe(inputSnapshot);
    expect(base.presets.map((preset) => preset.id)).toEqual(["user.zulu"]);
  });

  it("is deterministic regardless of valid creation order", () => {
    const alpha = draft("user.alpha", "알파");
    const zulu = draft("user.zulu", "줄루");
    const alphaThenZulu = success(
      createStudioBg3dLtUserPreset(
        success(createStudioBg3dLtUserPreset(EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD, alpha)).payload,
        zulu
      )
    );
    const zuluThenAlpha = success(
      createStudioBg3dLtUserPreset(
        success(createStudioBg3dLtUserPreset(EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD, zulu)).payload,
        alpha
      )
    );

    expect(alphaThenZulu.canonicalJson).toBe(zuluThenAlpha.canonicalJson);
    expect(alphaThenZulu.payload).toEqual(zuluThenAlpha.payload);
  });

  it("rejects duplicate and built-in ids without silently suffixing or shadowing", () => {
    const existing = draft("user.same");
    expect(createStudioBg3dLtUserPreset(canonicalPayload(existing), existing)).toEqual({
      ok: false,
      reason: "duplicate-id",
    });
    expect(
      createStudioBg3dLtUserPreset(
        EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD,
        draft(STUDIO_BG3D_LT_BUILT_IN_PRESETS[0].id)
      )
    ).toEqual({ ok: false, reason: "built-in-id" });
  });

  it("rejects invalid ids, text, settings, unknown fields, hostile prototypes, and accessors", () => {
    const invalidDrafts: unknown[] = [
      draft("unsafe id"),
      draft("user.space", " 앞뒤 공백 "),
      draft("user.range", "범위", {
        line: { ...draft().line, widthPx: 99 },
      }),
      { ...draft("user.extra"), extra: true },
      Object.assign(Object.create({ inherited: true }) as object, draft("user.inherited")),
    ];
    for (const value of invalidDrafts) {
      expect(createStudioBg3dLtUserPreset(EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD, value)).toEqual({
        ok: false,
        reason: "invalid-preset",
      });
    }

    let invoked = false;
    const accessor = { ...draft("user.accessor") } as Record<string, unknown>;
    Object.defineProperty(accessor, "name", {
      enumerable: true,
      get() {
        invoked = true;
        return "호출되면 안 됨";
      },
    });
    expect(
      createStudioBg3dLtUserPreset(EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD, accessor)
    ).toEqual({ ok: false, reason: "invalid-preset" });
    expect(invoked).toBe(false);
  });

  it("admits the final available slot and reports max-count only for a new id", () => {
    const atThirtyOne = canonicalPayload(
      ...Array.from({ length: STUDIO_BG3D_LT_PRESET_MAX_COUNT - 1 }, (_, index) =>
        draft(`user.${String(index).padStart(2, "0")}`, `프리셋 ${index}`)
      )
    );
    const filled = success(createStudioBg3dLtUserPreset(atThirtyOne, draft("user.last", "마지막")));
    expect(filled.payload.presets).toHaveLength(STUDIO_BG3D_LT_PRESET_MAX_COUNT);
    expect(
      createStudioBg3dLtUserPreset(filled.payload, draft("user.overflow", "초과"))
    ).toEqual({ ok: false, reason: "max-count" });
    expect(
      createStudioBg3dLtUserPreset(filled.payload, draft("user.last", "중복"))
    ).toEqual({ ok: false, reason: "duplicate-id" });
  });
});

describe("Studio BG3D LT user preset upsert", () => {
  it("creates an absent id and replaces an exact id without changing cardinality", () => {
    const created = success(
      upsertStudioBg3dLtUserPreset(
        EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD,
        draft("user.upsert", "처음")
      )
    );
    expect(created.operation).toBe("created");

    const updated = success(
      upsertStudioBg3dLtUserPreset(created.payload, draft("user.upsert", "수정됨", {
        line: { ...draft().line, widthPx: 2.25 },
      }))
    );
    expect(updated.operation).toBe("updated");
    expect(updated.payload.presets).toHaveLength(1);
    expect(updated.preset).toMatchObject({ id: "user.upsert", name: "수정됨" });
    expect(updated.preset?.line.widthPx).toBe(2.25);
    expect(created.preset?.name).toBe("처음");
  });

  it("allows replacement at max count but refuses a new id", () => {
    const full = canonicalPayload(
      ...Array.from({ length: STUDIO_BG3D_LT_PRESET_MAX_COUNT }, (_, index) =>
        draft(`user.${String(index).padStart(2, "0")}`, `프리셋 ${index}`)
      )
    );
    const updated = success(
      upsertStudioBg3dLtUserPreset(full, draft("user.00", "최대치에서도 수정"))
    );
    expect(updated.operation).toBe("updated");
    expect(updated.payload.presets).toHaveLength(STUDIO_BG3D_LT_PRESET_MAX_COUNT);
    expect(updated.preset?.name).toBe("최대치에서도 수정");
    expect(upsertStudioBg3dLtUserPreset(full, draft("user.new"))).toEqual({
      ok: false,
      reason: "max-count",
    });
  });

  it("rejects built-in ids for both create and replacement semantics", () => {
    for (const builtIn of STUDIO_BG3D_LT_BUILT_IN_PRESETS) {
      expect(
        upsertStudioBg3dLtUserPreset(
          EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD,
          draft(builtIn.id)
        )
      ).toEqual({ ok: false, reason: "built-in-id" });
    }
  });
});

describe("Studio BG3D LT user preset rename and delete", () => {
  it("renames display text only and preserves stable identity and LT settings", () => {
    const original = canonicalPayload(draft("user.rename", "이전 이름"));
    const before = original.presets[0];
    const renamed = success(renameStudioBg3dLtUserPreset(original, "user.rename", "새 이름"));

    expect(renamed.operation).toBe("renamed");
    expect(renamed.preset?.id).toBe("user.rename");
    expect(renamed.preset?.name).toBe("새 이름");
    expect(renamed.preset?.description).toBe(before.description);
    expect(renamed.preset?.line).toEqual(before.line);
    expect(renamed.preset?.tone).toEqual(before.tone);
    expect(original.presets[0].name).toBe("이전 이름");
  });

  it("allows duplicate display names while keeping ids unique", () => {
    const original = canonicalPayload(
      draft("user.alpha", "공통 이름"),
      draft("user.beta", "다른 이름")
    );
    const renamed = success(renameStudioBg3dLtUserPreset(original, "user.beta", "공통 이름"));
    expect(renamed.payload.presets.map((preset) => preset.name)).toEqual(["공통 이름", "공통 이름"]);
  });

  it("rejects invalid names, missing ids, and built-in rename targets", () => {
    const original = canonicalPayload(draft("user.rename"));
    for (const name of [
      " 앞뒤 공백 ",
      "제어\u0000문자",
      "가".repeat(STUDIO_BG3D_LT_PRESET_MAX_NAME_LENGTH + 1),
    ]) {
      expect(renameStudioBg3dLtUserPreset(original, "user.rename", name)).toEqual({
        ok: false,
        reason: "invalid-name",
      });
    }
    expect(renameStudioBg3dLtUserPreset(original, "user.missing", "없음")).toEqual({
      ok: false,
      reason: "not-found",
    });
    expect(
      renameStudioBg3dLtUserPreset(original, STUDIO_BG3D_LT_BUILT_IN_PRESETS[0].id, "변경")
    ).toEqual({ ok: false, reason: "built-in-id" });
  });

  it("deletes one exact user id without mutating the source", () => {
    const original = canonicalPayload(draft("user.alpha"), draft("user.beta"));
    const deleted = success(deleteStudioBg3dLtUserPreset(original, "user.alpha"));

    expect(deleted.operation).toBe("deleted");
    expect(deleted.preset).toBeNull();
    expect(deleted.payload.presets.map((preset) => preset.id)).toEqual(["user.beta"]);
    expect(original.presets.map((preset) => preset.id)).toEqual(["user.alpha", "user.beta"]);
    expect(parseStudioBg3dLtPresetPayload(deleted.canonicalJson)).toEqual(deleted.payload);
  });

  it("rejects missing and built-in delete targets", () => {
    const original = canonicalPayload(draft("user.keep"));
    expect(deleteStudioBg3dLtUserPreset(original, "user.missing")).toEqual({
      ok: false,
      reason: "not-found",
    });
    expect(
      deleteStudioBg3dLtUserPreset(original, STUDIO_BG3D_LT_BUILT_IN_PRESETS[0].id)
    ).toEqual({ ok: false, reason: "built-in-id" });
  });
});

describe("Studio BG3D LT user preset mutation trust boundary", () => {
  it("rejects corrupt payloads for every mutation and freezes failure results", () => {
    const corrupt = {
      ...EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD,
      unknown: "must not survive",
    };
    const results = [
      createStudioBg3dLtUserPreset(corrupt, draft()),
      upsertStudioBg3dLtUserPreset(corrupt, draft()),
      renameStudioBg3dLtUserPreset(corrupt, "user.id", "이름"),
      deleteStudioBg3dLtUserPreset(corrupt, "user.id"),
    ];
    for (const result of results) {
      expect(result).toEqual({ ok: false, reason: "invalid-payload" });
      expect(Object.isFrozen(result)).toBe(true);
    }
  });

  it("does not invoke payload accessors while rejecting an untrusted mutation source", () => {
    let invoked = false;
    const hostile = Object.create(null) as Record<string, unknown>;
    hostile.kind = STUDIO_BG3D_LT_PRESET_PAYLOAD_KIND;
    hostile.version = STUDIO_BG3D_LT_PRESET_PAYLOAD_VERSION;
    Object.defineProperty(hostile, "presets", {
      enumerable: true,
      get() {
        invoked = true;
        return [];
      },
    });

    expect(createStudioBg3dLtUserPreset(hostile, draft())).toEqual({
      ok: false,
      reason: "invalid-payload",
    });
    expect(invoked).toBe(false);
  });
});
