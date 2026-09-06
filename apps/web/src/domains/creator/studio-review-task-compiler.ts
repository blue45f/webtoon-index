import type { StudioCommentAnchor } from "./studio-comments";

export type StudioReviewTaskKind =
  | "lettering"
  | "continuity"
  | "perspective-3d"
  | "art-color"
  | "rights"
  | "general";

export type StudioReviewTaskPriority = "urgent" | "high" | "normal" | "low";

export interface StudioReviewTaskSource {
  readonly body: string;
  readonly replies: readonly { readonly body: string }[];
  readonly anchor: StudioCommentAnchor;
}

export interface StudioReviewTaskSuggestion {
  readonly kind: StudioReviewTaskKind;
  readonly kindLabel: string;
  readonly priority: StudioReviewTaskPriority;
  readonly priorityLabel: string;
  readonly title: string;
  readonly targetScope: string;
  readonly matchedSignals: readonly string[];
  readonly rationale: readonly string[];
  readonly completionChecklist: readonly string[];
}

interface WeightedSignal {
  readonly term: string;
  readonly weight: number;
}

interface TaskKindDefinition {
  readonly label: string;
  readonly title: string;
  readonly signals: readonly WeightedSignal[];
  readonly completionChecklist: readonly string[];
}

const KIND_ORDER: readonly Exclude<StudioReviewTaskKind, "general">[] = [
  "rights",
  "lettering",
  "continuity",
  "perspective-3d",
  "art-color",
];

const KIND_DEFINITIONS: Readonly<Record<StudioReviewTaskKind, TaskKindDefinition>> = {
  lettering: {
    label: "식자",
    title: "식자와 대사 표현 점검",
    signals: [
      { term: "식자", weight: 4 },
      { term: "오탈자", weight: 4 },
      { term: "맞춤법", weight: 4 },
      { term: "말풍선", weight: 3 },
      { term: "대사", weight: 2 },
      { term: "글꼴", weight: 3 },
      { term: "폰트", weight: 2 },
      { term: "자간", weight: 3 },
      { term: "행간", weight: 3 },
      { term: "줄바꿈", weight: 3 },
      { term: "텍스트", weight: 2 },
      { term: "효과음", weight: 3 },
      { term: "의성어", weight: 3 },
      { term: "의태어", weight: 3 },
      { term: "번역", weight: 2 },
      { term: "자막", weight: 2 },
    ],
    completionChecklist: [
      "대사·효과음의 오탈자와 맞춤법이 교정되어 있습니다.",
      "말풍선 안에서 글자가 잘리지 않고 읽기 순서가 자연스럽습니다.",
      "모바일 축소 미리보기에서도 글자 크기와 대비가 충분합니다.",
    ],
  },
  continuity: {
    label: "연속성",
    title: "장면과 캐릭터 연속성 점검",
    signals: [
      { term: "연속성", weight: 4 },
      { term: "설정 충돌", weight: 4 },
      { term: "설정 오류", weight: 4 },
      { term: "캐릭터 일관", weight: 4 },
      { term: "앞 컷", weight: 3 },
      { term: "이전 컷", weight: 3 },
      { term: "다음 컷", weight: 3 },
      { term: "장면 연결", weight: 3 },
      { term: "의상", weight: 2 },
      { term: "머리색", weight: 3 },
      { term: "눈 색", weight: 3 },
      { term: "소품 위치", weight: 3 },
      { term: "좌우 반전", weight: 2 },
      { term: "시간대", weight: 2 },
      { term: "동선", weight: 2 },
      { term: "회상", weight: 2 },
      { term: "복선", weight: 2 },
    ],
    completionChecklist: [
      "지적된 설정을 앞뒤 컷과 기준 캐릭터 시트에 대조했습니다.",
      "인물·의상·소품·시선·시간 흐름의 불일치를 수정했습니다.",
      "앞뒤 컷을 이어 본 미리보기에서 장면 전환이 자연스럽습니다.",
    ],
  },
  "perspective-3d": {
    label: "3D·원근",
    title: "3D와 원근 구성 보정",
    signals: [
      { term: "3d", weight: 4 },
      { term: "원근", weight: 4 },
      { term: "투시", weight: 4 },
      { term: "소실점", weight: 4 },
      { term: "vrm", weight: 4 },
      { term: "ik 타깃", weight: 3 },
      { term: "역운동학", weight: 3 },
      { term: "카메라", weight: 2 },
      { term: "렌즈", weight: 3 },
      { term: "포즈", weight: 2 },
      { term: "관절", weight: 3 },
      { term: "배경 각도", weight: 3 },
      { term: "지평선", weight: 3 },
      { term: "오브젝트", weight: 2 },
      { term: "모델 배치", weight: 3 },
      { term: "그림자 방향", weight: 2 },
    ],
    completionChecklist: [
      "카메라·지평선·소실점과 오브젝트 스케일이 같은 공간 규칙을 따릅니다.",
      "3D 참고선과 최종 선화 사이의 관통·접지·포즈 어긋남이 없습니다.",
      "실제 세로 스크롤 미리보기에서 원근과 시선 유도가 자연스럽습니다.",
    ],
  },
  "art-color": {
    label: "채색·작화",
    title: "채색과 작화 품질 보정",
    signals: [
      { term: "채색", weight: 4 },
      { term: "작화", weight: 4 },
      { term: "선화", weight: 4 },
      { term: "밑색", weight: 3 },
      { term: "셀 채색", weight: 3 },
      { term: "색감", weight: 3 },
      { term: "명암", weight: 3 },
      { term: "광원", weight: 3 },
      { term: "하이라이트", weight: 2 },
      { term: "스크린톤", weight: 3 },
      { term: "브러시", weight: 2 },
      { term: "클리핑", weight: 2 },
      { term: "마스크", weight: 2 },
      { term: "해상도", weight: 2 },
      { term: "픽셀", weight: 2 },
      { term: "선 정리", weight: 3 },
      { term: "얼굴 비율", weight: 3 },
      { term: "손 모양", weight: 3 },
      { term: "인체", weight: 2 },
    ],
    completionChecklist: [
      "지적된 선화·밑색·명암·광원 경계를 의도에 맞게 수정했습니다.",
      "100% 배율과 축소 미리보기 모두에서 실루엣과 색 대비가 안정적입니다.",
      "클리핑·마스크 경계와 투명 픽셀에 눈에 띄는 아티팩트가 없습니다.",
    ],
  },
  rights: {
    label: "권리",
    title: "권리와 사용 허가 확인",
    signals: [
      { term: "저작권", weight: 5 },
      { term: "초상권", weight: 5 },
      { term: "상표권", weight: 5 },
      { term: "라이선스", weight: 5 },
      { term: "라이센스", weight: 5 },
      { term: "사용 허가", weight: 4 },
      { term: "무단 사용", weight: 5 },
      { term: "권리 침해", weight: 5 },
      { term: "표절", weight: 5 },
      { term: "상업 이용", weight: 4 },
      { term: "2차 저작", weight: 4 },
      { term: "출처", weight: 2 },
      { term: "워터마크", weight: 3 },
      { term: "계약 범위", weight: 4 },
      { term: "폰트 사용권", weight: 5 },
      { term: "에셋 사용권", weight: 5 },
    ],
    completionChecklist: [
      "사용한 이미지·폰트·3D 모델·에셋의 출처와 권리자를 확인했습니다.",
      "상업 이용·수정·재배포 범위가 현재 게시 방식에 적합합니다.",
      "불확실한 소재는 게시 전에 교체하거나 제거했습니다.",
      "확인한 허가 근거를 프로젝트 메모나 팀 기록에 남겼습니다.",
    ],
  },
  general: {
    label: "일반",
    title: "댓글 피드백 검토",
    signals: [],
    completionChecklist: [
      "댓글 본문과 답글에서 필수 수정과 선택 제안을 구분했습니다.",
      "댓글이 가리키는 범위 안에서 필요한 변경을 반영했습니다.",
      "수정 전후를 비교해 지적된 문제가 더 이상 재현되지 않습니다.",
    ],
  },
};

