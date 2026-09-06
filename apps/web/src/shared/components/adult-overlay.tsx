import { ShieldAlert } from "lucide-react";

import { useApp, useHydrated } from "@/shared/lib/store";

// 19금 표지 게이트 — 미인증 시 블러 + 성인 인증 버튼. 인증되면 사라짐.
// (자가 인증 방식의 옵션 기능. 실제 신원확인이 아닌 만 19세 이상 확인.)
// hasCover=false(실제 썸네일 없이 타이포 표지)면 가릴 실제 이미지가 없으므로 연령 확인 버튼 없이
// 19+ 표시만 한다.
export function AdultOverlay({ compact = false, hasCover = true }: { compact?: boolean; hasCover?: boolean }) {
  const hydrated = useHydrated();
  const verified = useApp((s) => s.adultVerified);
  const openAgeGate = useApp((s) => s.openAgeGate);

  if (hydrated && verified) return null;
  const showButton = hasCover && !compact;

  return (
    // 프레젠테이션용 클릭 차단막 — 게이트 중 하단 카드/링크로 클릭이 전파되지 않게만 막는다.
    // 호출 가능한 동작이 없는 마우스 전용 가드라 role/keydown은 의미가 없다(키보드는 전파시킬 클릭 자체가 없음).
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div
      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-1.5 rounded-[inherit] border border-[oklch(0.95_0.01_85/0.12)] bg-[oklch(0.14_0.012_70/0.74)] text-center backdrop-blur-xl"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <ShieldAlert className="text-bad" size={compact ? 16 : 24} />
      {!compact && <span className="text-xs font-bold text-[oklch(0.95_0.01_85/0.9)]">19세 이상</span>}
      {showButton && (
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            openAgeGate();
          }}
          className="mt-0.5 rounded-lg border border-[oklch(0.95_0.01_85/0.24)] bg-[oklch(0.95_0.01_85/0.1)] px-2.5 py-1 text-[0.7rem] font-medium text-[oklch(0.95_0.01_85)] transition-colors hover:bg-[oklch(0.95_0.01_85/0.18)]"
        >
          연령 확인
        </button>
      )}
      {compact && <span className="text-[0.55rem] font-semibold text-[oklch(0.95_0.01_85/0.8)]">19+</span>}
    </div>
  );
}
