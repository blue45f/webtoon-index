import { describe, expect, it } from "vitest";

import {
  assessStudioTranslationMemoryEntry,
  createStudioTranslationMemoryEntry,
  exportStudioTranslationMemory,
  findStudioTranslationMemoryGlossaryConflicts,
  importStudioTranslationMemory,
  invalidateStudioTranslationMemoryEntry,
  loadStudioTranslationMemory,
  mergeStudioTranslationMemoryEntries,
  normalizeStudioTranslationMemoryText,
  parseStudioTranslationMemoryGlossaryText,
  queryStudioTranslationMemory,
  saveStudioTranslationMemory,
  setStudioTranslationMemoryEntryStatus,
  STUDIO_TRANSLATION_MEMORY_KIND,
  STUDIO_TRANSLATION_MEMORY_MAX_IMPORT_BYTES,
  STUDIO_TRANSLATION_MEMORY_MAX_IMPORT_CANDIDATES,
  STUDIO_TRANSLATION_MEMORY_MAX_SOURCE_CHARS,
  STUDIO_TRANSLATION_MEMORY_VERSION,
  studioTranslationMemorySourceHash,
  type CreateStudioTranslationMemoryEntryInput,
  type StudioTranslationMemoryEntry,
  type StudioTranslationMemoryStorage,
} from "./studio-translation-memory";

function createEntry(
  overrides: Partial<CreateStudioTranslationMemoryEntryInput> = {}
): StudioTranslationMemoryEntry {
  const result = createStudioTranslationMemoryEntry({
    workScope: "episode-01",
    sourceText: "오늘도 정말 반가워, 민수야!",
    speaker: "유나",
    sourceLocale: "ko-KR",
    targetLocale: "en-US",
    translation: "It is so good to see you again, Minsu!",
    sourceRevision: "revision-1",
    status: "approved",
    now: 100,
    ...overrides,
  });
  if (!result.ok) throw new Error(result.error);
  return result.entry;
}

class MemoryStorage implements StudioTranslationMemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("studio translation memory exact and fuzzy matching", () => {
  it("matches exact entries by work, speaker, locale pair and NFKC/whitespace-normalized source", () => {
    const entry = createEntry({
      sourceText: "Ａ　안녕\n  세상",
      speaker: "  YUNA  ",
      sourceLocale: "KO-kr",
      targetLocale: "EN-us",
      translation: "Hello, world",
    });

    const result = queryStudioTranslationMemory([entry], {
      workScope: "episode-01",
      sourceText: "A 안녕 세상",
      speaker: "yuna",
      sourceLocale: "ko-KR",
      targetLocale: "en-US",
      sourceRevision: "revision-1",
    });

    expect(normalizeStudioTranslationMemoryText("Ａ　안녕\n  세상")).toBe(
      "A 안녕 세상"
    );
    expect(result.exact?.entry.id).toBe(entry.id);
    expect(result.exact?.reusable).toBe(true);
    expect(
      queryStudioTranslationMemory([entry], {
        workScope: "episode-01",
        sourceText: "A 안녕 세상",
        speaker: "다른 화자",
        sourceLocale: "ko-KR",
        targetLocale: "en-US",
        sourceRevision: "revision-1",
      }).exact
    ).toBeNull();
  });

  it("returns conservative reviewed/approved fuzzy suggestions but hard-codes automatic application off", () => {
    const entry = createEntry();
    const result = queryStudioTranslationMemory([entry], {
      workScope: "episode-01",
      sourceText: "오늘도 정말 반가워 민수야!",
      speaker: "유나",
      sourceLocale: "ko-KR",
      targetLocale: "en-US",
      sourceRevision: "revision-2",
    });

    expect(result.exact).toBeNull();
    expect(result.fuzzy).toHaveLength(1);
    expect(result.fuzzy[0].score).toBeGreaterThanOrEqual(0.86);
    expect(result.fuzzy[0].autoApply).toBe(false);

    const draft = createEntry({
      sourceText: "오늘도 정말 반가워, 철수야!",
      status: "draft",
    });
    expect(
      queryStudioTranslationMemory([draft], {
        workScope: "episode-01",
        sourceText: "오늘도 정말 반가워 철수야!",
        speaker: "유나",
        sourceLocale: "ko-KR",
        targetLocale: "en-US",
        sourceRevision: "revision-2",
      }).fuzzy
    ).toEqual([]);
  });

  it("never suggests entries from another work, speaker or locale pair", () => {
    const entry = createEntry();
    const base = {
      sourceText: "오늘도 정말 반가워 민수야!",
      speaker: "유나",
      sourceLocale: "ko-KR",
      targetLocale: "en-US",
      sourceRevision: "revision-2",
    };

    expect(
      queryStudioTranslationMemory([entry], {
        ...base,
        workScope: "episode-02",
      }).fuzzy
    ).toEqual([]);
    expect(
      queryStudioTranslationMemory([entry], {
        ...base,
        workScope: "episode-01",
        targetLocale: "ja-JP",
      }).fuzzy
    ).toEqual([]);
  });
});