const PRIORITY_LABELS: Readonly<Record<StudioReviewTaskPriority, string>> = {
  urgent: "긴급",
  high: "높음",
  normal: "보통",
  low: "낮음",
};

const URGENT_SIGNALS = [
  "긴급",
  "즉시",
  "오늘 마감",
  "업로드 전",
  "게시 전",
  "배포 전",
  "출고 전",
  "법적",
  "권리 침해",
  "삭제 요청",
] as const;

const HIGH_SIGNALS = [
  "진행 불가",
  "작업 불가",
  "깨짐",
  "누락",
  "오류",
  "버그",
  "반드시",
  "꼭 수정",
  "수정 필요",
  "심각",
] as const;

const LOW_SIGNALS = [
  "참고",
  "선택 사항",
  "여유되면",
  "나중에",
  "사소",
  "제안",
] as const;

function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

function safeScopeLabel(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  return normalized ? Array.from(normalized).slice(0, 120).join("") : null;
}

function fallbackScope(anchor: StudioCommentAnchor): string {
  if (anchor.type === "page") return "댓글이 연결된 페이지 전체";
  if (anchor.type === "frame") return "댓글이 연결된 컷";
  if (anchor.type === "element") return "댓글이 연결된 요소";
  return "댓글 핀 주변";
}

