/**
 * Studio Storyboard Grid Panel — 전체 페이지를 다열 그리드로 한눈에 훑어보는 라이트테이블 모드.
 *
 * 페이지 스트립(StudioPageThumbnails)과 동일한 경량 SVG 프록시 썸네일(StudioPageThumbnail)을
 * 세로 목록 대신 반응형 CSS 그리드로 타일링한다 — 페이지마다 Konva Stage를 새로 띄우지 않는다는
 * 원칙은 그대로 유지(재사용이 핵심). 재배열도 페이지 스트립과 동일한 useStudioPageDnd 인스턴스를
 * 그대로 전달받아 쓴다(재생성 금지 — 드래그 상태가 두 뷰에서 갈라지는 버그를 원천 차단).
 *
 * 전체화면 모달이라 사이드바(최대 360px)의 폭 제약 없이 수십 개 페이지를 동시에 비교할 수 있다
 * — "페이지가 멀리 떨어져 있으면 스크롤해야 비교 가능"이라는 갭을 메우는 게 이 패널의 유일한 목적.
 *
 * 이 패널 자신은 상태를 소유하지 않는다(칸 크기 S/M/L만 예외 — 데이터에 영향 없는 순수 표시 취향).
 * 페이지 CRUD(추가/복제/삭제)는 전부 StudioPage가 이미 갖고 있는 핸들러를 그대로 위임받는다.
 *
 * 그리드는 N개 StudioPageThumbnail을 한 번에 마운트한다(가상화 없음) — 이는 이 아키텍처의
 * 기존 특성이지 이 기능이 새로 만든 비용이 아니다: 도킹된 페이지 목록도 오늘 이미 전체 페이지 수만큼
 * 마운트하고 있고(스크롤 영역만 다름), react-window 등 가상화 라이브러리는 이 코드베이스 어디에도
 * 없다. 수백 페이지급 성능 이슈가 실제로 생기면 StudioPageThumbnails.tsx까지 포함한 횡단 개선이 될
 * 사안이라 이 패널 단독 스코프가 아니다.
 */
