/**
 * Studio Panel Shot Tags — 컷(페이지)에 실을 수 있는 샷 타입(화면 크기)·카메라 앵글(시점) 태그의
 * 순수 로직. 콘티/스토리보드 검토 시 "이 컷이 어떤 샷/앵글인지" 한눈에 훑을 수 있게 하는
 * 메타데이터로, studio-page-meta.ts 의 {name, note} 페이지 메타와 동일한 방식으로 페이지 객체에
 * 옵셔널 필드 {shotType?, cameraAngle?} 로 실려 pagesList JSON 직렬화에 그대로 편승한다.
 *
 * - 과거 문서(태그 없음)는 태그 미표시로 자연 호환.
 * - 태그를 지우면(빈 값/미카탈로그 값) 키 자체를 제거해 직렬화 형태가 레거시와 동일하게 유지된다.
 * - `withShotTag` 는 studio-page-meta.withPageMeta 와 동일 계약: 불변, 대상 없음/실질 변화 없음이면
 *   원본 배열 참조를 그대로 반환(호출측이 `next !== pages` 로 undo 히스토리 커밋 여부 판단 가능).
 *
 * 전부 불변 · 부수효과 없음. DOM/Konva/React 의존 없음.
 */

/** 샷 타입(화면에 담기는 크기) 카탈로그 항목. */
export interface ShotTypeDef {
  id: string;
  /** 약어 — 그리드 카드 등 좁은 공간의 배지/셀렉트 표시용. */
  abbr: string;
  /** 전체 한글 명칭 — title/aria-label 등 상세 표시용. */
  label: string;
}

/** 카메라 앵글(시점) 카탈로그 항목. */
export interface CameraAngleDef {
  id: string;
  abbr: string;
  label: string;
}

/**
 * 샷 타입 카탈로그 — 클로즈업 계열부터 와이드 계열, 구도형 샷까지 콘티에서 흔히 쓰는 11종.
 * 순서는 좁은 화각→넓은 화각 뒤에 구도형 샷을 덧붙인 관례적 배열(선택 UI 스캔 순서로도 사용).
 */
export const SHOT_TYPES: readonly ShotTypeDef[] = [
  { id: "ecu", abbr: "ECU", label: "익스트림 클로즈업" },
  { id: "cu", abbr: "CU", label: "클로즈업" },
  { id: "mcu", abbr: "MCU", label: "미디엄 클로즈업" },
  { id: "ms", abbr: "MS", label: "미디엄 샷" },
  { id: "mws", abbr: "MWS", label: "미디엄 와이드샷" },
  { id: "ws", abbr: "WS", label: "와이드샷" },
  { id: "ews", abbr: "EWS", label: "익스트림 와이드샷" },
  { id: "two-shot", abbr: "투샷", label: "투샷" },
  { id: "ots", abbr: "OTS", label: "오버 더 숄더" },
  { id: "insert", abbr: "인서트", label: "인서트" },
  { id: "birds-eye", abbr: "버즈아이", label: "버즈아이 뷰" },
] as const;

/** 카메라 앵글 카탈로그 — 수평(아이레벨) 기준 상/하/특수 시점 7종. */
export const CAMERA_ANGLES: readonly CameraAngleDef[] = [
  { id: "eye-level", abbr: "아이레벨", label: "아이레벨" },
  { id: "low", abbr: "로우", label: "로우 앵글" },
  { id: "high", abbr: "하이", label: "하이 앵글" },
  { id: "worms-eye", abbr: "웜즈아이", label: "웜즈아이 뷰" },
  { id: "dutch", abbr: "더치", label: "더치 앵글" },
  { id: "over-shoulder", abbr: "오버숄더", label: "오버숄더" },
  { id: "pov", abbr: "POV", label: "POV" },
] as const;

const SHOT_TYPE_MAP: ReadonlyMap<string, ShotTypeDef> = new Map(SHOT_TYPES.map((s) => [s.id, s]));
const CAMERA_ANGLE_MAP: ReadonlyMap<string, CameraAngleDef> = new Map(CAMERA_ANGLES.map((a) => [a.id, a]));

/** 유효한 샷 타입 id 여부. */
export function isShotTypeId(id: unknown): id is string {
  return typeof id === "string" && SHOT_TYPE_MAP.has(id);
}

/** 유효한 카메라 앵글 id 여부. */
export function isCameraAngleId(id: unknown): id is string {
  return typeof id === "string" && CAMERA_ANGLE_MAP.has(id);
}

/** 샷 타입 전체 명칭 — 미카탈로그 값/비문자열은 undefined. */
export function shotTypeLabel(id: unknown): string | undefined {
  return typeof id === "string" ? SHOT_TYPE_MAP.get(id)?.label : undefined;
}

/** 샷 타입 약어. */
export function shotTypeAbbr(id: unknown): string | undefined {
  return typeof id === "string" ? SHOT_TYPE_MAP.get(id)?.abbr : undefined;
}

