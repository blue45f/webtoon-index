// Krita 스타일 팝업 원형 색상 휠 — 캔버스를 길게 누르면 뜨는 최근 색 8개짜리 원형 퀵픽.
// 기하/히트테스트는 studio-color-wheel.ts(순수, Konva/DOM 의존 없음)에 위임하고, 이 컴포넌트는
// "열림 여부·중심점·색 목록을 받아 그리고, 골라진 색을 콜백으로 올려보내는" 표시 + 자체 완결
// 제스처(드래그-릴리즈 선택, 바깥 클릭/Esc 닫기)만 담당한다 — StudioColorPopover.tsx와 동일한
// "DOM 오버레이 + 문서 리스너로 자체 완결" 패턴을 그대로 따른다.
//
// 캔버스 제스처(언제 열지 판단하는 길게-누르기 타이머)는 이 컴포넌트의 책임이 아니다 — 그건
// StudioPage.tsx의 onStageDown/onStageMove/onStageUp이 소유한다(이 프로젝트의 확립된 원칙:
// "패널은 상태만 보여주고 캔버스 제스처는 상위가 처리"). 이 컴포넌트가 열린 뒤부터는 순수
// DOM 오버레이 영역이므로(더 이상 Konva Stage 위가 아님) 나머지 드래그·릴리즈·바깥클릭·Esc는
// 이 컴포넌트가 자체적으로 문서 리스너로 처리해도 그 원칙을 어기지 않는다.
//
// 브라우저 앱 안에서만 도는 컴포넌트라 document 직접 접근 OK(테스트 대상 아님 — 기하 로직은
// studio-color-wheel.test.ts가 커버한다).
import { useEffect, useRef, useState } from "react";

import { COLOR_WHEEL_SWATCH_RADIUS_PX, colorWheelSliceOffset, hitTestColorWheel, isKeyboardActivatedClick } from "./studio-color-wheel";

import { cx } from "@/shared/lib/cx";

export type StudioColorWheelOverlayProps = {
  /** 열림 여부 — false면 아무것도 렌더링하지 않는다. */
  open: boolean;
  /** 휠 중심(뷰포트 px, clientX/clientY 기준) — StudioPage가 long-press 지점에서 계산해 넘긴다. */
  center: { x: number; y: number } | null;
  /** 휠에 배치할 색(최대 8개) — 최근 사용 색에서 studio-color-wheel.selectWheelColors로 자른 결과. */
  colors: string[];
  /** 슬라이스가 선택됐을 때(드래그-릴리즈 또는 스와치 클릭) 호출 — 브러시 색 반영은 호출부 책임. */
  onSelect: (color: string) => void;
  /** 팝업이 닫혀야 할 때(선택 완료/취소/바깥 클릭/Esc) 호출 — open을 false로 내리는 건 호출부 책임. */
  onClose: () => void;
};

export function StudioColorWheelOverlay({ open, center, colors, onSelect, onClose }: StudioColorWheelOverlayProps): React.ReactElement | null {
  const rootRef = useRef<HTMLDivElement>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // 열릴 때마다 하이라이트를 초기화 — 이전에 열렸을 때의 잔상이 다음 오픈에 남지 않게 한다.
  useEffect(() => {
    if (open) setHoveredIndex(null);
  }, [open]);

  // 바깥 mousedown이면 선택 없이 닫는다 — StudioColorPopover.tsx의 동일 패턴(컨테인 여부로 판정,
  // stopPropagation에 의존하지 않음).
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open, onClose]);

  // Esc로 선택 없이 닫기.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open || !center || colors.length === 0) return null;

  const total = colors.length;

  const resolveHit = (clientX: number, clientY: number) => hitTestColorWheel(clientX - center.x, clientY - center.y, total);

  // 누른 채로 끄는 동안 겨냥 중인 슬라이스를 하이라이트만 한다(선택은 릴리즈 시점에 확정).
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const hit = resolveHit(e.clientX, e.clientY);
    setHoveredIndex(hit.kind === "slice" ? hit.index : null);
  };

  // 릴리즈 시점에 최종 판정 — slice면 선택+닫기, cancel이면 선택 없이 닫기, none(중심
  // 데드존)이면 아무 것도 안 하고 열린 채로 유지해 스와치 직접 클릭 폴백으로 이어지게 한다.
  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const hit = resolveHit(e.clientX, e.clientY);
    if (hit.kind === "slice") {
      onSelect(colors[hit.index]);
      onClose();
    } else if (hit.kind === "cancel") {
      onClose();
    }
    setHoveredIndex(null);
  };

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-[70]"
      style={{ touchAction: "none" }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      role="menu"
      aria-label="최근 사용 색 빠른 선택"
    >
      <div className="absolute" style={{ left: center.x, top: center.y }}>
        {/* 중심 기준점 — 순수 시각적 표식(클릭 불가), 데드존 크기를 눈으로 가늠하게 해준다. */}
        <span className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg/40" />
        {colors.map((c, i) => {
          const offset = colorWheelSliceOffset(i, total, COLOR_WHEEL_SWATCH_RADIUS_PX);
          const active = hoveredIndex === i;
          return (
            <button
              key={`${c}-${i}`}
              type="button"
              role="menuitem"
              title={c}
              aria-label={`최근 색 ${c} 선택`}
              onClick={(e) => {
                // 포인터 클릭은 이미 부모 div로 버블링된 pointerup에서 처리됐다 — 여기서는
                // 키보드 활성화(Enter/Space)만 처리한다. isKeyboardActivatedClick 상세 근거는
                // studio-color-wheel.ts 참고.
                if (!isKeyboardActivatedClick(e.detail)) return;
                onSelect(c);
                onClose();
              }}
              className={cx(
                "absolute size-9 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full border-2 shadow-lg transition-transform",
                active ? "scale-125 border-accent" : "border-line"
              )}
              style={{ left: offset.x, top: offset.y, background: c }}
            />
          );
        })}
      </div>
    </div>
  );
}
