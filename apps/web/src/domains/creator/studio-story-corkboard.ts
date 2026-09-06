/**
 * Studio Linked Story Corkboard — 시즌·회차·장면·비트 카드를 실제 원고 컷·샷과
 * 연결하는 스토리보드 기획 코어.
 *
 * 마스터플랜 9.1 (Linked Story Corkboard) & 41개 경쟁제품 기능 갭 전수 비교:
 * - 시즌·회차·장면·비트 카드 계층 구조
 * - Fractional Indexing 기반 O(1) 카드 순서 재정렬
 * - 카드별 목적, 감정 톤, 등장인물(Cast), 장소(Location), 갈등·결과 정의
 * - 실제 컷(Panel) 및 샷(Shot) 바인딩 및 원고 순서 투영
 * - 카드에서 제작 관리 Task 자동 파생
 * - 순수 함수, 불변성, 결정론적 구조, DOM/React 무관
 */

export const STUDIO_STORY_CORKBOARD_VERSION = 1 as const;

export const STUDIO_STORY_CORKBOARD_LIMITS = Object.freeze({
  maxCards: 2_048,
  maxBeatsPerScene: 64,
  maxCastPerCard: 32,
  maxPanelsPerCard: 128,
  maxShotsPerCard: 128,
  maxTasksPerCard: 32,
  maxIdLength: 128,
  maxTitleLength: 200,
  maxTextLength: 2_000,
  maxDiagnostics: 256,
});

export const STORY_CARD_KINDS = ["season", "episode", "scene", "beat"] as const;
export type StoryCardKind = (typeof STORY_CARD_KINDS)[number];

export const STORY_CARD_STATUSES = [
  "draft",
  "in-progress",
  "review",
  "approved",
  "omitted",
] as const;
export type StoryCardStatus = (typeof STORY_CARD_STATUSES)[number];

export const STORY_EMOTIONAL_TONES = [
  "neutral",
  "tense",
  "joyful",
  "melancholic",
  "furious",
  "fearful",
  "romantic",
  "mysterious",
  "triumphant",
  "comical",
] as const;
export type StoryEmotionalTone = (typeof STORY_EMOTIONAL_TONES)[number];

export interface StoryCard {
  readonly id: string;
  readonly kind: StoryCardKind;
  readonly parentId?: string;
  readonly title: string;
  readonly synopsis?: string;
  readonly purpose?: string;
  readonly emotionalTone?: StoryEmotionalTone;
  readonly castMemberIds?: readonly string[];
  readonly locationRef?: string;
  readonly orderKey: string;
  readonly boundPanelIds?: readonly string[];
  readonly boundShotIds?: readonly string[];
  readonly goal?: string;
  readonly conflict?: string;
  readonly outcome?: string;
  readonly status: StoryCardStatus;
  readonly taskIds?: readonly string[];
  readonly estimatedMinutes?: number;
}

export interface StudioStoryCorkboard {
  readonly version: typeof STUDIO_STORY_CORKBOARD_VERSION;
  readonly id: string;
  readonly title: string;
  readonly cards: readonly StoryCard[];
}

export interface StoryCorkboardDiagnostic {
  readonly code:
    | "DUPLICATE_CARD_ID"
    | "DANGLING_PARENT"
    | "CIRCULAR_PARENT"
    | "INVALID_ORDER_KEY"
    | "LIMIT_EXCEEDED"
    | "EMPTY_TITLE";
  readonly message: string;
  readonly cardId?: string;
}

/**
 * Fractional index 생성 유틸: 두 키 사이의 사전식 순서 키를 계산한다.
 */
export function fractionalIndexBetween(
  before?: string | null,
  after?: string | null,
): string {
  const b = before ?? "";
  const a = after ?? "";

  if (!b && !a) return "n";
  if (!b && a) {
    const firstChar = a.charCodeAt(0);
    if (firstChar > 97) {
      return String.fromCharCode(Math.floor((97 + firstChar) / 2));
    }
    return `a${fractionalIndexBetween(null, a.slice(1))}`;
  }
  if (b && !a) {
    const lastChar = b.charCodeAt(b.length - 1);
    if (lastChar < 122) {
      return `${b.slice(0, -1)}${String.fromCharCode(Math.floor((lastChar + 122) / 2))}`;
    }
    return `${b}n`;
  }

  // Both b and a exist
  if (b >= a) {
    return `${b}n`;
  }

  let i = 0;
  while (i < b.length && i < a.length && b[i] === a[i]) {
    i += 1;
  }

  const prefix = b.slice(0, i);
  const charB = i < b.length ? b.charCodeAt(i) : 96; // 'a' - 1
  const charA = i < a.length ? a.charCodeAt(i) : 123; // 'z' + 1

  if (charA - charB > 1) {
    return `${prefix}${String.fromCharCode(Math.floor((charB + charA) / 2))}`;
  }

  return `${prefix}${String.fromCharCode(charB)}${fractionalIndexBetween(
    i < b.length ? b.slice(i + 1) : null,
    null,
  )}`;
}

export function createStudioStoryCorkboard(params: {
  id: string;
  title: string;
  cards?: readonly StoryCard[];
}): StudioStoryCorkboard {
  return Object.freeze({
    version: STUDIO_STORY_CORKBOARD_VERSION,
    id: params.id.trim(),
    title: params.title.trim(),
    cards: Object.freeze([...(params.cards ?? [])]),
  });
}