function anchorEvidence(anchor: StudioCommentAnchor): string {
  if (anchor.type === "page") return "페이지 앵커를 기준으로 페이지 전체를 대상 범위로 잡았습니다.";
  if (anchor.type === "frame") return "컷 앵커를 기준으로 해당 컷을 대상 범위로 잡았습니다.";
  if (anchor.type === "element") return "요소 앵커를 기준으로 선택 요소를 대상 범위로 잡았습니다.";
  return "자유 위치 핀을 기준으로 핀 주변을 대상 범위로 잡았습니다.";
}

function matchedTerms(texts: readonly string[], signals: readonly WeightedSignal[]): string[] {
  return signals
    .filter(({ term }) => texts.some((text) => text.includes(term)))
    .map(({ term }) => term);
}

function signalScore(texts: readonly string[], signals: readonly WeightedSignal[]): number {
  return signals.reduce(
    (score, signal) =>
      texts.some((text) => text.includes(signal.term)) ? score + signal.weight : score,
    0
  );
}

function selectKind(texts: readonly string[]): StudioReviewTaskKind {
  const rightsScore = signalScore(texts, KIND_DEFINITIONS.rights.signals);
  if (rightsScore > 0) return "rights";

  let selected: StudioReviewTaskKind = "general";
  let selectedScore = 0;
  for (const kind of KIND_ORDER) {
    if (kind === "rights") continue;
    const score = signalScore(texts, KIND_DEFINITIONS[kind].signals);
    if (score > selectedScore) {
      selected = kind;
      selectedScore = score;
    }
  }
  return selected;
}

function includesAny(texts: readonly string[], signals: readonly string[]): string[] {
  return signals.filter((signal) => texts.some((text) => text.includes(signal)));
}

function selectPriority(
  texts: readonly string[],
  kind: StudioReviewTaskKind
): {
  priority: StudioReviewTaskPriority;
  evidence: string;
} {
  const urgentSignals = includesAny(texts, URGENT_SIGNALS);
  if (urgentSignals.length > 0) {
    return {
      priority: "urgent",
      evidence: `마감·위험 신호(${urgentSignals.slice(0, 3).join(", ")})가 있어 긴급으로 제안했습니다.`,
    };
  }

  const highSignals = includesAny(texts, HIGH_SIGNALS);
  if (kind === "rights") {
    return {
      priority: "high",
      evidence: "권리 확인은 게시 가능성에 직접 영향을 주므로 높은 우선순위로 제안했습니다.",
    };
  }
  if (highSignals.length > 0) {
    return {
      priority: "high",
      evidence: `차단·결함 신호(${highSignals.slice(0, 3).join(", ")})가 있어 높음으로 제안했습니다.`,
    };
  }

  const lowSignals = includesAny(texts, LOW_SIGNALS);
  if (lowSignals.length > 0) {
    return {
      priority: "low",
      evidence: `선택 제안 신호(${lowSignals.slice(0, 3).join(", ")})가 있어 낮음으로 제안했습니다.`,
    };
  }
  return {
    priority: "normal",
    evidence: "명시적인 마감·차단 신호가 없어 보통 우선순위로 제안했습니다.",
  };
}

/**
 * Compiles one comment thread into a local-only task suggestion.
 *
 * No model, clock, randomness, storage, or network is consulted. The same normalized thread and
 * anchor label always produce the same suggestion, so the result remains cheap, testable, and
 * safe to derive during comment-card rendering.
 */
export function compileStudioReviewTask(
  source: StudioReviewTaskSource,
  options: { readonly anchorLabel?: string } = {}
): StudioReviewTaskSuggestion {
  const threadText = normalizeText(source.body);
  const replyTexts = source.replies.map((reply) => normalizeText(reply.body));
  const texts = [threadText, ...replyTexts];
  const kind = selectKind(texts);
  const definition = KIND_DEFINITIONS[kind];
  const signals = matchedTerms(texts, definition.signals);
  const mainSignals = matchedTerms([threadText], definition.signals);
  const replySignals = matchedTerms(replyTexts, definition.signals);
  const sourceLabel =
    mainSignals.length > 0 && replySignals.length > 0
      ? "본문과 답글"
      : replySignals.length > 0
        ? "답글"
        : "본문";
  const priority = selectPriority(texts, kind);
  const targetScope = safeScopeLabel(options.anchorLabel) ?? fallbackScope(source.anchor);
  const categoryEvidence =
    kind === "general"
      ? "전문 작업 신호가 명확하지 않아 일반 검토 작업으로 제안했습니다."
      : `${sourceLabel}에서 ${definition.label} 관련 표현(${signals.slice(0, 5).join(", ")})을 확인했습니다.`;

  return {
    kind,
    kindLabel: definition.label,
    priority: priority.priority,
    priorityLabel: PRIORITY_LABELS[priority.priority],
    title: definition.title,
    targetScope,
    matchedSignals: signals.slice(0, 8),
    rationale: [categoryEvidence, priority.evidence, anchorEvidence(source.anchor)],
    completionChecklist: definition.completionChecklist,
  };
}
