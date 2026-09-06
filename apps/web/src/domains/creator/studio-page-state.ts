import type { StudioDrawingAssistDocument } from "./brush/studio-drawing-assist-document";
import type { StudioPaperSurfaceSettings } from "./brush/studio-paper-granulation-runtime";
import type { DialogueLocaleMap } from "./lettering/studio-dialogue-translate";
import type { AnimationTimelineDoc } from "./studio-anim-tracks";
import type { El } from "./studio-element-model";
import type { LayerGroup } from "./studio-layers";
import type { StudioLinked3dRenderDocument } from "./studio-linked-3d-render-document";
import type { PageGrade } from "./studio-page-grade";
import type { PageReviewState } from "./studio-page-review";
import type { StudioShared3dStagePersistedState } from "./studio-shared-3d-stage-collection";

export interface PageState {
  id: string;
  elements: El[];
  bg: string;
  bgGrad: string[] | null;
  canvasH: number;
  /**
   * Document paper sheet for brush granulation (kind + seed).
   * Missing on legacy pages → cold-press default at runtime.
   */
  paperSurface?: StudioPaperSurfaceSettings;
  /**
   * When set, decides whether the stage paints a seamless paper-grain fill over the page
   * background. Missing → resolved by `brush/studio-paper-grain-visibility-v1`: the sheet shows
   * exactly when `paperSurface` above is authored, so choosing a paper is immediately visible
   * while a legacy page that never chose one is never retroactively repainted. That module is the
   * single authority; do not re-derive this flag at a call site.
   */
  paperGrainVisible?: boolean;
  grade?: PageGrade; // 페이지 전체 색보정(밝기/대비/채도/색조/세피아/흑백/비네트). 미설정=보정 없음.
  groups?: LayerGroup[]; // 레이어 그룹(폴더). 미설정=그룹 없음.
  animTimeline?: AnimationTimelineDoc; // 다중 레이어 타임라인(studio-anim-tracks). 미설정=타임라인 없음(기존 문서 100% 호환).
  name?: string; // 페이지 이름(스트립 표시) — studio-page-meta 관리. 미설정=자동 이름("1페이지").
  note?: string; // 콘티 메모 — 미설정=없음. 빈 값 저장 시 키 제거로 레거시 직렬화 형태 유지.
  hideMaster?: boolean; // 이 페이지에서 문서 마스터(공통 요소) 숨김 — studio-master-page. 미설정=표시(해제 시 키 제거).
  shotType?: string; // 샷 타입(클로즈업/와이드 등) — studio-panel-shot-tags 관리. 미설정=태그 없음(빈 값 저장 시 키 제거).
  cameraAngle?: string; // 카메라 앵글(로우/하이/더치 등) — studio-panel-shot-tags 관리. 미설정=태그 없음(빈 값 저장 시 키 제거).
  dialogueI18n?: DialogueLocaleMap; // 대사 번역 저장소(studio-dialogue-translate) — elId→로케일→텍스트. 미설정=번역 없음(기존 문서 100% 호환).
  review?: PageReviewState; // 페이지 검토 상태·담당·메모·로컬 편집 잠금.
  /** 페이지 소유 원근자·아이소메트릭 가이드. 미설정 레거시는 비활성 기본값으로 정규화. */
  drawingAssist?: StudioDrawingAssistDocument;
  /** 여러 BG3D 원본과 각 장면의 canonical VRM 원본을 잇는 엄격한 참조 컬렉션. */
  shared3dStage?: StudioShared3dStagePersistedState;
  /** 실제 Canvas LT 레이어를 canonical Scene Shot에 잇는 ref-only 교차참조 영수증. */
  linked3dRender?: StudioLinked3dRenderDocument;
}
