import { z } from "zod";

import {
  STUDIO_WRITER_ROOM_LIMITS,
  StudioWriterRoomBeatSchema,
  StudioWriterRoomDialogueSchema,
  StudioWriterRoomEpisodeOutlineSchema,
  StudioWriterRoomPanelSchema,
  StudioWriterRoomPremiseSchema,
  StudioWriterRoomSceneSchema,
  StudioWriterRoomSfxSchema,
  StudioWriterRoomSynopsisSchema,
  normalizeStudioWriterRoomDocument,
  type StudioWriterRoomDocument,
  type StudioWriterRoomStage,
  type StudioWriterRoomStages,
} from "./studio-writer-room";

const MAX_AI_SOURCE_LENGTH = 48_000;
const MAX_CONTEXT_LENGTH = 10_000;

const StageDraftSchemas = {
  premise: StudioWriterRoomPremiseSchema,
  synopsis: StudioWriterRoomSynopsisSchema,
  "episode-outline": StudioWriterRoomEpisodeOutlineSchema,
  beats: z.object({ items: z.array(StudioWriterRoomBeatSchema).max(80) }).strict(),
  scenes: z.object({ items: z.array(StudioWriterRoomSceneSchema).max(80) }).strict(),
  "panel-plan": z.object({ items: z.array(StudioWriterRoomPanelSchema).max(120) }).strict(),
  "dialogue-sfx": z
    .object({
      dialogue: z.array(StudioWriterRoomDialogueSchema).max(240),
      sfx: z.array(StudioWriterRoomSfxSchema).max(240),
    })
    .strict(),
} satisfies { [Stage in StudioWriterRoomStage]: z.ZodType<StudioWriterRoomStages[Stage]> };

const STAGE_GUIDANCE: Record<StudioWriterRoomStage, string> = {
  premise:
    "한 문장 핵심 전제와 중심 갈등을 명확히 하세요. draft는 {text, characterIds}입니다.",
  synopsis:
    "시작·전환·절정·결말 방향이 드러나는 압축 시놉시스를 쓰세요. draft는 {text, characterIds}입니다.",
  "episode-outline":
    "이번 화의 제목과 독자가 다음 화를 누르게 만드는 에피소드 요약을 만드세요. draft는 {title, summary, characterIds}입니다.",
  beats:
    "감정과 정보가 실제로 변하는 비트 목록을 순서대로 만드세요. draft는 {items:[{id,order,title,summary,characterIds}]}입니다.",
  scenes:
    "비트를 촬영 가능한 장소·시간 단위 장면으로 나누세요. draft는 {items:[{id,order,beatIds,heading,summary,location,time,characterIds}]}입니다.",
  "panel-plan":
    "세로 스크롤 리듬, 숏 크기, 시선 흐름을 고려해 패널 계획을 만드세요. draft는 {items:[{id,order,sceneId,shot,action,characterIds}]}입니다.",
  "dialogue-sfx":
    "설명 과잉을 줄이고 캐릭터 말투를 구분하며, 필요한 효과음만 배치하세요. draft는 {dialogue:[{id,order,panelId,characterId,text}],sfx:[{id,order,panelId,presetId,customText,style:{emphasis,scale}}]}입니다.",
};

const WriterRoomAiEnvelopeSchema = z
  .object({
    stage: z.enum([
      "premise",
      "synopsis",
      "episode-outline",
      "beats",
      "scenes",
      "panel-plan",
      "dialogue-sfx",
    ]),
    rationale: z.string().trim().min(1).max(STUDIO_WRITER_ROOM_LIMITS.maxRationaleLength),
    draft: z.unknown(),
  })
  .strict();

export interface StudioWriterRoomAiPrompt {
  system: string;
  user: string;
}

export type StudioWriterRoomAiDraft = {
  [Stage in StudioWriterRoomStage]: {
    stage: Stage;
    rationale: string;
    draft: StudioWriterRoomStages[Stage];
  };
}[StudioWriterRoomStage];

type StudioWriterRoomAiDraftFor<Stage extends StudioWriterRoomStage> = Extract<
  StudioWriterRoomAiDraft,
  { stage: Stage }
>;

export type StudioWriterRoomAiParseResult<
  Stage extends StudioWriterRoomStage = StudioWriterRoomStage,
> =
  | { ok: true; data: StudioWriterRoomAiDraftFor<Stage> }
  | { ok: false; error: string };

