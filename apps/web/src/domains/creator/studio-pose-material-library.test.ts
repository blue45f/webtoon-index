import { describe, expect, it } from "vitest";

import { STUDIO_HUMANOID_BONE_NAMES } from "./studio-humanoid-bones";
import {
  STUDIO_POSE_MATERIAL_KIND,
  STUDIO_POSE_MATERIAL_VERSION,
  STUDIO_POSE_ROTATION_CONVENTION,
  type StudioPoseMaterial,
} from "./studio-pose-material";
import {
  EMPTY_STUDIO_POSE_MATERIAL_LIBRARY,
  EMPTY_STUDIO_POSE_MATERIAL_LIBRARY_JSON,
  STUDIO_POSE_MATERIAL_LIBRARY_KIND,
  STUDIO_POSE_MATERIAL_LIBRARY_MAX_BYTES,
  STUDIO_POSE_MATERIAL_LIBRARY_MAX_COUNT,
  STUDIO_POSE_MATERIAL_LIBRARY_STORAGE_KEY,
  STUDIO_POSE_MATERIAL_LIBRARY_VERSION,
  deleteStudioPoseMaterial,
  exportStudioPoseMaterialLibrary,
  importStudioPoseMaterialLibrary,
  loadStudioPoseMaterialLibrary,
  parseStudioPoseMaterialLibraryPayload,
  saveStudioPoseMaterialLibrary,
  serializeStudioPoseMaterialLibraryPayload,
  upsertStudioPoseMaterial,
  type StudioPoseMaterialLibraryMutationResult,
  type StudioPoseMaterialLibrarySuccess,
  type StudioPoseMaterialStorage,
} from "./studio-pose-material-library";

class MemoryStorage implements StudioPoseMaterialStorage {
  readonly values = new Map<string, string>();
  reads = 0;
  writes = 0;
  throwOnRead = false;
  throwOnWrite = false;

  getItem(key: string): string | null {
    this.reads += 1;
    if (this.throwOnRead) throw new Error("read blocked");
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.writes += 1;
    if (this.throwOnWrite) throw new Error("quota");
    this.values.set(key, value);
  }
}

function material(id = "pose.alpha", name = "알파 포즈", bone: "head" | "leftHand" = "head"): StudioPoseMaterial {
  return {
    kind: STUDIO_POSE_MATERIAL_KIND,
    version: STUDIO_POSE_MATERIAL_VERSION,
    rotationConvention: STUDIO_POSE_ROTATION_CONVENTION,
    id,
    name,
    scope: "full",
    bones: [{ bone, rotation: [0, 0, 0, 1] }],
    metadata: { description: "", tags: [] },
  };
}

function payload(...materials: StudioPoseMaterial[]) {
  return {
    kind: STUDIO_POSE_MATERIAL_LIBRARY_KIND,
    version: STUDIO_POSE_MATERIAL_LIBRARY_VERSION,
    materials,
  };
}

function success(result: StudioPoseMaterialLibraryMutationResult): StudioPoseMaterialLibrarySuccess {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`Expected success, received ${result.reason}.`);
  return result;
}

