import { describe, expect, it } from "vitest";

import { SFX_LIBRARY } from "./studio-sfx-presets";
import {
  acceptStudioWriterRoomSuggestion,
  acceptStudioWriterRoomSuggestions,
  admitStudioWriterRoomDocument,
  admitStudioWriterRoomStage,
  addStudioWriterRoomSuggestion,
  computeStudioWriterRoomProgress,
  createEmptyStudioWriterRoomDocument,
  isStudioWriterRoomTargetPath,
  mergeStudioWriterRoomSuggestions,
  normalizeStudioWriterRoomDocument,
  rejectStudioWriterRoomSuggestion,
  rejectStudioWriterRoomSuggestions,
  replaceStudioWriterRoomStage,
  serializeStudioWriterRoomDocument,
  setStudioWriterRoomStageCompleted,
  studioWriterRoomHasContent,
  STUDIO_WRITER_ROOM_LIMITS,
  STUDIO_WRITER_ROOM_STAGES,
  StudioWriterRoomAdmissionError,
  StudioWriterRoomCapacityError,
  StudioWriterRoomDocumentSchema,
  undoLastStudioWriterRoomDecision,
  type StudioWriterRoomDocument,
} from "./studio-writer-room";

const CREATED_AT = "2026-07-10T00:00:00.000Z";
const DECIDED_AT = "2026-07-10T00:01:00.000Z";

function populatedDocument(): StudioWriterRoomDocument {
  let document = createEmptyStudioWriterRoomDocument();
  document = replaceStudioWriterRoomStage(document, "premise", {
    text: "비 오는 날 서로의 비밀을 알게 된 두 친구",
    characterIds: ["char-b", "char-a"],
  });
  document = replaceStudioWriterRoomStage(document, "synopsis", {
    text: "우산 하나를 나누며 갈등을 풀어 간다.",
    characterIds: ["char-a", "char-b"],
  });
  document = replaceStudioWriterRoomStage(document, "episode-outline", {
    title: "우산 아래",
    summary: "만남, 오해, 화해",
    characterIds: ["char-a", "char-b"],
  });
  document = replaceStudioWriterRoomStage(document, "beats", {
    items: [
      { id: "beat-2", order: 2, title: "화해", summary: "진심을 말한다", characterIds: ["char-b"] },
      { id: "beat-1", order: 1, title: "만남", summary: "우산이 없다", characterIds: ["char-a"] },
    ],
  });
  document = replaceStudioWriterRoomStage(document, "scenes", {
    items: [{
      id: "scene-1",
      order: 1,
      beatIds: ["beat-1"],
      heading: "학교 앞",
      summary: "빗속에서 마주친다",
      location: "교문",
      time: "방과 후",
      characterIds: ["char-a", "char-b"],
    }],
  });
  document = replaceStudioWriterRoomStage(document, "panel-plan", {
    items: [{
      id: "panel-1",
      order: 1,
      sceneId: "scene-1",
      shot: "미디엄 투샷",
      action: "우산을 내민다",
      characterIds: ["char-a", "char-b"],
    }],
  });
  document = replaceStudioWriterRoomStage(document, "dialogue-sfx", {
    dialogue: [{
      id: "dialogue-1",
      order: 1,
      panelId: "panel-1",
      characterId: "char-a",
      text: "같이 갈래?",
    }],
    sfx: [{
      id: "sfx-1",
      order: 2,
      panelId: "panel-1",
      presetId: SFX_LIBRARY[0]?.id ?? null,
      customText: "",
      style: { emphasis: "quiet", scale: "small" },
    }],
  });
  return document;
}