describe("studio translation memory review and stale policy", () => {
  it("marks exact results stale when source hash or revision changes", () => {
    const entry = createEntry();
    expect(
      assessStudioTranslationMemoryEntry(entry, {
        workScope: "episode-01",
        sourceText: entry.sourceText,
        speaker: entry.speaker,
        sourceLocale: entry.sourceLocale,
        targetLocale: entry.targetLocale,
        sourceRevision: "revision-2",
      }).stale
    ).toBe(true);
    expect(
      studioTranslationMemorySourceHash("Ａ  B")
    ).toBe(studioTranslationMemorySourceHash("A B"));

    const result = queryStudioTranslationMemory([entry], {
      workScope: entry.workScope,
      sourceText: entry.sourceText,
      speaker: entry.speaker,
      sourceLocale: entry.sourceLocale,
      targetLocale: entry.targetLocale,
      sourceRevision: "revision-2",
    });
    expect(result.exact?.stale).toBe(true);
    expect(result.exact?.reusable).toBe(false);
  });

  it("supports draft → reviewed → approved and makes invalidation fail closed", () => {
    const draft = createEntry({ status: "draft" });
    const reviewed = setStudioTranslationMemoryEntryStatus(
      [draft],
      draft.id,
      "reviewed",
      200
    );
    const approved = setStudioTranslationMemoryEntryStatus(
      reviewed,
      draft.id,
      "approved",
      300
    );
    const invalidated = invalidateStudioTranslationMemoryEntry(
      approved,
      draft.id,
      400
    );
    const rejectedApproval = setStudioTranslationMemoryEntryStatus(
      invalidated,
      draft.id,
      "approved",
      500
    );

    expect(reviewed[0].status).toBe("reviewed");
    expect(approved[0].status).toBe("approved");
    expect(invalidated[0]).toMatchObject({ stale: true, status: "draft" });
    expect(rejectedApproval).toBe(invalidated);
  });
});