describe("Studio pose material library load boundary", () => {
  it("shares one deeply immutable canonical empty payload", () => {
    expect(EMPTY_STUDIO_POSE_MATERIAL_LIBRARY).toEqual(payload());
    expect(EMPTY_STUDIO_POSE_MATERIAL_LIBRARY_JSON).toBe(
      JSON.stringify(EMPTY_STUDIO_POSE_MATERIAL_LIBRARY)
    );
    expect(Object.isFrozen(EMPTY_STUDIO_POSE_MATERIAL_LIBRARY)).toBe(true);
    expect(Object.isFrozen(EMPTY_STUDIO_POSE_MATERIAL_LIBRARY.materials)).toBe(true);
  });

  it("distinguishes unavailable, missing, and read-error storage without writing", () => {
    expect(loadStudioPoseMaterialLibrary(null)).toMatchObject({
      status: "unavailable",
      shouldRewrite: false,
    });

    const missing = new MemoryStorage();
    expect(loadStudioPoseMaterialLibrary(missing)).toMatchObject({
      status: "missing",
      payload: EMPTY_STUDIO_POSE_MATERIAL_LIBRARY,
      shouldRewrite: false,
    });
    expect(missing.writes).toBe(0);

    missing.throwOnRead = true;
    expect(loadStudioPoseMaterialLibrary(missing)).toMatchObject({
      status: "read-error",
      shouldRewrite: false,
    });
    expect(missing.writes).toBe(0);
  });

  it("loads valid data, canonicalizes order, and signals a safe caller-managed rewrite", () => {
    const storage = new MemoryStorage();
    storage.values.set(
      STUDIO_POSE_MATERIAL_LIBRARY_STORAGE_KEY,
      JSON.stringify(payload(material("pose.zulu"), material("pose.alpha")))
    );
    const loaded = loadStudioPoseMaterialLibrary(storage);
    expect(loaded.status).toBe("loaded");
    expect(loaded.payload.materials.map((entry) => entry.id)).toEqual(["pose.alpha", "pose.zulu"]);
    expect(loaded.shouldRewrite).toBe(true);
    expect(Object.isFrozen(loaded)).toBe(true);
    expect(Object.isFrozen(loaded.payload.materials[0]?.bones)).toBe(true);
    expect(storage.writes).toBe(0);
  });

  it("fails closed on malformed, oversized, or duplicate-id storage without repair hints", () => {
    const invalid = [
      "{bad",
      JSON.stringify({ ...payload(), unknown: true }),
      JSON.stringify(payload(material("pose.same"), material("pose.same"))),
      " ".repeat(STUDIO_POSE_MATERIAL_LIBRARY_MAX_BYTES + 1),
    ];
    for (const raw of invalid) {
      const storage = new MemoryStorage();
      storage.values.set(STUDIO_POSE_MATERIAL_LIBRARY_STORAGE_KEY, raw);
      const loaded = loadStudioPoseMaterialLibrary(storage);
      expect(loaded.status).toBe("corrupt");
      expect(loaded.payload).toBe(EMPTY_STUDIO_POSE_MATERIAL_LIBRARY);
      expect(loaded.canonicalJson).toBeNull();
      expect(loaded.shouldRewrite).toBe(false);
      expect(storage.writes).toBe(0);
    }
  });

  it("distinguishes future envelopes and never offers v1 empty JSON as a rewrite target", () => {
    const storage = new MemoryStorage();
    storage.values.set(
      STUDIO_POSE_MATERIAL_LIBRARY_STORAGE_KEY,
      JSON.stringify({ ...payload(), version: 2, futureData: { keep: true } })
    );
    expect(loadStudioPoseMaterialLibrary(storage)).toMatchObject({
      status: "future",
      payload: EMPTY_STUDIO_POSE_MATERIAL_LIBRARY,
      canonicalJson: null,
      shouldRewrite: false,
    });
    expect(storage.writes).toBe(0);
  });
});

describe("Studio pose material library payload contract", () => {
  it("sorts ids, rejects duplicates/unknowns, and round-trips canonical JSON", () => {
    const parsed = parseStudioPoseMaterialLibraryPayload(
      payload(material("pose.zulu"), material("pose.alpha"))
    );
    expect(parsed?.materials.map((entry) => entry.id)).toEqual(["pose.alpha", "pose.zulu"]);
    const wire = serializeStudioPoseMaterialLibraryPayload(parsed);
    expect(wire).not.toBeNull();
    expect(serializeStudioPoseMaterialLibraryPayload(wire)).toBe(wire);
    expect(
      parseStudioPoseMaterialLibraryPayload(payload(material("pose.same"), material("pose.same")))
    ).toBeNull();
    expect(parseStudioPoseMaterialLibraryPayload({ ...payload(), extra: true })).toBeNull();
  });

  it("rejects too many materials before attempting persistence", () => {
    const tooMany = Array.from(
      { length: STUDIO_POSE_MATERIAL_LIBRARY_MAX_COUNT + 1 },
      (_, index) => material(`pose.${index}`)
    );
    expect(parseStudioPoseMaterialLibraryPayload(payload(...tooMany))).toBeNull();
  });

  it("does not invoke accessors on object input", () => {
    let invoked = false;
    const hostile = { ...payload() } as Record<string, unknown>;
    Object.defineProperty(hostile, "materials", {
      enumerable: true,
      get() {
        invoked = true;
        return [];
      },
    });
    expect(parseStudioPoseMaterialLibraryPayload(hostile)).toBeNull();
    expect(invoked).toBe(false);
  });
});

