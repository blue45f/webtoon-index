export const STUDIO_WORK_TITLE_MAX_LENGTH = 120;
export const STUDIO_WORK_DESCRIPTION_MAX_LENGTH = 2_000;
export const STUDIO_WORK_TAG_MAX_COUNT = 8;
export const STUDIO_WORK_TAG_MAX_LENGTH = 24;

export const STUDIO_WORK_TITLE_REQUIRED_ERROR = "작품 제목을 입력해 주세요.";
const STUDIO_WORK_TITLE_MAX_LENGTH_ERROR =
  `작품 제목은 ${STUDIO_WORK_TITLE_MAX_LENGTH}자 이하로 입력해 주세요.`;
const STUDIO_WORK_DESCRIPTION_MAX_LENGTH_ERROR =
  `게시용 설명은 ${STUDIO_WORK_DESCRIPTION_MAX_LENGTH.toLocaleString("ko-KR")}자 이하로 입력해 주세요.`;
const STUDIO_WORK_TAG_MAX_COUNT_ERROR =
  `게시용 태그는 최대 ${STUDIO_WORK_TAG_MAX_COUNT}개까지 입력할 수 있어요.`;
const STUDIO_WORK_TAG_MAX_LENGTH_ERROR =
  `게시용 태그는 하나당 ${STUDIO_WORK_TAG_MAX_LENGTH}자 이하로 입력해 주세요.`;

const STUDIO_WORK_METADATA_VALIDATION_ERRORS = new Set([
  STUDIO_WORK_TITLE_REQUIRED_ERROR,
  STUDIO_WORK_TITLE_MAX_LENGTH_ERROR,
  STUDIO_WORK_DESCRIPTION_MAX_LENGTH_ERROR,
  STUDIO_WORK_TAG_MAX_COUNT_ERROR,
  STUDIO_WORK_TAG_MAX_LENGTH_ERROR,
]);

/** Clears only errors produced by the local metadata validator; runtime/API errors must survive edits. */
export function clearStudioWorkMetadataValidationError(current: string | null): string | null {
  return current !== null && STUDIO_WORK_METADATA_VALIDATION_ERRORS.has(current)
    ? null
    : current;
}

export function parseStudioWorkTagTokens(tagsText: string): string[] {
  return tagsText
    .split(/[,\s]+/u)
    .map((tag) => tag.trim().replace(/^#/u, ""))
    .filter(Boolean);
}

/**
 * Studio의 직접 저장·공동 저장이 공유하는 API 메타데이터 한계를 캡처 전에 확인한다.
 * 입력 UI의 maxLength만 믿으면 가져온 프로젝트나 공동 편집 수화 값이 서버에서 뒤늦게
 * 거절될 수 있고, 태그 수를 조용히 잘라내면 사용자가 작성한 정보가 사라진다.
 */
export function validateStudioWorkMetadata(input: Readonly<{
  title: string;
  description: string;
  tagsText: string;
}>): string | null {
  if (!input.title.trim()) return STUDIO_WORK_TITLE_REQUIRED_ERROR;
  if (input.title.length > STUDIO_WORK_TITLE_MAX_LENGTH) {
    return STUDIO_WORK_TITLE_MAX_LENGTH_ERROR;
  }
  if (input.description.length > STUDIO_WORK_DESCRIPTION_MAX_LENGTH) {
    return STUDIO_WORK_DESCRIPTION_MAX_LENGTH_ERROR;
  }

  const tags = parseStudioWorkTagTokens(input.tagsText);
  if (tags.length > STUDIO_WORK_TAG_MAX_COUNT) {
    return STUDIO_WORK_TAG_MAX_COUNT_ERROR;
  }
  if (tags.some((tag) => tag.length > STUDIO_WORK_TAG_MAX_LENGTH)) {
    return STUDIO_WORK_TAG_MAX_LENGTH_ERROR;
  }
  return null;
}