describe("studio translation memory glossary integrity", () => {
  it("parses bounded glossary lines and reports missing or ambiguous rules", () => {
    const rules = parseStudioTranslationMemoryGlossaryText(
      "민수: Minsu\n민수 = Minsoo\n유나 => Yuna\ninvalid"
    );
    const conflicts = findStudioTranslationMemoryGlossaryConflicts({
      sourceText: "민수와 유나가 만났다.",
      translation: "Minsu met Yoona.",
      sourceLocale: "ko-KR",
      targetLocale: "en-US",
      rules,
    });

    expect(rules).toHaveLength(3);
    expect(conflicts.map((conflict) => conflict.kind)).toEqual([
      "ambiguous-rule",
      "missing-target",
    ]);
    expect(conflicts[0].expectedTargets).toEqual(["Minsoo", "Minsu"]);
    expect(conflicts[1].message).toContain("Yuna");
  });

  it("does not allow a glossary-conflicting translation to enter as approved", () => {
    const result = createStudioTranslationMemoryEntry({
      workScope: "episode-01",
      sourceText: "민수가 왔다.",
      speaker: "",
      sourceLocale: "ko",
      targetLocale: "en",
      translation: "Minsoo is here.",
      sourceRevision: "1",
      status: "approved",
      glossaryRules: [{ sourceTerm: "민수", targetTerm: "Minsu" }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("용어집 충돌");
  });
});

describe("studio translation memory bounded persistence and interchange", () => {
  it("merges duplicates deterministically regardless of input order", () => {
    const draft = createEntry({
      status: "draft",
      translation: "newer draft",
      now: 500,
    });
    const approved = createEntry({
      status: "approved",
      translation: "approved translation",
      now: 100,
    });

    const forward = mergeStudioTranslationMemoryEntries([draft, approved]);
    const reverse = mergeStudioTranslationMemoryEntries([approved, draft]);

    expect(forward).toEqual(reverse);
    expect(forward).toHaveLength(1);
    expect(forward[0].translation).toBe("approved translation");
  });

  it("round-trips bounded JSON, rejects malformed rows, and merges imported duplicates", () => {
    const entry = createEntry();
    const document = JSON.stringify({
      kind: STUDIO_TRANSLATION_MEMORY_KIND,
      version: STUDIO_TRANSLATION_MEMORY_VERSION,
      entries: [entry, { bad: true }],
    });
    const imported = importStudioTranslationMemory(document, [entry]);

    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.entries).toHaveLength(1);
    expect(imported.accepted).toBe(1);
    expect(imported.rejected).toBe(1);
    expect(imported.duplicates).toBeGreaterThanOrEqual(1);

    const exported = exportStudioTranslationMemory(imported.entries);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.bytes).toBeLessThanOrEqual(1_500_000);
    expect(JSON.parse(exported.json)).toMatchObject({
      kind: STUDIO_TRANSLATION_MEMORY_KIND,
      version: STUDIO_TRANSLATION_MEMORY_VERSION,
    });
  });

  it("enforces source, import byte, candidate-count and export validation caps", () => {
    expect(
      createStudioTranslationMemoryEntry({
        workScope: "work",
        sourceText: "가".repeat(STUDIO_TRANSLATION_MEMORY_MAX_SOURCE_CHARS + 1),
        sourceLocale: "ko",
        targetLocale: "en",
        translation: "text",
        sourceRevision: "1",
      }).ok
    ).toBe(false);
    expect(
      importStudioTranslationMemory(
        "x".repeat(STUDIO_TRANSLATION_MEMORY_MAX_IMPORT_BYTES + 1)
      ).ok
    ).toBe(false);
    expect(
      importStudioTranslationMemory(
        JSON.stringify({
          kind: STUDIO_TRANSLATION_MEMORY_KIND,
          version: STUDIO_TRANSLATION_MEMORY_VERSION,
          entries: Array.from(
            { length: STUDIO_TRANSLATION_MEMORY_MAX_IMPORT_CANDIDATES + 1 },
            () => null
          ),
        })
      ).ok
    ).toBe(false);
    const invalidRuntimeEntry = {
      ...createEntry(),
      sourceText: "가".repeat(STUDIO_TRANSLATION_MEMORY_MAX_SOURCE_CHARS + 1),
    };
    expect(
      exportStudioTranslationMemory([invalidRuntimeEntry]).ok
    ).toBe(false);
  });

  it("loads and saves localStorage-compatible storage without throwing on blocked storage", () => {
    const storage = new MemoryStorage();
    const entry = createEntry();

    expect(saveStudioTranslationMemory(storage, [entry]).ok).toBe(true);
    expect(loadStudioTranslationMemory(storage)).toMatchObject({
      status: "ok",
      entries: [entry],
    });

    const blocked: StudioTranslationMemoryStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadStudioTranslationMemory(blocked).status).toBe("unavailable");
    expect(saveStudioTranslationMemory(blocked, [entry]).ok).toBe(false);
    expect(loadStudioTranslationMemory(null).status).toBe("unavailable");
  });
});