describe("Studio pose material library save/upsert/delete", () => {
  it("saves one canonical sorted value with one storage write", () => {
    const storage = new MemoryStorage();
    const result = success(
      saveStudioPoseMaterialLibrary(storage, [material("pose.zulu"), material("pose.alpha")])
    );
    expect(result.operation).toBe("saved");
    expect(result.payload.materials.map((entry) => entry.id)).toEqual(["pose.alpha", "pose.zulu"]);
    expect(storage.writes).toBe(1);
    expect(storage.values.get(STUDIO_POSE_MATERIAL_LIBRARY_STORAGE_KEY)).toBe(result.canonicalJson);
  });

  it("requires exact force intent before a whole-library save overwrites existing data", () => {
    const storage = new MemoryStorage();
    success(saveStudioPoseMaterialLibrary(storage, [material("pose.keep")]));
    const before = storage.values.get(STUDIO_POSE_MATERIAL_LIBRARY_STORAGE_KEY);
    const writes = storage.writes;

    expect(saveStudioPoseMaterialLibrary(storage, [material("pose.new")])).toEqual({
      ok: false,
      reason: "replace-requires-force",
    });
    expect(
      saveStudioPoseMaterialLibrary(
        storage,
        [material("pose.new")],
        { force: true, extra: true } as never
      )
    ).toEqual({ ok: false, reason: "replace-requires-force" });
    expect(storage.values.get(STUDIO_POSE_MATERIAL_LIBRARY_STORAGE_KEY)).toBe(before);
    expect(storage.writes).toBe(writes);

    const replaced = success(
      saveStudioPoseMaterialLibrary(storage, [material("pose.new")], { force: true })
    );
    expect(replaced.payload.materials.map((entry) => entry.id)).toEqual(["pose.new"]);
    expect(storage.writes).toBe(writes + 1);
  });

  it("rejects invalid and duplicate save input without touching storage", () => {
    const storage = new MemoryStorage();
    expect(saveStudioPoseMaterialLibrary(storage, {})).toEqual({
      ok: false,
      reason: "invalid-library",
    });
    expect(
      saveStudioPoseMaterialLibrary(storage, [material("pose.same"), material("pose.same")])
    ).toEqual({ ok: false, reason: "duplicate-id" });
    expect(
      saveStudioPoseMaterialLibrary(storage, [{ ...material(), version: 2 }])
    ).toEqual({ ok: false, reason: "invalid-material" });
    expect(storage.writes).toBe(0);
  });

  it("snapshots only dense plain save arrays without invoking accessors or iterators", () => {
    const storage = new MemoryStorage();
    let getterReads = 0;
    const accessorArray = [material("pose.accessor")];
    Object.defineProperty(accessorArray, "0", {
      configurable: true,
      enumerable: true,
      get() {
        getterReads += 1;
        throw new Error("save input accessor must not run");
      },
    });
    expect(saveStudioPoseMaterialLibrary(storage, accessorArray)).toEqual({
      ok: false,
      reason: "invalid-library",
    });
    expect(getterReads).toBe(0);

    let iteratorRuns = 0;
    const replacedIterator = [material("pose.iterator")];
    Object.defineProperty(replacedIterator, Symbol.iterator, {
      configurable: true,
      value: function* hostileIterator() {
        iteratorRuns += 1;
        while (true) yield material("pose.unbounded");
      },
    });
    expect(saveStudioPoseMaterialLibrary(storage, replacedIterator)).toEqual({
      ok: false,
      reason: "invalid-library",
    });
    expect(iteratorRuns).toBe(0);

    const sparse = new Array(1);
    expect(saveStudioPoseMaterialLibrary(storage, sparse)).toEqual({
      ok: false,
      reason: "invalid-library",
    });

    const exoticPrototype = [material("pose.exotic")];
    Object.setPrototypeOf(exoticPrototype, Object.create(Array.prototype));
    expect(saveStudioPoseMaterialLibrary(storage, exoticPrototype)).toEqual({
      ok: false,
      reason: "invalid-library",
    });

    const overCount = Array.from(
      { length: STUDIO_POSE_MATERIAL_LIBRARY_MAX_COUNT + 1 },
      (_, index) => material(`pose.over-${index}`)
    );
    expect(saveStudioPoseMaterialLibrary(storage, overCount)).toEqual({
      ok: false,
      reason: "max-count",
    });
    expect(storage.writes).toBe(0);
  });

  it("requires a one-time exact data-only force snapshot", () => {
    const storage = new MemoryStorage();
    success(saveStudioPoseMaterialLibrary(storage, [material("pose.keep")]));
    const before = storage.values.get(STUDIO_POSE_MATERIAL_LIBRARY_STORAGE_KEY);
    const writes = storage.writes;
    let getterReads = 0;
    const accessorIntent = {} as Record<string, unknown>;
    Object.defineProperty(accessorIntent, "force", {
      configurable: true,
      enumerable: true,
      get() {
        getterReads += 1;
        throw new Error("force accessor must not run");
      },
    });
    expect(
      saveStudioPoseMaterialLibrary(
        storage,
        [material("pose.replace")],
        accessorIntent as never
      )
    ).toEqual({ ok: false, reason: "replace-requires-force" });
    expect(getterReads).toBe(0);

    const exoticIntent = Object.assign(Object.create({ inherited: true }), { force: true });
    expect(
      saveStudioPoseMaterialLibrary(storage, [material("pose.replace")], exoticIntent)
    ).toEqual({ ok: false, reason: "replace-requires-force" });

    const symbolIntent = { force: true } as Record<PropertyKey, unknown>;
    symbolIntent[Symbol("hidden")] = true;
    expect(
      saveStudioPoseMaterialLibrary(storage, [material("pose.replace")], symbolIntent as never)
    ).toEqual({ ok: false, reason: "replace-requires-force" });
    expect(storage.values.get(STUDIO_POSE_MATERIAL_LIBRARY_STORAGE_KEY)).toBe(before);
    expect(storage.writes).toBe(writes);
  });

  it("enforces the aggregate UTF-8 localStorage byte budget before writing", () => {
    const storage = new MemoryStorage();
    const heavyMaterials = Array.from(
      { length: STUDIO_POSE_MATERIAL_LIBRARY_MAX_COUNT },
      (_, index): StudioPoseMaterial => ({
        ...material(`pose.heavy-${String(index).padStart(2, "0")}`, `포즈${"가".repeat(70)}${index}`),
        bones: STUDIO_HUMANOID_BONE_NAMES.map((bone) => ({
          bone,
          rotation: [0.1, 0.2, 0.3, 0.9],
        })),
        metadata: {
          description: "설".repeat(320),
          tags: Array.from(
            { length: 12 },
            (_, tagIndex) => `tag-${String(tagIndex).padStart(2, "0")}-${"x".repeat(25)}`
          ),
        },
      })
    );
    expect(saveStudioPoseMaterialLibrary(storage, heavyMaterials)).toEqual({
      ok: false,
      reason: "max-bytes",
    });
    expect(storage.writes).toBe(0);
  });

  it("creates then replaces by exact id without increasing cardinality", () => {
    const storage = new MemoryStorage();
    const created = success(upsertStudioPoseMaterial(storage, material("pose.same", "처음")));
    expect(created.operation).toBe("created");
    const updated = success(upsertStudioPoseMaterial(storage, material("pose.same", "수정")));
    expect(updated.operation).toBe("updated");
    expect(updated.payload.materials).toHaveLength(1);
    expect(updated.payload.materials[0]?.name).toBe("수정");
    expect(storage.writes).toBe(2);
  });

  it("admits the last slot, blocks the next id, and still permits replacement", () => {
    const storage = new MemoryStorage();
    const full = Array.from({ length: STUDIO_POSE_MATERIAL_LIBRARY_MAX_COUNT }, (_, index) =>
      material(`pose.${String(index).padStart(2, "0")}`, `포즈 ${index}`)
    );
    success(saveStudioPoseMaterialLibrary(storage, full));
    expect(upsertStudioPoseMaterial(storage, material("pose.overflow"))).toEqual({
      ok: false,
      reason: "max-count",
    });
    const replacement = success(
      upsertStudioPoseMaterial(storage, material("pose.00", "교체 허용"))
    );
    expect(replacement.operation).toBe("updated");
    expect(replacement.payload.materials).toHaveLength(STUDIO_POSE_MATERIAL_LIBRARY_MAX_COUNT);
  });

  it("deletes exactly one item and reports invalid/missing ids without writes", () => {
    const storage = new MemoryStorage();
    success(saveStudioPoseMaterialLibrary(storage, [material("pose.alpha"), material("pose.zulu")]));
    const deleted = success(deleteStudioPoseMaterial(storage, "pose.alpha"));
    expect(deleted.operation).toBe("deleted");
    expect(deleted.material?.id).toBe("pose.alpha");
    expect(deleted.payload.materials.map((entry) => entry.id)).toEqual(["pose.zulu"]);
    const writes = storage.writes;
    expect(deleteStudioPoseMaterial(storage, "unsafe id")).toEqual({
      ok: false,
      reason: "invalid-id",
    });
    expect(deleteStudioPoseMaterial(storage, "pose.missing")).toEqual({
      ok: false,
      reason: "not-found",
    });
    expect(storage.writes).toBe(writes);
  });

  it("maps storage read/write failures to stable reasons and never throws", () => {
    const readFailure = new MemoryStorage();
    readFailure.throwOnRead = true;
    expect(upsertStudioPoseMaterial(readFailure, material())).toEqual({
      ok: false,
      reason: "storage-read-error",
    });

    const writeFailure = new MemoryStorage();
    writeFailure.throwOnWrite = true;
    expect(upsertStudioPoseMaterial(writeFailure, material())).toEqual({
      ok: false,
      reason: "storage-write-error",
    });
  });

  it("refuses to mutate a corrupt existing library", () => {
    const storage = new MemoryStorage();
    storage.values.set(STUDIO_POSE_MATERIAL_LIBRARY_STORAGE_KEY, "{corrupt");
    expect(upsertStudioPoseMaterial(storage, material())).toEqual({
      ok: false,
      reason: "library-corrupt",
    });
    expect(storage.writes).toBe(0);
    expect(storage.values.get(STUDIO_POSE_MATERIAL_LIBRARY_STORAGE_KEY)).toBe("{corrupt");
  });

  it("preserves corrupt and future bytes across ordinary mutations and permits only forced recovery", () => {
    const fixtures = [
      { raw: "{corrupt", reason: "library-corrupt" as const },
      {
        raw: JSON.stringify({ ...payload(), version: 2, futureData: ["must", "survive"] }),
        reason: "library-future" as const,
      },
    ];

    for (const fixture of fixtures) {
      const storage = new MemoryStorage();
      storage.values.set(STUDIO_POSE_MATERIAL_LIBRARY_STORAGE_KEY, fixture.raw);
      expect(upsertStudioPoseMaterial(storage, material("pose.new"))).toEqual({
        ok: false,
        reason: fixture.reason,
      });
      expect(deleteStudioPoseMaterial(storage, "pose.any")).toEqual({
        ok: false,
        reason: fixture.reason,
      });
      expect(importStudioPoseMaterialLibrary(storage, payload(material("pose.new")), "merge")).toEqual({
        ok: false,
        reason: fixture.reason,
      });
      expect(saveStudioPoseMaterialLibrary(storage, [material("pose.new")])).toEqual({
        ok: false,
        reason: "replace-requires-force",
      });
      expect(
        importStudioPoseMaterialLibrary(storage, payload(material("pose.new")), "replace")
      ).toEqual({ ok: false, reason: "replace-requires-force" });
      expect(storage.writes).toBe(0);
      expect(storage.values.get(STUDIO_POSE_MATERIAL_LIBRARY_STORAGE_KEY)).toBe(fixture.raw);

      const recovered = success(
        importStudioPoseMaterialLibrary(
          storage,
          payload(material("pose.recovered")),
          "replace",
          { force: true }
        )
      );
      expect(recovered.payload.materials.map((entry) => entry.id)).toEqual(["pose.recovered"]);
      expect(storage.writes).toBe(1);
    }
  });
});

