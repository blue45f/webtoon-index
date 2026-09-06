/**
 * Studio Panel Auto-Fit — 이미지를 패널(프레임) 위로 드래그해 놓으면 그 패널에 맞춰 자동으로
 * 꽉 채우기(cover)를 적용할지 판정하고, 적용할 새 박스를 계산하는 순수 기하 헬퍼.
 *
 * Canva 컷툰 에디터의 "그리드에 이미지를 끌어다 놓으면 자동으로 그 칸에 맞춰진다"를 재현한다.
 * 이미 studio-fit.ts 의 coverFitInFrame() 이 "선택 이미지를 패널에 꽉 채우기" 수동 버튼
 * (StudioPage.tsx 의 fitSelectedToFrame, "패널에 꽉 채우기" 메뉴)에 쓰이고 있으므로, 이 모듈은
 * 그 함수를 그대로 재사용하고, 이 기능에 새로 필요한 두 가지만 추가한다.
 *   1) 드롭 위치가 "어느 프레임을 향한 것인지" 판정하는 사각형 겹침 비율 계산(코드베이스 어디에도
 *      아직 없었다 — StudioPage.tsx 의 containingPanel() 은 "중심점 + 크기 1.4배 이내"라는 다른
 *      휴리스틱을 쓰고, elBounds() 근처의 overlaps()는 겹침 여부만 boolean 으로 따지는 로컬 클로저
 *      라 비율이 없다).
 *   2) 그 판정에 쓰는 임계값 정책(중심 포함 + 겹침 비율 50%↑) + 자동맞춤 자격 여부(회전/기울임/
 *      다중 프레임 셀 애니메이션/noClip 가드).
 *
 * 전부 순수·결정적. DOM/Konva 의존 없음 — StudioPage.tsx 가 이미지 드래그 종료 시 이 모듈로 계산한
 * 결과 박스를 patchEl() 한다(studio-fit.ts 의 기존 관례와 동일한 "결과 박스를 호출부가 커밋"
 * 패턴). 실제 크롭(픽셀 잘라내기)은 하지 않는다 — coverFitInFrame() 과 마찬가지로 이미지를
 * 확대+중앙정렬한 오버사이즈 박스를 반환하고, 넘치는 부분은 렌더러가 이미 갖고 있는
 * containingPanel()/panelClip 클리핑(StudioPage.tsx, "패널 내부 콘텐츠 클리핑" 주석 부근)이 가린다.
 *
 * 통합 지시서: docs/studio-panel-autofit-integration.md (이 세션은 StudioPage.tsx 를 건드리지 않았다 —
 * 후속 통합 패스가 그 문서를 보고 정확한 위치에 연결한다).
 */

import { coverFitInFrame, type FitBox } from "./studio-fit";
import { isIdentitySkew } from "./studio-skew";

export type { FitBox } from "./studio-fit";

/**
 * 두 사각형의 겹침 비율 — 교차 면적 / 더 작은 쪽의 면적(0..1).
 *
 * 분모를 union(IoU)이 아니라 min(areaA, areaB)로 두는 이유: 이 기능은 "크기가 전혀 다른 두
 * 사각형"(예: 캔버스 전체를 덮는 커다란 배경 사진 vs 작은 컷 패널)을 자주 비교해야 한다. IoU는
 * 한쪽이 다른 쪽을 완전히 포함해도 크기 차이가 크면 비율이 낮게 나와("겹침"의 직관과 어긋남),
 * "이미지가 패널을 덮었다"/"패널이 이미지 안에 쏙 들어왔다" 두 경우 모두 자연스럽게 1.0 에 가깝게
 * 나오는 min-area 분모(오버랩 계수, Szymkiewicz–Simpson 계수)가 이 용도에 더 맞는다.
 */
export function rectOverlapRatio(a: FitBox, b: FitBox): number {
  const areaA = Math.max(0, a.width) * Math.max(0, a.height);
  const areaB = Math.max(0, b.width) * Math.max(0, b.height);
  if (areaA <= 0 || areaB <= 0) return 0;
  const ix = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const iy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (ix <= 0 || iy <= 0) return 0;
  return (ix * iy) / Math.min(areaA, areaB);
}