/** 카메라 앵글 전체 명칭. */
export function cameraAngleLabel(id: unknown): string | undefined {
  return typeof id === "string" ? CAMERA_ANGLE_MAP.get(id)?.label : undefined;
}

/** 카메라 앵글 약어. */
export function cameraAngleAbbr(id: unknown): string | undefined {
  return typeof id === "string" ? CAMERA_ANGLE_MAP.get(id)?.abbr : undefined;
}

/** 태그를 실을 수 있는 페이지 최소 형태(외부 문서는 타입 보장이 없어 unknown). */
export interface ShotTagCarrier {
  id: string;
  shotType?: unknown;
  cameraAngle?: unknown;
}

/** 태그 패치 — null/빈 문자열/미카탈로그 값/명시적 undefined 는 전부 "키 제거"를 뜻한다. */
export interface ShotTagPatch {
  shotType?: string | null;
  cameraAngle?: string | null;
}

/** 페이지에 실리는 샷 태그(정규화된 형태). */
export interface ShotTag {
  shotType?: string;
  cameraAngle?: string;
}

function cleanShotTypeId(raw: unknown): string | undefined {
  return isShotTypeId(raw) ? raw : undefined;
}

function cleanCameraAngleId(raw: unknown): string | undefined {
  return isCameraAngleId(raw) ? raw : undefined;
}

/** 외부/과거 문서에서 읽은 페이지의 태그를 안전 정규화(미카탈로그 값·잘못된 타입은 제거). */
export function normalizeShotTag(raw: unknown): ShotTag {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as { shotType?: unknown; cameraAngle?: unknown };
  const tag: ShotTag = {};
  const shotType = cleanShotTypeId(o.shotType);
  const cameraAngle = cleanCameraAngleId(o.cameraAngle);
  if (shotType !== undefined) tag.shotType = shotType;
  if (cameraAngle !== undefined) tag.cameraAngle = cameraAngle;
  return tag;
}

/**
 * 샷 태그 설정/제거 — 불변. studio-page-meta.withPageMeta 와 동일 계약:
 * 카탈로그에 없는 값(null·""·오탈자 id)은 키를 통째로 제거해 직렬화 결과가 레거시 문서와
 * 동일한 형태로 남는다. 대상 페이지가 없거나 실질 변화가 없으면 **원본 배열 참조를 그대로
 * 반환**한다 — 호출측은 `next !== pages` 일 때만 커밋해 undo 히스토리 오염을 막을 수 있다.
 */
export function withShotTag<P extends ShotTagCarrier>(
  pages: readonly P[],
  pageId: string,
  patch: ShotTagPatch
): P[] {
  const idx = pages.findIndex((p) => p.id === pageId);
  if (idx < 0) return pages as P[];
  const page = pages[idx];

  const curShotType = cleanShotTypeId(page.shotType);
  const curCameraAngle = cleanCameraAngleId(page.cameraAngle);
  const nextShotType = "shotType" in patch ? cleanShotTypeId(patch.shotType) : curShotType;
  const nextCameraAngle = "cameraAngle" in patch ? cleanCameraAngleId(patch.cameraAngle) : curCameraAngle;
  if (nextShotType === curShotType && nextCameraAngle === curCameraAngle) return pages as P[];

  const nextPage = { ...page } as P & ShotTag;
  if (nextShotType === undefined) delete (nextPage as { shotType?: unknown }).shotType;
  else nextPage.shotType = nextShotType;
  if (nextCameraAngle === undefined) delete (nextPage as { cameraAngle?: unknown }).cameraAngle;
  else nextPage.cameraAngle = nextCameraAngle;
  return pages.map((p, i) => (i === idx ? (nextPage as P) : p));
}

/**
 * 배지 표시용 짧은 텍스트("ECU · 로우" 등) — 그리드/스트립 카드처럼 좁은 공간에 사용.
 * 둘 다 없으면 null(호출측이 배지 자체를 렌더링하지 않도록).
 */
export function shotTagBadgeText(page: { shotType?: unknown; cameraAngle?: unknown } | null | undefined): string | null {
  const shot = shotTypeAbbr(page?.shotType);
  const angle = cameraAngleAbbr(page?.cameraAngle);
  if (!shot && !angle) return null;
  return [shot, angle].filter((v): v is string => Boolean(v)).join(" · ");
}

/** 배지 title/aria-label 용 전체 명칭 텍스트("클로즈업 · 로우 앵글" 등). 둘 다 없으면 null. */
export function shotTagBadgeTitle(page: { shotType?: unknown; cameraAngle?: unknown } | null | undefined): string | null {
  const shot = shotTypeLabel(page?.shotType);
  const angle = cameraAngleLabel(page?.cameraAngle);
  if (!shot && !angle) return null;
  return [shot, angle].filter((v): v is string => Boolean(v)).join(" · ");
}