describe("Studio pose material library import/export", () => {
  it("merges transactionally and lets imported ids replace existing materials", () => {
    const storage = new MemoryStorage();
    success(
      saveStudioPoseMaterialLibrary(storage, [
        material("pose.alpha", "기존 알파"),
        material("pose.keep", "유지"),
      ])
    );
    const wire = JSON.stringify(
      payload(material("pose.alpha", "가져온 알파"), material("pose.new", "새 포즈"))
    );
    const imported = success(importStudioPoseMaterialLibrary(storage, wire, "merge"));
    expect(imported.operation).toBe("imported");
    expect(imported.payload.materials.map((entry) => [entry.id, entry.name])).toEqual([
      ["pose.alpha", "가져온 알파"],
      ["pose.keep", "유지"],
      ["pose.new", "새 포즈"],
    ]);
  });

  it("replace mode fails closed without force, then drops old items with explicit force", () => {
    const storage = new MemoryStorage();
    success(saveStudioPoseMaterialLibrary(storage, [material("pose.old")]));
    const before = storage.values.get(STUDIO_POSE_MATERIAL_LIBRARY_STORAGE_KEY);
    const writes = storage.writes;
    expect(
      importStudioPoseMaterialLibrary(storage, payload(material("pose.new")), "replace")
    ).toEqual({ ok: false, reason: "replace-requires-force" });
    expect(storage.values.get(STUDIO_POSE_MATERIAL_LIBRARY_STORAGE_KEY)).toBe(before);
    expect(storage.writes).toBe(writes);
    const imported = success(
      importStudioPoseMaterialLibrary(
        storage,
        payload(material("pose.new")),
        "replace",
        { force: true }
      )
    );
    expect(imported.payload.materials.map((entry) => entry.id)).toEqual(["pose.new"]);
    expect(storage.values.get(STUDIO_POSE_MATERIAL_LIBRARY_STORAGE_KEY)).toBe(
      imported.canonicalJson
    );
  });

  it("rejects invalid/oversized imports before the single commit write", () => {
    const storage = new MemoryStorage();
    success(saveStudioPoseMaterialLibrary(storage, [material("pose.keep")]));
    const before = storage.values.get(STUDIO_POSE_MATERIAL_LIBRARY_STORAGE_KEY);
    const writes = storage.writes;
    expect(importStudioPoseMaterialLibrary(storage, "{bad", "merge")).toEqual({
      ok: false,
      reason: "invalid-library",
    });
    expect(
      importStudioPoseMaterialLibrary(
        storage,
        " ".repeat(STUDIO_POSE_MATERIAL_LIBRARY_MAX_BYTES + 1),
        "replace"
      )
    ).toEqual({ ok: false, reason: "invalid-library" });
    expect(storage.writes).toBe(writes);
    expect(storage.values.get(STUDIO_POSE_MATERIAL_LIBRARY_STORAGE_KEY)).toBe(before);
  });

  it("exports canonical portable JSON for loaded and empty libraries", () => {
    const storage = new MemoryStorage();
    expect(exportStudioPoseMaterialLibrary(storage)).toEqual({
      ok: true,
      json: EMPTY_STUDIO_POSE_MATERIAL_LIBRARY_JSON,
      count: 0,
    });
    success(saveStudioPoseMaterialLibrary(storage, [material("pose.zulu"), material("pose.alpha")]));
    const exported = exportStudioPoseMaterialLibrary(storage);
    expect(exported.ok).toBe(true);
    if (!exported.ok) throw new Error(exported.reason);
    expect(exported.count).toBe(2);
    expect(parseStudioPoseMaterialLibraryPayload(exported.json)?.materials.map((entry) => entry.id)).toEqual([
      "pose.alpha",
      "pose.zulu",
    ]);
  });
});