/** inner 사각형의 중심점이 outer 사각형의 경계 안(경계선 포함)에 있는가. */
export function isCenterInside(inner: FitBox, outer: FitBox): boolean {
  const cx = inner.x + inner.width / 2;
  const cy = inner.y + inner.height / 2;
  return cx >= outer.x && cx <= outer.x + outer.width && cy >= outer.y && cy <= outer.y + outer.height;
}

/** 자동맞춤을 적용할 최소 겹침 비율. "이미지 중심이 프레임 안 + 겹침 50% 이상" 정책의 후자 값. */
export const PANEL_AUTOFIT_OVERLAP_THRESHOLD = 0.5;

/**
 * 드래그로 옮겨진 이미지 bounds 와 겹치는 프레임들 중 자동맞춤 대상 하나를 고른다.
 *
 * 후보가 되려면 두 조건을 모두 만족해야 한다 — (1) 이미지 중심이 프레임 경계 안에 있고,
 * (2) rectOverlapRatio(movedImageBounds, frame) >= threshold. 여러 프레임이 동시에 조건을
 * 만족하면(겹치거나 인접한 패널 사이에 드롭한 경우) 겹침 비율이 더 큰 쪽을 고르고, 비율이
 * 같으면 면적이 더 작은 쪽(더 안쪽 패널)을 고른다 — StudioPage.tsx 의 containingPanel() 이 쓰는
 * "가장 작은 패널이 이긴다" 타이브레이크와 같은 방향이라, 두 판정 로직의 결과가 어긋나는 경우가
 * 최대한 적다.
 *
 * frames 는 숨김(hidden) 프레임을 걸러낸 배열을 넘겨야 한다 — 이 함수는 hidden 여부를 모른다
 * (FitBox 에 그 필드가 없다). 호출부가 `elements.filter((e): e is FrameEl => e.type === "frame" &&
 * !e.hidden)` 로 미리 걸러서 넘긴다(containingPanel() 과 동일한 관례).
 */
export function findBestAutoFitFrame<F extends FitBox>(
  movedImageBounds: FitBox,
  frames: readonly F[],
  threshold: number = PANEL_AUTOFIT_OVERLAP_THRESHOLD
): F | null {
  let best: F | null = null;
  let bestRatio = 0;
  let bestArea = Infinity;
  for (const frame of frames) {
    if (!isCenterInside(movedImageBounds, frame)) continue;
    const ratio = rectOverlapRatio(movedImageBounds, frame);
    if (ratio < threshold) continue;
    const area = frame.width * frame.height;
    const isBetter = ratio > bestRatio + 1e-9 || (Math.abs(ratio - bestRatio) <= 1e-9 && area < bestArea);
    if (isBetter) {
      best = frame;
      bestRatio = ratio;
      bestArea = area;
    }
  }
  return best;
}

