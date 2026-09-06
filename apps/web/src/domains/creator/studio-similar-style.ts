// 비슷한 스타일 더보기 — 미리캔버스 "비슷한 요소 찾기" 축소판. 완전한 비주얼 유사도 검색(이미지
// 임베딩 AI)은 스코프 밖이라, 이 앱 카탈로그들이 이미 갖고 있는 category 필드로 근사한다: 지금 보고
// 있는 항목과 같은 category 를 가진 다른 항목들을 빠르게 뽑아 보여줘서, 한 무드/스타일을 유지하며
// 계속 골라 넣기 쉽게 한다.
//
// category 필드가 있는 카탈로그라면 어디든 재사용 가능한 순수 제네릭 헬퍼 — 현재
// EmeresTemplate(studio-emeres-templates.ts, category: "관계"|"감정"|"일상"|"액션")과
// SceneTemplate(studio-scene-templates.ts, category: "school"|"romance"|"action"|"fantasy"|"daily"|
// "narrative") 두 카탈로그 모두 이미 이 모양(id + category)을 만족한다. FxOverlay(studio-prop-
// stickers.ts, 프롭 스티커 59개)는 category 필드가 없어(소스 파일 안 "// ── 디지털·기기 (8) ──" 같은
// 구분은 사람이 읽는 섹션 주석일 뿐 런타임 데이터 필드가 아니다) 이 헬퍼를 적용할 수 없다 — 새로
// category 를 붙이는 건 59개 항목 전부를 다시 만지는 콘텐츠 재작업이라 이번 스코프 밖이다
// (docs/studio-similar-style-integration.md §5 참고).
//
// StudioPage.tsx 는 이 모듈에서 import 하지 않는다(이 파일 자체는 손대지 않았다) — 위 문서가 기존
// 이메레스·장면 템플릿 피커 패널의 정확히 어느 지점에 이 헬퍼를 꽂는지 지시한다.

export interface CategorizedCatalogItem {
  id: string;
  category: string;
}

/**
 * catalog 안에서 currentId 항목과 같은 category 를 가진 "다른" 항목들을 원본 배열 순서 그대로
 * 반환한다.
 *
 * - currentId 항목 자기 자신은 결과에서 제외한다.
 * - currentId 가 catalog 에 없으면 빈 배열을 반환한다(호출부가 "찾았는지" 방어 코드를 따로 안 짜도
 *   되는 안전한 기본값).
 * - limit 을 넘기면 앞에서부터 그만큼만 잘라 반환한다(음수는 0으로 클램프). 넘기지 않으면 전부
 *   반환한다.
 * - 순수 함수다: catalog/currentId 를 변형하지 않고, 같은 입력엔 항상 같은 출력을 돌려준다.
 */
export function sameCategoryItems<T extends CategorizedCatalogItem>(
  catalog: readonly T[],
  currentId: string,
  limit?: number
): T[] {
  const current = catalog.find((item) => item.id === currentId);
  if (!current) return [];
  const rest = catalog.filter((item) => item.id !== currentId && item.category === current.category);
  if (limit === undefined) return rest;
  return rest.slice(0, Math.max(0, limit));
}

/**
 * `sameCategoryItems(catalog, currentId).length > 0` 과 결과는 같지만 배열을 새로 만들지 않고 첫
 * 매치에서 순회를 끊는다 — "비슷한 스타일 더보기" 버튼을 아예 보여줄지 말지 정하는 용도(카테고리에
 * 자기 혼자뿐인 항목엔 버튼을 노출하지 않기 위함).
 */
export function hasSameCategorySiblings<T extends CategorizedCatalogItem>(catalog: readonly T[], currentId: string): boolean {
  const current = catalog.find((item) => item.id === currentId);
  if (!current) return false;
  return catalog.some((item) => item.id !== currentId && item.category === current.category);
}