describe("studio-writer-room", () => {
  it("빈 문서를 엄격한 v1 형태와 7단계 진행률로 만든다", () => {
    const document = createEmptyStudioWriterRoomDocument();
    expect(StudioWriterRoomDocumentSchema.safeParse(document).success).toBe(true);
    expect(computeStudioWriterRoomProgress(document)).toEqual({
      completedStages: [],
      incompleteStages: STUDIO_WRITER_ROOM_STAGES,
      completedCount: 0,
      totalStages: 7,
      percent: 0,
      nextStage: "premise",
    });
    expect(studioWriterRoomHasContent(document)).toBe(false);
  });

  it("모든 단계는 캐릭터 원문을 복제하지 않고 ID 참조만 정규화한다", () => {
    const document = populatedDocument();
    expect(document.stages.premise.characterIds).toEqual(["char-a", "char-b"]);
    expect(document.stages.beats.items.map(({ id }) => id)).toEqual(["beat-1", "beat-2"]);
    expect(JSON.stringify(document)).not.toContain("appearance");
    expect(studioWriterRoomHasContent(document)).toBe(true);
  });

  it("legacy camelCase·배열 alias와 완료 단계를 보수적으로 마이그레이션한다", () => {
    const document = normalizeStudioWriterRoomDocument({
      premise: "한 줄 전제",
      episodeOutline: { episodeTitle: "1화", text: "개요" },
      beats: [
        { beatId: "b2", index: 2, name: "둘" },
        { beatId: "b1", index: 1, name: "하나" },
        { beatId: "b1", index: 0, name: "중복" },
      ],
      panelPlan: [{ panelId: "p1", sceneId: "s1", framing: "클로즈업" }],
      dialogueSfx: {
        dialogues: [{ dialogueId: "d1", panelId: "p1", dialogue: "안녕" }],
        sfx: [{ sfxId: "x1", panelId: "p1", text: "쾅" }],
      },
      completedStages: ["premise", "beats", "unknown"],
    });
    expect(document.stages["episode-outline"]).toMatchObject({ title: "1화", summary: "개요" });
    expect(document.stages.beats.items.map(({ id }) => id)).toEqual(["b1", "b2"]);
    expect(document.stages["dialogue-sfx"].sfx[0]).toMatchObject({ customText: "쾅", presetId: null });
    expect(document.completion.premise).toBe(true);
    expect(document.completion.beats).toBe(true);
  });

  it("손상 JSON·미래 버전은 빈 문서로 격리하되 순환 authority는 typed fail-closed한다", () => {
    expect(normalizeStudioWriterRoomDocument("{broken")).toEqual(createEmptyStudioWriterRoomDocument());
    expect(normalizeStudioWriterRoomDocument({ version: 99, stages: {} }))
      .toEqual(createEmptyStudioWriterRoomDocument());
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => normalizeStudioWriterRoomDocument(cyclic))
      .toThrow(StudioWriterRoomAdmissionError);
  });

  it("prototype pollution과 허용 목록 밖 경로를 거부한다", () => {
    expect(isStudioWriterRoomTargetPath("stages.premise.text")).toBe(true);
    expect(isStudioWriterRoomTargetPath("stages.beats.items.beat-1.summary")).toBe(true);
    expect(isStudioWriterRoomTargetPath("stages.__proto__.polluted")).toBe(false);
    expect(isStudioWriterRoomTargetPath("stages.beats.items.constructor.summary")).toBe(false);
    expect(isStudioWriterRoomTargetPath("stages.premise.unknown")).toBe(false);
  });

  it("제안은 현재 값을 캡처하고 명시적 승인 전에는 문서를 변경하지 않는다", () => {
    const original = populatedDocument();
    const suggested = addStudioWriterRoomSuggestion(original, {
      id: "suggestion-1",
      targetPath: "stages.premise.text",
      proposedValue: "새로운 전제",
      rationale: "갈등을 선명하게",
      provenanceRef: "ai:operation-1",
      createdAt: CREATED_AT,
    });
    expect(suggested.stages.premise.text).toBe(original.stages.premise.text);
    expect(suggested.suggestions[0]).toMatchObject({
      currentValue: original.stages.premise.text,
      proposedValue: "새로운 전제",
      status: "pending",
      provenanceRef: "ai:operation-1",
    });
  });

  it("필드 제안을 승인하고 마지막 결정을 한 번만 되돌린다", () => {
    const suggested = addStudioWriterRoomSuggestion(populatedDocument(), {
      id: "suggestion-1",
      targetPath: "stages.premise.text",
      proposedValue: "새로운 전제",
      rationale: "명료화",
      createdAt: CREATED_AT,
    });
    const accepted = acceptStudioWriterRoomSuggestion(suggested, "suggestion-1", DECIDED_AT);
    expect(accepted.stages.premise.text).toBe("새로운 전제");
    expect(accepted.suggestions[0]?.status).toBe("accepted");
    const undone = undoLastStudioWriterRoomDecision(accepted);
    expect(undone.stages.premise.text).toBe(suggested.stages.premise.text);
    expect(undone.suggestions[0]?.status).toBe("pending");
    expect(undoLastStudioWriterRoomDecision(undone)).toEqual(undone);
  });

  it("거절한 제안은 값을 바꾸지 않고 동일 ID import로 되살아나지 않는다", () => {
    const suggested = addStudioWriterRoomSuggestion(populatedDocument(), {
      id: "suggestion-1",
      targetPath: "stages.premise.text",
      proposedValue: "거절할 전제",
      rationale: "테스트",
      createdAt: CREATED_AT,
    });
    const rejected = rejectStudioWriterRoomSuggestion(suggested, "suggestion-1", DECIDED_AT);
    const merged = mergeStudioWriterRoomSuggestions(rejected, [{
      id: "suggestion-1",
      targetPath: "stages.premise.text",
      proposedValue: "다시 pending",
      status: "pending",
      createdAt: "2026-07-10T00:02:00.000Z",
    }]);
    expect(merged.suggestions).toHaveLength(1);
    expect(merged.suggestions[0]?.status).toBe("rejected");
    expect(merged.stages.premise.text).toBe(rejected.stages.premise.text);
  });

  it("서로 다른 필드의 batch 승인을 원자적으로 적용한다", () => {
    let document = populatedDocument();
    document = addStudioWriterRoomSuggestion(document, {
      id: "s1",
      targetPath: "stages.episode-outline.title",
      proposedValue: "새 제목",
      rationale: "제목 개선",
      createdAt: CREATED_AT,
    });
    document = addStudioWriterRoomSuggestion(document, {
      id: "s2",
      targetPath: "stages.beats.items.beat-1.summary",
      proposedValue: "비를 피할 곳을 찾는다",
      rationale: "행동 명확화",
      createdAt: "2026-07-10T00:00:01.000Z",
    });
    const accepted = acceptStudioWriterRoomSuggestions(document, ["s1", "s2"], DECIDED_AT);
    expect(accepted.stages["episode-outline"].title).toBe("새 제목");
    expect(accepted.stages.beats.items[0]?.summary).toBe("비를 피할 곳을 찾는다");
    expect(accepted.suggestions.every(({ status }) => status === "accepted")).toBe(true);
  });

  it("한 batch에서 같은 target을 두 번 승인하지 않는다", () => {
    let document = populatedDocument();
    for (const [id, proposedValue] of [["s1", "첫 제안"], ["s2", "둘째 제안"]] as const) {
      document = addStudioWriterRoomSuggestion(document, {
        id,
        targetPath: "stages.premise.text",
        proposedValue,
        rationale: "충돌",
        createdAt: id === "s1" ? CREATED_AT : "2026-07-10T00:00:01.000Z",
      });
    }
    expect(() => acceptStudioWriterRoomSuggestions(document, ["s1", "s2"], DECIDED_AT))
      .toThrow("같은 필드");
  });

  it("제안 뒤 원문이 바뀌면 stale 승인을 막는다", () => {
    const suggested = addStudioWriterRoomSuggestion(populatedDocument(), {
      id: "s1",
      targetPath: "stages.premise.text",
      proposedValue: "제안",
      rationale: "테스트",
      createdAt: CREATED_AT,
    });
    const edited = replaceStudioWriterRoomStage(suggested, "premise", {
      text: "사용자가 직접 수정",
      characterIds: [],
    });
    expect(() => acceptStudioWriterRoomSuggestion(edited, "s1", DECIDED_AT)).toThrow("대상 값이 바뀌었어요");
  });

  it("batch 거절은 값 변경 없이 모두 해결하고 undo로 pending을 복원한다", () => {
    let document = populatedDocument();
    for (const [id, path, value] of [
      ["s1", "stages.premise.text", "A"],
      ["s2", "stages.synopsis.text", "B"],
    ] as const) {
      document = addStudioWriterRoomSuggestion(document, {
        id,
        targetPath: path,
        proposedValue: value,
        rationale: "테스트",
        createdAt: id === "s1" ? CREATED_AT : "2026-07-10T00:00:01.000Z",
      });
    }
    const rejected = rejectStudioWriterRoomSuggestions(document, ["s1", "s2"], DECIDED_AT);
    expect(rejected.suggestions.every(({ status }) => status === "rejected")).toBe(true);
    const undone = undoLastStudioWriterRoomDecision(rejected);
    expect(undone.suggestions.every(({ status }) => status === "pending")).toBe(true);
  });

  it("존재하지 않는 target, 같은 값, 잘못된 provenance 참조를 거부한다", () => {
    const document = populatedDocument();
    expect(() => addStudioWriterRoomSuggestion(document, {
      id: "s1",
      targetPath: "stages.beats.items.missing.summary",
      proposedValue: "x",
      rationale: "x",
      createdAt: CREATED_AT,
    })).toThrow("현재 Writer Room 문서에 없어요");
    expect(() => addStudioWriterRoomSuggestion(document, {
      id: "s2",
      targetPath: "stages.premise.text",
      proposedValue: document.stages.premise.text,
      rationale: "x",
      createdAt: CREATED_AT,
    })).toThrow("다른 제안 값");
    expect(() => addStudioWriterRoomSuggestion(document, {
      id: "s3",
      targetPath: "stages.premise.text",
      proposedValue: "x",
      rationale: "x",
      provenanceRef: "ai:__proto__/secret",
      createdAt: CREATED_AT,
    })).toThrow("출처 참조");
  });

  it("SFX는 기존 preset 또는 bounded custom text만 보존한다", () => {
    const presetId = SFX_LIBRARY[0]?.id;
    expect(presetId).toBeTruthy();
    const document = normalizeStudioWriterRoomDocument({
      sfx: [
        { id: "preset", panelId: "p1", presetId, style: { emphasis: "strong", scale: "large" } },
        { id: "custom", panelId: "p1", text: "두근", emphasis: "quiet", scale: "small" },
        { id: "invalid", panelId: "p1", presetId: "not-a-preset", text: "" },
      ],
    });
    const sfx = document.stages["dialogue-sfx"].sfx;
    expect(sfx).toHaveLength(2);
    expect(sfx.find(({ id }) => id === "preset")?.presetId).toBe(presetId);
    expect(sfx.find(({ id }) => id === "custom")).toMatchObject({ customText: "두근", presetId: null });
  });

  it("단계 완료와 다음 단계 진행률을 결정적으로 계산한다", () => {
    let document = populatedDocument();
    document = setStudioWriterRoomStageCompleted(document, "premise", true);
    document = setStudioWriterRoomStageCompleted(document, "synopsis", true);
    expect(computeStudioWriterRoomProgress(document)).toMatchObject({
      completedCount: 2,
      percent: 29,
      nextStage: "episode-outline",
    });
  });

  it("import suggestion은 ID 중복을 제거하고 시각·ID 순으로 정렬한다", () => {
    const document = populatedDocument();
    const merged = mergeStudioWriterRoomSuggestions(document, [
      { id: "z", path: "stages.premise.text", value: "Z", createdAt: "2026-07-10T00:00:02Z" },
      { id: "a", path: "stages.synopsis.text", value: "A", createdAt: "2026-07-10T00:00:01Z" },
      { id: "a", path: "stages.synopsis.text", value: "중복", createdAt: "2026-07-10T00:00:03Z" },
    ]);
    expect(merged.suggestions.map(({ id }) => id)).toEqual(["a", "z"]);
  });

  it("제품 count authority를 제거하고 문자열 integrity 한도만 유지한다", () => {
    const beats = Array.from({ length: 520 }, (_, index) => ({
      id: `beat-${index}`,
      order: index,
      title: "t".repeat(STUDIO_WRITER_ROOM_LIMITS.maxShortTextLength + 20),
      summary: "s",
    }));
    const document = normalizeStudioWriterRoomDocument({ beats });
    expect(document.stages.beats.items).toHaveLength(520);
    expect(document.stages.beats.items[0]?.title).toHaveLength(STUDIO_WRITER_ROOM_LIMITS.maxShortTextLength);
    expect(STUDIO_WRITER_ROOM_LIMITS).toMatchObject({
      maxStageItems: Number.POSITIVE_INFINITY,
      maxDialogues: Number.POSITIVE_INFINITY,
      maxSfx: Number.POSITIVE_INFINITY,
      maxSuggestions: Number.POSITIVE_INFINITY,
      maxCharacterRefs: Number.POSITIVE_INFINITY,
      maxReferenceIds: Number.POSITIVE_INFINITY,
      maxDecisionBatch: 100,
    });
  });

  it("byte budget 안의 1001+ 대사·효과음·제안과 128/256 초과 참조를 모두 보존한다", () => {
    const characterIds = Array.from({ length: 140 }, (_, index) => `character-${index}`);
    const beatIds = Array.from({ length: 300 }, (_, index) => `beat-${index}`);
    const dialogue = Array.from({ length: 1_005 }, (_, index) => ({
      id: `dialogue-${index}`,
      order: index,
      panelId: "panel-1",
      characterId: null,
      text: `line-${index}`,
    }));
    const sfx = Array.from({ length: 1_005 }, (_, index) => ({
      id: `sfx-${index}`,
      order: index,
      panelId: "panel-1",
      presetId: null,
      customText: `fx-${index}`,
      style: { emphasis: "normal", scale: "medium" },
    }));
    const suggestions = Array.from({ length: 1_005 }, (_, index) => ({
      id: `suggestion-${index}`,
      targetPath: "stages.premise.text",
      proposedValue: `premise-${index}`,
      rationale: "",
      status: "pending",
      createdAt: CREATED_AT,
    }));

    const document = normalizeStudioWriterRoomDocument({
      premise: { text: "current", characterIds },
      scenes: [{
        id: "scene-many-refs",
        order: 0,
        beatIds,
        heading: "refs",
        summary: "",
        location: "",
        time: "",
        characterIds,
      }],
      dialogues: dialogue,
      sfx,
      suggestions,
    });

    expect(document.stages.premise.characterIds).toHaveLength(140);
    expect(document.stages.scenes.items[0]?.beatIds).toHaveLength(300);
    expect(document.stages.scenes.items[0]?.characterIds).toHaveLength(140);
    expect(document.stages["dialogue-sfx"].dialogue).toHaveLength(1_005);
    expect(document.stages["dialogue-sfx"].sfx).toHaveLength(1_005);
    expect(document.suggestions).toHaveLength(1_005);
    expect(new TextEncoder().encode(serializeStudioWriterRoomDocument(document)).byteLength)
      .toBeLessThanOrEqual(STUDIO_WRITER_ROOM_LIMITS.maxSerializedBytes);
  });

  it("getter를 호출하지 않고 sparse·cycle 입력을 거부하며 기존 authority receipt를 유지한다", () => {
    let getterReads = 0;
    const hostile = Object.defineProperty({ version: 1 }, "stages", {
      enumerable: true,
      get() {
        getterReads += 1;
        return {};
      },
    });
    expect(() => normalizeStudioWriterRoomDocument(hostile))
      .toThrow(StudioWriterRoomAdmissionError);
    expect(getterReads).toBe(0);

    const sparse: unknown[] = [];
    sparse.length = 3;
    sparse[2] = { id: "beat-2" };
    expect(() => normalizeStudioWriterRoomDocument({ beats: sparse }))
      .toThrow(StudioWriterRoomAdmissionError);

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => normalizeStudioWriterRoomDocument(cyclic))
      .toThrow(StudioWriterRoomAdmissionError);

    const existing = populatedDocument();
    const receipt = admitStudioWriterRoomDocument(hostile, existing);
    expect(receipt).toMatchObject({
      kind: "rejected",
      reason: "unsafe-or-unbounded-input",
      document: existing,
    });
    expect(receipt.document).toBe(existing);
    expect(getterReads).toBe(0);
  });

  it("byte overflow를 빈 문서로 바꾸지 않고 typed receipt에서 기존 identity로 원자 거부한다", () => {
    const existing = populatedDocument();
    const oversizedStage = {
      items: Array.from({ length: 70 }, (_, index) => ({
        id: `large-beat-${index}`,
        order: index,
        title: "large",
        summary: "가".repeat(STUDIO_WRITER_ROOM_LIMITS.maxTextLength),
        characterIds: [],
      })),
    };
    const receipt = admitStudioWriterRoomStage(existing, "beats", oversizedStage);
    expect(receipt).toMatchObject({
      kind: "rejected",
      reason: "byte-budget-exceeded",
      document: existing,
    });
    expect(receipt.document).toBe(existing);
    expect(existing.stages.beats.items.map(({ id }) => id)).toEqual(["beat-1", "beat-2"]);

    const oversizedTolerantSource = { premise: "가".repeat(700_000) };
    expect(() => normalizeStudioWriterRoomDocument(oversizedTolerantSource))
      .toThrow(StudioWriterRoomCapacityError);
    const documentReceipt = admitStudioWriterRoomDocument(oversizedTolerantSource, existing);
    expect(documentReceipt.document).toBe(existing);
    expect(documentReceipt).toMatchObject({
      kind: "rejected",
      reason: "byte-budget-exceeded",
    });
  });

  it("decision batch 100은 문서 총량이 아니라 한 요청 backpressure로 유지한다", () => {
    const ids = Array.from({ length: STUDIO_WRITER_ROOM_LIMITS.maxDecisionBatch + 1 }, (_, index) =>
      `suggestion-${index}`
    );
    expect(() => rejectStudioWriterRoomSuggestions(populatedDocument(), ids, DECIDED_AT))
      .toThrow("한 번에 최대 100개");
  });

  it("직렬화는 결정적이고 다시 정규화해도 동일하다", () => {
    const first = serializeStudioWriterRoomDocument(populatedDocument());
    const second = serializeStudioWriterRoomDocument(first);
    expect(second).toBe(first);
    expect(normalizeStudioWriterRoomDocument(first)).toEqual(populatedDocument());
  });
});