/**
 * 이 이미지 요소가 드롭 자동맞춤 대상이 될 자격이 있는가.
 *
 * - rotation !== 0 이면 제외한다 — coverFitInFrame() 이 반환하는 박스는 항상 축이 맞는(axis-aligned)
 *   x/y/width/height 이고, 프레임 자체도 회전 필드가 없다(StudioPage.tsx 의 FrameEl 정의 참고).
 *   이미지가 이미 회전돼 있으면 그 박스로 바꿔도 시각적으로 프레임과 맞아떨어지지 않는다 — 이건
 *   기존 수동 "패널에 꽉 채우기" 버튼도 이미 갖고 있는 한계(rotation 을 건드리지 않는다)이므로
 *   여기서 "고치는" 대신, 자동으로(사용자가 명시적으로 누르지 않았는데) 회전된 배치에 끼어들지
 *   않도록 아예 제외하는 쪽을 택했다 — 사용자가 의도적으로 기울여 배치한 이미지를 살짝 옮겼을
 *   때 이 기능이 조용히 그 회전을 무시한 결과를 만드는 "놀람"을 피한다.
 * - 기울임(skewX/skewY)이 항등이 아니면(studio-skew.ts 의 isIdentitySkew) 같은 이유로 제외한다.
 *   `=== undefined` 로만 판정하지 않는 이유: studio-skew.ts 의 직렬화 규약상 UI 경로(스큐 패널의
 *   normalizeSkewPatch)는 0 을 저장할 때 undefined 로 비우지만, 이 판정 함수는 임의의 `el` 형태를
 *   받는 순수 함수라 그 관례를 강제할 수 없다 — `skewX: 0` 이 명시적으로 들어와도(다른 경로로 만든
 *   객체, 또는 향후 직렬화 규약이 바뀌는 경우) 시각적으로는 여전히 항등이므로 제외돼선 안 된다.
 *   `isIdentitySkew` 는 이미 이 코드베이스에서 "항등 기울임" 판정의 단일 소스이므로(스큐 패널
 *   리셋 버튼 활성화 판단 등에 이미 쓰인다) 같은 질문에 별도 로직을 새로 만들지 않고 재사용한다.
 * - frameCount(el.frames?.length) > 1 이면(다중 프레임 셀 애니메이션) 제외한다 — coverFitInFrame() 은
 *   현재 셀의 width/height 만 보고, 셀마다 원본 종횡비가 다를 수 있는 애니메이션 자산에 반복
 *   적용하면 사용자가 프레임별로 맞춰둔 배치를 드래그할 때마다 덮어써 버릴 위험이 있다.
 * - noClip 이 true 면 제외한다 — 이 기능은 오버사이즈 박스를 만들고 렌더러의 기존 패널 클립이
 *   넘치는 부분을 가리는 것을 전제로 한다(모듈 docstring 참고); noClip 요소는 그 클립이 애초에
 *   적용되지 않으므로 오버사이즈 박스만 만들면 이미지가 잘리지 않고 그대로 넘쳐 보이는 눈에 띄는
 *   회귀가 된다.
 */
export function isEligibleForPanelAutoFit(el: {
  rotation: number;
  skewX?: number;
  skewY?: number;
  frameCount?: number;
  noClip?: boolean;
}): boolean {
  return (
    el.rotation === 0 &&
    isIdentitySkew(el) &&
    (el.frameCount ?? 0) <= 1 &&
    !el.noClip
  );
}

/**
 * 이미지 드래그 종료 시 패널 자동맞춤 patch 를 계산한다.
 *
 * 대상 프레임이 없으면(겹침 조건을 만족하는 프레임이 없으면) null 을 반환한다 — 호출부는 이 경우
 * 기존과 동일하게 {x, y} 만 패치해야 한다(즉 이 함수는 "자동맞춤 안 함"을 표현하는 데도 쓰인다;
 * 호출부에서 별도로 findBestAutoFitFrame 을 다시 부를 필요가 없다).
 *
 * 대상이 있으면 studio-fit.ts 의 coverFitInFrame() 으로 cover 박스를 계산해 그대로 반환한다 —
 * 크롭(원본 픽셀 잘라내기)이 아니라 확대+중앙정렬 박스이고, 넘치는 부분은 렌더러의 기존
 * containingPanel()/panelClip 이 가린다. 이 함수 자체는 isEligibleForPanelAutoFit() 을 호출하지
 * 않는다 — 자격 판정은 "이 이미지가 대상이 될 수 있는가"라는 별개 축의 질문이고, 호출부(드래그
 * 종료 핸들러)가 이미 el 자체를 갖고 있어 그쪽에서 먼저 걸러 부르는 편이 더 명확하다(§ 통합 문서
 * 참고).
 */
export function computePanelAutoFitPatch(
  movedImageBounds: FitBox,
  frames: readonly FitBox[],
  threshold: number = PANEL_AUTOFIT_OVERLAP_THRESHOLD
): FitBox | null {
  const target = findBestAutoFitFrame(movedImageBounds, frames, threshold);
  if (!target) return null;
  return coverFitInFrame(movedImageBounds, target);
}