export function validateStoryCorkboard(
  board: StudioStoryCorkboard,
): readonly StoryCorkboardDiagnostic[] {
  const diagnostics: StoryCorkboardDiagnostic[] = [];
  const cardIds = new Set<string>();
  const cardMap = new Map<string, StoryCard>();

  if (board.cards.length > STUDIO_STORY_CORKBOARD_LIMITS.maxCards) {
    diagnostics.push({
      code: "LIMIT_EXCEEDED",
      message: `Card count (${board.cards.length}) exceeds maximum ${STUDIO_STORY_CORKBOARD_LIMITS.maxCards}`,
    });
  }

  for (const card of board.cards) {
    if (!card.title.trim()) {
      diagnostics.push({
        code: "EMPTY_TITLE",
        message: "Card title cannot be empty",
        cardId: card.id,
      });
    }
    if (cardIds.has(card.id)) {
      diagnostics.push({
        code: "DUPLICATE_CARD_ID",
        message: `Duplicate card id: ${card.id}`,
        cardId: card.id,
      });
    }
    cardIds.add(card.id);
    cardMap.set(card.id, card);
  }

  // Parent validity & hierarchy cycles
  for (const card of board.cards) {
    if (card.parentId) {
      if (!cardMap.has(card.parentId)) {
        diagnostics.push({
          code: "DANGLING_PARENT",
          message: `Parent card ${card.parentId} not found`,
          cardId: card.id,
        });
      } else {
        // Cycle check
        const visited = new Set<string>([card.id]);
        let curr: string | undefined = card.parentId;
        while (curr) {
          if (visited.has(curr)) {
            diagnostics.push({
              code: "CIRCULAR_PARENT",
              message: `Circular parent relationship detected at card ${card.id}`,
              cardId: card.id,
            });
            break;
          }
          visited.add(curr);
          curr = cardMap.get(curr)?.parentId;
        }
      }
    }
  }

  return Object.freeze(diagnostics);
}

export function addStoryCard(
  board: StudioStoryCorkboard,
  card: StoryCard,
): StudioStoryCorkboard {
  const existing = board.cards.find((c) => c.id === card.id);
  if (existing) {
    throw new Error(`Card id ${card.id} already exists`);
  }
  const nextCards = [...board.cards, card].sort((a, b) =>
    a.orderKey.localeCompare(b.orderKey),
  );
  return { ...board, cards: Object.freeze(nextCards) };
}

export function updateStoryCard(
  board: StudioStoryCorkboard,
  cardId: string,
  patch: Partial<Omit<StoryCard, "id">>,
): StudioStoryCorkboard {
  const index = board.cards.findIndex((c) => c.id === cardId);
  if (index === -1) {
    throw new Error(`Card ${cardId} not found`);
  }
  const updated: StoryCard = { ...board.cards[index], ...patch };
  const nextCards = [...board.cards];
  nextCards[index] = updated;
  nextCards.sort((a, b) => a.orderKey.localeCompare(b.orderKey));
  return { ...board, cards: Object.freeze(nextCards) };
}

export function removeStoryCard(
  board: StudioStoryCorkboard,
  cardId: string,
): StudioStoryCorkboard {
  const nextCards = board.cards.filter((c) => c.id !== cardId && c.parentId !== cardId);
  return { ...board, cards: Object.freeze(nextCards) };
}

export function reorderStoryCard(
  board: StudioStoryCorkboard,
  cardId: string,
  targetBeforeId?: string | null,
  targetAfterId?: string | null,
): StudioStoryCorkboard {
  const beforeCard = targetBeforeId
    ? board.cards.find((c) => c.id === targetBeforeId)
    : null;
  const afterCard = targetAfterId
    ? board.cards.find((c) => c.id === targetAfterId)
    : null;

  const newOrderKey = fractionalIndexBetween(
    beforeCard?.orderKey,
    afterCard?.orderKey,
  );

  return updateStoryCard(board, cardId, { orderKey: newOrderKey });
}

export interface CorkboardPanelProjection {
  readonly cardId: string;
  readonly cardTitle: string;
  readonly kind: StoryCardKind;
  readonly emotionalTone: StoryEmotionalTone;
  readonly panelIds: readonly string[];
  readonly shotIds: readonly string[];
}

/**
 * 코르크보드 순서에 따라 정렬된 컷(Panel) 및 샷(Shot) 순서를 투영한다.
 */
export function projectCorkboardToPanelSequence(
  board: StudioStoryCorkboard,
): readonly CorkboardPanelProjection[] {
  const sorted = [...board.cards].sort((a, b) =>
    a.orderKey.localeCompare(b.orderKey),
  );
  return Object.freeze(
    sorted.map((card) =>
      Object.freeze({
        cardId: card.id,
        cardTitle: card.title,
        kind: card.kind,
        emotionalTone: card.emotionalTone ?? "neutral",
        panelIds: Object.freeze([...(card.boundPanelIds ?? [])]),
        shotIds: Object.freeze([...(card.boundShotIds ?? [])]),
      }),
    ),
  );
}

export interface DerivedStoryTask {
  readonly id: string;
  readonly cardId: string;
  readonly title: string;
  readonly kind: StoryCardKind;
  readonly status: StoryCardStatus;
  readonly estimatedMinutes: number;
}

/**
 * 코르크보드 카드에서 제작 Task 목록을 파생한다.
 */
export function generateTasksFromCorkboard(
  board: StudioStoryCorkboard,
): readonly DerivedStoryTask[] {
  return Object.freeze(
    board.cards.map((card) =>
      Object.freeze({
        id: `task:corkboard:${card.id}`,
        cardId: card.id,
        title: `[${card.kind.toUpperCase()}] ${card.title}`,
        kind: card.kind,
        status: card.status,
        estimatedMinutes: card.estimatedMinutes ?? 60,
      }),
    ),
  );
}
