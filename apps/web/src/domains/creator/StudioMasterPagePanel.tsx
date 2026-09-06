// 마스터 페이지 패널(PPT 마스터 슬라이드식) — 문서 전역 공통 요소(로고/워터마크 문구/코너 장식)를
// (1) 마스터 편집 모드 토글, (2) 페이지별 마스터 숨김 토글, (3) 마스터 비우기로 관리한다.
// 순수 규약(합성/직렬화/토글)은 studio-master-page, 상태 커밋은 StudioPage(메인 루프)가 담당한다.
// 자체완결 플로팅 패널: 캔버스 컨테이너(relative) 좌상단에 떠 있고 Esc 로 닫힌다.
import { LayoutTemplate, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { pageDisplayName } from "./studio-page-meta";

import { cn } from "@/shared/lib/utils";

/** 패널이 필요로 하는 최소 페이지 형태 — StudioPage 의 PageState 가 구조적으로 만족한다. */
export type MasterPanelPageLike = {
  id: string;
  name?: string;
  hideMaster?: boolean;
};

export type StudioMasterPagePanelProps = {
  /** 마스터 편집 모드 여부 — true 면 캔버스 편집이 문서 마스터로 커밋된다. */
  editMode: boolean;
  /** 현재 마스터 요소 개수(숨김 포함). */
  masterCount: number;
  /** 전체 페이지(순서대로) — 페이지별 숨김 토글 목록에 쓴다. */
  pages: readonly MasterPanelPageLike[];
  /** 현재 편집 중인 페이지 id(현재 배지 표시). */
  currentPageId: string;
  /** 마스터 편집 모드 토글 — 호출 측이 선택 해제 등 모드 전환 정리를 함께 수행한다. */
  onToggleEditMode: () => void;
  /** 페이지별 마스터 숨김 토글 — 호출 측이 togglePageHideMaster 로 커밋(실행취소 가능). */
  onToggleHideMaster: (pageId: string) => void;
  /** 마스터 요소 전체 삭제 — 실행취소 불가(패널이 2단계 확인으로 보호). */
  onClearMaster: () => void;
  /** 닫기 — 호출 측 규약: 패널이 닫히면 마스터 편집 모드도 함께 종료된다. */
  onClose: () => void;
};

export function StudioMasterPagePanel({
  editMode,
  masterCount,
  pages,
  currentPageId,
  onToggleEditMode,
  onToggleHideMaster,
  onClearMaster,
  onClose,
}: StudioMasterPagePanelProps) {
  // 마스터 비우기 2단계 확인 — 마스터 편집은 실행취소가 없어 실수 삭제를 막는다.
  const [confirmClear, setConfirmClear] = useState(false);

  // Esc 로 닫기 — 입력 필드 안의 Esc 는 방해하지 않는다(대사 패널과 동일 규약).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable)
      ) {
        return;
      }
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleClear = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setConfirmClear(false);
    onClearMaster();
  };

  return (
    <section
      aria-label="마스터 페이지 관리"
      className="absolute left-3 top-3 z-40 flex max-h-[calc(100%-5rem)] w-[min(19rem,calc(100%-1.5rem))] flex-col overflow-hidden rounded-xl border border-line bg-panel/95 shadow-xl backdrop-blur"
    >
      <div className="flex items-center justify-between gap-2 border-b border-line/60 px-3 py-2">
        <p className="flex items-center gap-1.5 text-xs font-bold text-fg">
          <LayoutTemplate size={13} className="shrink-0 text-fg-2" aria-hidden />
          마스터 페이지
          <span className="font-medium text-fg-3">요소 {masterCount}개</span>
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="마스터 페이지 패널 닫기"
          className="grid size-6 shrink-0 place-items-center rounded-lg border border-line text-fg-2 transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <X size={13} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-2.5">
        {/* 마스터 편집 모드 — 켜면 캔버스의 추가/편집이 전 페이지 공통(마스터)으로 커밋된다. */}
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={onToggleEditMode}
            aria-pressed={editMode}
            className={cn(
              "flex w-full items-center justify-center gap-1.5 rounded-lg border py-1.5 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
              editMode
                ? "border-accent bg-accent text-on-accent hover:opacity-90"
                : "border-line bg-card text-fg-2 hover:bg-raised"
            )}
          >
            {editMode ? "마스터 편집 종료" : "마스터 편집 시작"}
          </button>
          {editMode ? (
            <p
              role="status"
              className="rounded-lg border border-accent/40 bg-accent-soft/30 px-2 py-1.5 text-[0.72rem] leading-relaxed text-fg-2"
            >
              <span className="font-semibold text-accent">마스터 편집 중</span> — 지금 추가·편집하는
              요소는 모든 페이지 공통으로 저장돼요. 페이지의 일반 요소는 반투명 잠금 표시로만
              보여요.
            </p>
          ) : (
            <p className="text-[0.72rem] leading-relaxed text-fg-3">
              모든 페이지에 반복되는 로고·워터마크 문구·코너 장식을 한 번만 만들어 두는 공통
              레이어예요. 마스터 요소는 각 페이지의 배경 위, 일반 요소 아래에 깔려요.
            </p>
          )}
        </div>

        {/* 페이지별 숨김 — 표지처럼 마스터가 어울리지 않는 페이지만 끈다(실행취소 가능). */}
        <div className="space-y-1.5">
          <p className="text-[0.72rem] font-semibold text-fg-2">페이지별 표시</p>
          {masterCount === 0 && !editMode ? (
            <p className="rounded-lg border border-dashed border-line px-2 py-3 text-center text-[0.72rem] leading-relaxed text-fg-3">
              아직 마스터 요소가 없어요. 위의 &lsquo;마스터 편집 시작&rsquo;을 누르고 로고나 문구를
              추가해 보세요.
            </p>
          ) : (
            <ul className="space-y-1">
              {pages.map((p, idx) => (
                <li
                  key={p.id}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-lg border px-2 py-1",
                    p.id === currentPageId ? "border-accent/50 bg-accent-soft/20" : "border-line bg-card/45"
                  )}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="min-w-0 truncate text-[0.72rem] font-medium text-fg-2">
                      {pageDisplayName(p, idx)}
                    </span>
                    {p.id === currentPageId && (
                      <span className="shrink-0 rounded-full border border-accent/40 bg-accent-soft/40 px-1.5 text-[0.72rem] font-medium text-accent">
                        현재
                      </span>
                    )}
                  </span>
                  <label className="flex shrink-0 cursor-pointer items-center gap-1 text-[0.72rem] text-fg-3">
                    <input
                      type="checkbox"
                      checked={!p.hideMaster}
                      onChange={() => onToggleHideMaster(p.id)}
                      aria-label={`${pageDisplayName(p, idx)}에 마스터 표시`}
                      className="accent-accent"
                    />
                    표시
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 마스터 비우기 — 실행취소가 없어 2단계 확인으로 보호한다. */}
        <div className="space-y-1.5">
          {confirmClear && (
            <p role="alert" className="text-[0.72rem] leading-relaxed text-fg-2">
              마스터 요소 {masterCount}개를 모두 삭제할까요? 이 동작은 실행취소할 수 없어요.
            </p>
          )}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleClear}
              disabled={masterCount === 0}
              className={cn(
                "flex flex-1 items-center justify-center gap-1 rounded-lg border py-1.5 text-[0.72rem] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
                masterCount === 0
                  ? "cursor-not-allowed border-line bg-card text-fg-3 opacity-60"
                  : confirmClear
                    ? "border-red-500/60 bg-red-500/10 text-red-400 hover:bg-red-500/20"
                    : "border-line bg-card text-fg-2 hover:bg-raised"
              )}
            >
              <Trash2 size={12} aria-hidden />
              {confirmClear ? "정말 비우기" : "마스터 비우기"}
            </button>
            {confirmClear && (
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-[0.72rem] font-medium text-fg-2 transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                취소
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 정직 고지 — 지원 범위·한계를 그대로 밝힌다. */}
      <div className="space-y-0.5 border-t border-line/60 px-3 py-1.5 text-[0.72rem] leading-snug text-fg-3">
        <p>게시·다운로드·페이지 썸네일에 마스터가 함께 담겨요.</p>
        <p>마스터 편집은 실행취소(⌘Z)가 지원되지 않고, 그룹·알파 클리핑은 저장 시 해제돼요.</p>
        <p>패널을 닫으면 마스터 편집 모드도 함께 종료돼요.</p>
      </div>
    </section>
  );
}
