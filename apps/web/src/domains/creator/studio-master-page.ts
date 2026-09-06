/**
 * Studio Master Page — 문서 전역 공통 요소 레이어(PPT 마스터 슬라이드식)의 순수 로직.
 *
 * 모든 페이지에 반복되는 로고/워터마크 문구/코너 장식/공통 프레임 스타일을 문서 레벨
 * `master: { elements }` 하나로 관리한다. 마스터 요소는 각 페이지 렌더에서 일반 요소
 * "아래"(배경 위)에 합성되고, 페이지별로 `page.hideMaster` 로 숨길 수 있다.
 *
 * 직렬화 규약(하위호환):
 * - 문서(doc)/오토세이브/프로젝트 파일의 최상위에 옵셔널 `master` 필드를 추가한다.
 *   마스터가 비어 있으면 serializeDocumentMaster 가 undefined 를 반환해 JSON 에서 키가
 *   떨어진다 — 마스터를 쓰지 않는 문서는 기존 직렬화 형태와 바이트 동일.
 * - 과거 문서(master 미존재)는 normalizeDocumentMaster 가 빈 마스터로 정규화한다.
 * - `page.hideMaster` 도 같은 규약: 켤 때만 true 저장, 끌 때는 키 제거(studio-page-meta
 *   의 note 규약과 동일).
 *
 * 마스터 요소 제약(정직한 축소 규약):
 * - 레이어 그룹(groupId)과 알파 클리핑(clipBelow)은 마스터에서 지원하지 않는다 —
 *   페이지 렌더 합성 시 그룹/클립 기준(인덱스·그룹 목록)이 페이지 것과 섞여 깨지므로
 *   저장(withMasterElements)·정규화 시점에 해제한다.
 * - 페이지 캔버스 합성본은 항상 잠금(locked)·패널 클리핑 제외(noClip)로 강제된다 —
 *   일반 편집 중 마스터를 실수로 움직일 수 없고, 페이지 프레임에 의해 잘리지 않는다.
 *
 * 마스터 편집 모드 규약(호출 측 StudioPage 계약):
 * - 편집 모드에서는 편집 대상 요소 목록이 master.elements 로 바뀌고, commit 은
 *   withMasterElements 로 마스터에 커밋된다(resolveMasterCommitTarget 참고).
 * - 페이지의 일반 요소는 반투명(MASTER_EDIT_GHOST_OPACITY) 잠금 고스트로만 표시한다.
 * - 마스터 편집은 페이지 히스토리(undo/redo)에 포함되지 않는다 — 호출 측이 히스토리
 *   이동을 잠그고 패널에서 고지한다.
 *
 * 전부 불변 · 부수효과 없음. Konva/React/DOM 의존 없음. 요소의 구체 타입(El)은
 * 호출 측이 캐스팅한다(studio-clips 와 동일한 El유사 규약).
 */

/** 마스터가 다루는 최소 요소 형태 — StudioPage 의 El 이 구조적으로 만족한다. */
export interface MasterElementLike {
  id: string;
  hidden?: boolean;
  locked?: boolean;
  noClip?: boolean;
  groupId?: string;
  clipBelow?: boolean;
}

/** 문서 마스터 — 문서(doc)·오토세이브·프로젝트 파일 최상위의 옵셔널 `master` 필드 형태. */
export interface DocumentMaster<E extends MasterElementLike = MasterElementLike> {
  elements: E[];
}

/** 마스터 편집 모드에서 페이지 일반 요소 고스트의 불투명도(위치 참고용 표시). */
export const MASTER_EDIT_GHOST_OPACITY = 0.35;

/** 빈 문서 마스터 — 새 문서·과거 문서(master 미존재)의 기본값. */
export function createEmptyDocumentMaster<
  E extends MasterElementLike = MasterElementLike,
>(): DocumentMaster<E> {
  return { elements: [] };
}

/**
 * 마스터 요소 정규화 — 마스터가 지원하지 않는 필드(groupId·clipBelow)를 키째 제거한다.
 * (그룹은 페이지 소유 목록이라 마스터에선 참조가 깨지고, 알파 클리핑은 페이지 합성에서
 * 인덱스 기준 체인이 성립하지 않는다.) 원본은 변경하지 않는다.
 */
export function normalizeMasterElement<E extends MasterElementLike>(el: E): E {
  const next = { ...el } as MasterElementLike;
  delete next.groupId;
  delete next.clipBelow;
  return next as E;
}

/**
 * 마스터 요소 배열 교체 — 각 요소를 정규화해 새 마스터를 돌려준다.
 * (master 의 다른 필드는 스프레드로 보존 — 미래 필드 확장 대비.)
 */
export function withMasterElements<E extends MasterElementLike>(
  master: DocumentMaster<E>,
  nextElements: readonly E[]
): DocumentMaster<E> {
  return { ...master, elements: nextElements.map((el) => normalizeMasterElement(el)) };
}