function safeJson(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);
    return serialized.length <= MAX_CONTEXT_LENGTH
      ? serialized
      : `${serialized.slice(0, MAX_CONTEXT_LENGTH)}…`;
  } catch {
    return "{}";
  }
}

function stripMarkdownFence(value: string): string {
  const trimmed = value.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed);
  return (fenced?.[1] ?? trimmed).trim();
}

function stageReferences(document: StudioWriterRoomDocument, stage: StudioWriterRoomStage): unknown {
  if (stage === "premise") return {};
  if (stage === "synopsis") return { premise: document.stages.premise };
  if (stage === "episode-outline") {
    return { premise: document.stages.premise, synopsis: document.stages.synopsis };
  }
  if (stage === "beats") return { episodeOutline: document.stages["episode-outline"] };
  if (stage === "scenes") return { beats: document.stages.beats };
  if (stage === "panel-plan") return { scenes: document.stages.scenes };
  return { panels: document.stages["panel-plan"] };
}

export function buildStudioWriterRoomAiPrompt(input: {
  stage: StudioWriterRoomStage;
  document: unknown;
  characterContext?: string;
  direction?: string;
}): StudioWriterRoomAiPrompt {
  const document = normalizeStudioWriterRoomDocument(input.document);
  const stage = input.stage;
  const characterContext = (input.characterContext ?? "").trim().slice(0, 4_000);
  const direction = (input.direction ?? "").trim().slice(0, 2_000);
  const system = [
    "당신은 한국 세로 스크롤 웹툰의 전문 스토리 에디터입니다.",
    "응답은 JSON 객체 하나만 반환하세요. 마크다운, 설명문, 코드 펜스를 쓰지 마세요.",
    `반드시 {"stage":"${stage}","rationale":"검토 근거","draft":...} 형식을 사용하세요.`,
    STAGE_GUIDANCE[stage],
    "현재 초안을 직접 수정하지 않습니다. 사용자가 비교 검토 후 명시적으로 승인할 후보 초안만 만드세요.",
    "기존 item id와 참조 id는 가능하면 보존하고, 새 id는 영문·숫자·하이픈만 사용하세요.",
    "characterIds에는 제공된 캐릭터 ID만, beatIds/sceneId/panelId에는 제공된 문서 ID만 사용하세요.",
    "사실처럼 단정할 외부 정보나 저작권 캐릭터를 새로 만들지 마세요.",
  ].join("\n");
  const user = [
    `대상 단계: ${stage}`,
    `현재 단계 JSON: ${safeJson(document.stages[stage])}`,
    `이전 단계 참조 JSON: ${safeJson(stageReferences(document, stage))}`,
    characterContext ? `캐릭터 바이블(사용자 제공):\n${characterContext}` : "캐릭터 바이블: 없음",
    direction ? `작가의 추가 지시:\n${direction}` : "작가의 추가 지시: 없음",
    "위 조건을 만족하는 개선 후보 초안 JSON을 반환하세요.",
  ].join("\n\n");
  return { system, user };
}

export function parseStudioWriterRoomAiDraft<Stage extends StudioWriterRoomStage>(
  source: string,
  expectedStage: Stage
): StudioWriterRoomAiParseResult<Stage> {
  if (typeof source !== "string" || source.length === 0 || source.length > MAX_AI_SOURCE_LENGTH) {
    return { ok: false, error: "AI 초안 응답의 크기가 올바르지 않아요." };
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(stripMarkdownFence(source));
  } catch {
    return { ok: false, error: "AI 초안을 JSON으로 해석하지 못했어요." };
  }
  const envelope = WriterRoomAiEnvelopeSchema.safeParse(decoded);
  if (!envelope.success) {
    return { ok: false, error: "AI 초안의 필수 필드가 올바르지 않아요." };
  }
  if (envelope.data.stage !== expectedStage) {
    return { ok: false, error: "AI가 요청한 단계와 다른 초안을 반환했어요." };
  }
  const schema = StageDraftSchemas[expectedStage] as unknown as z.ZodType<
    StudioWriterRoomAiDraftFor<Stage>["draft"]
  >;
  const draft = schema.safeParse(envelope.data.draft);
  if (!draft.success) {
    return { ok: false, error: "AI 초안의 단계 구조나 참조 형식이 올바르지 않아요." };
  }
  return {
    ok: true,
    data: {
      stage: expectedStage,
      rationale: envelope.data.rationale,
      draft: draft.data,
    } as StudioWriterRoomAiDraftFor<Stage>,
  };
}