import { Copy, LayoutGrid, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";

import { confirmStudioDestructiveAction } from "./studio-destructive-action-preview";
import { studioDeletePageRequest } from "./studio-destructive-command-catalog";
import { hasCustomPageName, pageDisplayName } from "./studio-page-meta";
import { StudioPanelChip } from "./studio-panel-ui";
import { StudioPageThumbnail, type StudioPageDnd } from "./StudioPageThumbnails";
import { StudioPanelShotTagFields } from "./StudioPanelShotTagFields";

import type { ThumbPageLike } from "./studio-page-thumbs";
import type { ShotTagPatch } from "./studio-panel-shot-tags";

import { cn } from "@/shared/lib/utils";

/** 그리드 패널이 받는 페이지 최소 형태 — StudioPageThumbnail과 동일 계약(ThumbPageLike) +
 * 이름/메모(스트립과 동일하게 표시용으로만 사용, 여기서는 편집하지 않는다 — 이름 편집은 목록 뷰의
 * 기존 인라인 편집(연필 버튼)을 그대로 쓰도록 의도적으로 남겨둔다: 작은 그리드 칸에 이름+메모
 * 편집 UI까지 넣으면 밀도가 무너지고, 목록 뷰 기능을 중복 구현하게 된다).
 * shotType/cameraAngle은 studio-panel-shot-tags가 관리 — 이름/메모와 달리 그리드에서 직접
 * 편집 가능하다(칩형 네이티브 select 상시 노출, onShotTagChange 참고). */
export type StoryboardGridPage = ThumbPageLike & {
  id: string;
  name?: string;
  note?: string;
  shotType?: string;
  cameraAngle?: string;
};

const CELL_SIZE_PRESETS = {
  s: "grid-cols-[repeat(auto-fill,minmax(5rem,1fr))]",
  m: "grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))]",
  l: "grid-cols-[repeat(auto-fill,minmax(11rem,1fr))]",
} as const;
type CellSize = keyof typeof CELL_SIZE_PRESETS;

export interface StudioStoryboardGridPanelProps {
  open: boolean;
  onClose: () => void;
  /** composeThumbPage(master, p)로 마스터 요소까지 합성된 페이지 배열 — 페이지 스트립과 동일 소스를
   * 호출측(StudioPage)이 만들어 넘긴다(이 패널은 DocumentMaster 타입을 몰라도 된다). */
  pages: StoryboardGridPage[];
  currentPageId: string;
  /** 페이지 스트립이 이미 만든 useStudioPageDnd 인스턴스 — 여기서 새로 만들지 않는다. */
  dnd: StudioPageDnd;
  onSelectPage: (pageId: string) => void;
  onAddPage: () => void;
  onDuplicatePage: (pageId: string) => void;
  /** 확인 다이얼로그를 통과한 뒤에만 호출된다 — 삭제 자체는 이 패널이 결정하지 않는다
   * (StudioPage.deletePage를 그대로 넘기면 됨). */
  onDeletePage: (pageId: string) => void;
  /** pages.length > 1 — 목록 뷰의 삭제 버튼과 동일한 가드를 호출측이 계산해 넘긴다. */
  canDelete: boolean;
  /** 샷 타입/카메라 앵글 태그 커밋 — studio-panel-shot-tags.withShotTag의 결과로 pages를
   * 갱신하는 건 호출측(StudioPage) 책임이다. 전달하지 않으면 태그 셀렉트 UI 자체를
   * 렌더링하지 않는다(옵트인 — 미전달 시 기존 카드 레이아웃과 완전히 동일하게 유지). */
  onShotTagChange?: (pageId: string, patch: ShotTagPatch) => void;
}

export function StudioStoryboardGridPanel({
  open,
  onClose,
  pages,
  currentPageId,
  dnd,
  onSelectPage,
  onAddPage,
  onDuplicatePage,
  onDeletePage,
  canDelete,
  onShotTagChange,
}: StudioStoryboardGridPanelProps): ReactElement | null {
  const [cellSize, setCellSize] = useState<CellSize>("m");

  // ESC로 닫기 — StudioTimelapsePanel/StudioBackground3D와 동일 관례.
  // 단, 드래그 중(dnd.dragIndex !== null)에는 닫지 않는다: dnd는 이 패널이 소유하지 않고
  // 페이지 스트립과 공유하는 인스턴스라, 드래그 중인 카드의 DOM이 언마운트되면 네이티브
  // dragend가 (분리된 노드라 버블링할 트리가 없어) React 델리게이트 리스너까지 도달하지
  // 못해 dragIndex/dropSlot이 리셋되지 않고 그대로 남는다 — 모달을 닫은 뒤 페이지 스트립의
  // 해당 카드가 계속 반투명(opacity-50)으로 "드래그 중"인 것처럼 보이는 유령 상태가 된다.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dnd.dragIndex === null) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, dnd.dragIndex]);

  if (!open) return null;

  const modal = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="스토리보드 그리드 보기"
      className="fixed inset-0 z-[80] bg-[oklch(0.08_0.01_70/0.82)] p-2 text-fg backdrop-blur-sm sm:p-4"
    >
      <div className="mx-auto flex h-full w-full max-w-[100rem] flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <LayoutGrid size={16} className="text-accent" aria-hidden />
          <h2 className="text-sm font-bold text-fg">스토리보드 그리드 보기</h2>
          <span className="text-xs text-fg-3">총 {pages.length}페이지</span>

          <div className="ml-auto flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-md border border-line bg-card/50 p-0.5">
              <StudioPanelChip active={cellSize === "s"} onClick={() => setCellSize("s")} title="작게 — 더 많이 보기">
                소
              </StudioPanelChip>
              <StudioPanelChip active={cellSize === "m"} onClick={() => setCellSize("m")} title="보통">
                중
              </StudioPanelChip>
              <StudioPanelChip active={cellSize === "l"} onClick={() => setCellSize("l")} title="크게 — 더 자세히 보기">
                대
              </StudioPanelChip>
            </div>
            <button
              type="button"
              onClick={onAddPage}
              className="flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-semibold text-on-accent hover:bg-accent-hover pointer-coarse:min-h-11 pointer-coarse:px-3"
            >
              <Plus size={12} /> 추가
            </button>
            <button
              type="button"
              aria-label="닫기"
              title="닫기 (Esc)"
              onClick={onClose}
              className="grid size-8 place-items-center rounded-lg border border-line bg-card text-fg-3 transition-colors hover:bg-accent-soft hover:text-accent pointer-coarse:size-11"
            >
              <X size={15} aria-hidden />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <div className={cn("grid gap-3", CELL_SIZE_PRESETS[cellSize])}>
            {pages.map((p, idx) => {
              const isActive = p.id === currentPageId;
              const dropIndicator = dnd.indicatorFor(idx);
              const displayName = pageDisplayName(p, idx);
              return (
                <div
                  key={p.id}
                  {...dnd.itemProps(idx)}
                  title="드래그하여 순서 변경"
                  className={cn(
                    "group relative flex flex-col gap-1 rounded-xl border p-1.5 transition-all",
                    isActive ? "border-accent bg-accent-soft/40" : "border-line bg-card hover:bg-raised/50",
                    dnd.dragIndex === idx && "opacity-50"
                  )}
                >
                  {dropIndicator && (
                    <span
                      aria-hidden
                      className={cn(
                        "pointer-events-none absolute inset-x-1 z-10 h-[3px] rounded-full bg-accent",
                        dropIndicator === "before" ? "top-0" : "bottom-0"
                      )}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => onSelectPage(p.id)}
                    aria-label={`${displayName} 선택`}
                    aria-pressed={isActive}
                    className="absolute inset-0 z-10 cursor-pointer rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  />

                  <StudioPageThumbnail page={p} className="h-auto w-full aspect-[2/3]" />

                  {/* 항상 보이는 캡션(터치 기기엔 hover가 없으므로 이름은 hover에 가두지 않는다).
                      커스텀 이름이 없으면 displayName 자체가 이미 "N페이지" 형태라 앞에 순번을 또 붙이면
                      "1. 1페이지"처럼 중복 표시된다 — 커스텀 이름이 있을 때만 순번 접두사를 덧붙인다. */}
                  <span
                    className="truncate text-[10px] font-semibold text-fg-2"
                    title={p.note ? `${displayName}\n${p.note}` : displayName}
                  >
                    {hasCustomPageName(p) ? `${idx + 1}. ${displayName}` : displayName}
                    {p.note ? " 📝" : ""}
                  </span>

                  {/* 샷 타입/카메라 앵글 — 콘티 검토 시 상시 표시(hover에 가두지 않음). 카드 전체를
                      덮는 선택 버튼(z-10)보다 위(z-20 + relative)에 있어야 select 클릭이 카드 선택으로
                      새지 않는다. 호출측이 onShotTagChange를 넘기지 않으면(통합 전) 렌더링 자체를
                      건너뛴다 — 기존 카드 레이아웃과 완전히 동일하게 유지. */}
                  {onShotTagChange && (
                    <StudioPanelShotTagFields
                      shotType={p.shotType}
                      cameraAngle={p.cameraAngle}
                      onShotTypeChange={(value) => onShotTagChange(p.id, { shotType: value })}
                      onCameraAngleChange={(value) => onShotTagChange(p.id, { cameraAngle: value })}
                      size="compact"
                      className="relative z-20"
                    />
                  )}

                  {/* 데스크톱(마우스)에선 밀도를 위해 hover/focus에만 노출하지만, 터치 기기는 hover가
                      없고 이 레이어가 pointer-events-none이면 탭이 아래의 전체 선택 버튼으로 그대로
                      새어나가 "복제/삭제를 누르려다 페이지 이동+모달 닫힘"이 벌어진다 — pointer-coarse
                      (터치)에서는 항상 보이고 항상 클릭 가능하게 강제로 켠다. */}
                  <div className="pointer-coarse:pointer-events-auto pointer-coarse:opacity-100 pointer-coarse:gap-1.5 absolute right-1 top-1 z-20 flex items-center gap-0.5 pointer-events-none opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
                    {/* 19×19 는 WCAG 2.2 최소 타깃(24px)에도 못 미치는데, 바로 옆이 되돌릴 수 없는
                        삭제라 오탭 비용이 크다. 가장 작은 셀이 5rem 이라 44px 두 개는 카드를
                        넘치므로 36px + 간격으로 올린다 — 터치에서만 적용해 마우스 밀도는 그대로. */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDuplicatePage(p.id);
                      }}
                      className="grid place-items-center rounded bg-black/55 p-1 text-white hover:bg-black/70 pointer-coarse:size-9 pointer-coarse:rounded-lg"
                      title="페이지 복제"
                      aria-label={`${displayName} 복제`}
                    >
                      <Copy size={11} />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!canDelete) return;
                        void (async () => {
                          if (
                            !(await confirmStudioDestructiveAction(
                              studioDeletePageRequest({
                                pageNumber: idx + 1,
                                elementCount: p.elements.length,
                              })
                            ))
                          ) return;
                          onDeletePage(p.id);
                        })();
                      }}
                      disabled={!canDelete}
                      className="grid place-items-center rounded bg-black/55 p-1 text-white hover:bg-bad/80 disabled:opacity-30 pointer-coarse:size-9 pointer-coarse:rounded-lg"
                      title="페이지 삭제"
                      aria-label={`${displayName} 삭제`}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <p className="shrink-0 border-t border-line px-4 py-2 text-[0.7rem] text-fg-3" role="status">
          카드를 드래그하면 순서가 바뀌고, 클릭하면 그 페이지로 이동합니다.
        </p>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(modal, document.body);
}