/**
 * 저장된 값(unknown JSON)을 안전하게 문서 마스터로 정규화한다.
 * master 미존재·형식 불일치·id 없는 항목은 전부 걸러 과거 문서와 하위호환된다.
 */
export function normalizeDocumentMaster(raw: unknown): DocumentMaster {
  if (!raw || typeof raw !== "object") return createEmptyDocumentMaster();
  const elementsRaw = (raw as { elements?: unknown }).elements;
  if (!Array.isArray(elementsRaw)) return createEmptyDocumentMaster();
  const elements: MasterElementLike[] = [];
  for (const item of elementsRaw) {
    if (!item || typeof item !== "object") continue;
    const id = (item as { id?: unknown }).id;
    if (typeof id !== "string" || id === "") continue;
    elements.push(normalizeMasterElement(item as MasterElementLike));
  }
  return { elements };
}

/**
 * 직렬화용 마스터 — 비어 있으면 undefined 를 반환해 JSON.stringify 에서 키가 떨어진다.
 * (마스터를 쓰지 않는 문서의 직렬화 형태를 기존과 동일하게 유지하는 하위호환 규약.)
 */
export function serializeDocumentMaster<E extends MasterElementLike>(
  master: DocumentMaster<E> | null | undefined
): { elements: E[] } | undefined {
  if (!master || master.elements.length === 0) return undefined;
  return { elements: master.elements.map((el) => normalizeMasterElement(el)) };
}

/**
 * 페이지 캔버스/썸네일에 깔 마스터 합성 목록.
 * - hidden 요소는 제외(마스터 편집 모드의 레이어 숨김을 페이지에도 반영).
 * - locked=true·noClip=true 강제: 일반 편집 중 조작 불가 + 페이지 프레임 클리핑 제외.
 * - groupId/clipBelow 는 페이지 문맥과 섞이지 않도록 제거(정규화와 동일).
 */
export function composeMasterRenderElements<E extends MasterElementLike>(
  master: DocumentMaster<E> | null | undefined
): E[] {
  if (!master || master.elements.length === 0) return [];
  return master.elements
    .filter((el) => !el.hidden)
    .map((el) => {
      const next = { ...el } as MasterElementLike;
      next.locked = true;
      next.noClip = true;
      delete next.groupId;
      delete next.clipBelow;
      return next as E;
    });
}

/**
 * 마스터+페이지 요소 합성 목록 — 마스터(아래)가 앞, 페이지 요소(위)가 뒤.
 * 마스터가 비었거나 페이지가 hideMaster 면 페이지 요소 배열을 "그대로"(동일 참조) 반환해
 * 호출 측 메모이제이션(React Compiler)을 보존한다.
 */
export function composePageElements<
  E extends MasterElementLike,
  P extends { elements: E[]; hideMaster?: boolean },
>(master: DocumentMaster<E> | null | undefined, page: P): E[] {
  if (!master || master.elements.length === 0 || page.hideMaster) return page.elements;
  const overlay = composeMasterRenderElements(master);
  if (overlay.length === 0) return page.elements;
  return [...overlay, ...page.elements];
}

/**
 * 페이지 스트립 썸네일용 합성 페이지 — StudioPageThumbnails 는 page 하나만 받으므로,
 * 마스터 요소를 elements 앞에 붙인 사본 페이지를 만들어 넘긴다(썸네일에도 마스터 표시).
 * 합성할 것이 없으면 원본 page 를 동일 참조로 반환한다(마스터 없는 문서는 재렌더 무영향).
 */
export function composeThumbPage<
  E extends MasterElementLike,
  P extends { elements: E[]; hideMaster?: boolean },
>(master: DocumentMaster<E> | null | undefined, page: P): P {
  const composed = composePageElements(master, page);
  if (composed === page.elements) return page;
  return { ...page, elements: composed } as P;
}

/**
 * 페이지별 마스터 숨김 토글 — 켤 때만 hideMaster: true, 끌 때는 키 제거(직렬화 규약).
 * 대상 외 페이지는 동일 참조 유지(변경 페이지만 새 객체 — 썸네일 메모이제이션 보존).
 */
export function togglePageHideMaster<P extends { id: string; hideMaster?: boolean }>(
  pages: readonly P[],
  pageId: string
): P[] {
  return pages.map((p) => {
    if (p.id !== pageId) return p;
    if (p.hideMaster) {
      const next = { ...p } as { hideMaster?: boolean };
      delete next.hideMaster;
      return next as P;
    }
    return { ...p, hideMaster: true } as P;
  });
}

/**
 * 요소 추가/편집 커밋이 향할 대상 — 마스터 편집 모드면 "master", 아니면 "page".
 * (StudioPage 의 commit/commitCoalesced 분기 규약을 데이터로 고정해 테스트 가능하게 한다.)
 */
export function resolveMasterCommitTarget(masterEditMode: boolean): "master" | "page" {
  return masterEditMode ? "master" : "page";
}
