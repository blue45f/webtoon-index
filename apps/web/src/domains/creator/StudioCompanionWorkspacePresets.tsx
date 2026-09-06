import { Check, Images, ListChecks, Map, Paintbrush } from "lucide-react";

import { cn } from "@/shared/lib/utils";

export type StudioCompanionWorkspacePresetId =
  | "draw"
  | "navigate"
  | "review"
  | "reference";

export interface StudioCompanionWorkspacePresetsProps {
  disabled: boolean;
  activePreset: StudioCompanionWorkspacePresetId | null;
  onApplyPreset: (preset: StudioCompanionWorkspacePresetId) => void;
}

const PRESETS: ReadonlyArray<{
  description: string;
  icon: typeof Paintbrush;
  id: StudioCompanionWorkspacePresetId;
  label: string;
  primaryRole: string;
  secondaryRole: string;
}> = [
  {
    id: "draw",
    label: "작화 집중",
    description: "기본 화면은 캔버스만, 보조 화면은 도구 전용",
    primaryRole: "캔버스만",
    secondaryRole: "도구",
    icon: Paintbrush,
  },
  {
    id: "navigate",
    label: "전체 탐색",
    description: "캔버스는 넓게 두고 전체 원고를 Navigator로 확인",
    primaryRole: "캔버스만",
    secondaryRole: "Navigator",
    icon: Map,
  },
  {
    id: "review",
    label: "검수",
    description: "기본 화면은 평소 배치, 보조 화면은 레이어·댓글 검수",
    primaryRole: "기본 배치",
    secondaryRole: "검수",
    icon: ListChecks,
  },
  {
    id: "reference",
    label: "레퍼런스 집중",
    description: "캔버스는 넓게 유지하고 참고 이미지와 색상 피커를 별도 창에 고정",
    primaryRole: "캔버스만",
    secondaryRole: "레퍼런스",
    icon: Images,
  },
];

export function StudioCompanionWorkspacePresets({
  disabled,
  activePreset,
  onApplyPreset,
}: StudioCompanionWorkspacePresetsProps) {
  return (
    <section aria-labelledby="companion-workspace-presets-title" className="space-y-2">
      <div>
        <h2 id="companion-workspace-presets-title" className="text-xs font-semibold text-fg-2">
          멀티 화면 빠른 배치
        </h2>
        <p className="mt-0.5 text-[0.68rem] leading-relaxed text-fg-3">
          작업 단계에 맞춰 기본 화면과 전용 창의 역할을 한 번에 고릅니다.
        </p>
      </div>

      <div
        role="group"
        aria-label="멀티 화면 빠른 배치 프리셋"
        className="grid grid-cols-1 gap-1.5 min-[480px]:grid-cols-2"
      >
        {PRESETS.map(({ description, icon: Icon, id, label, primaryRole, secondaryRole }) => {
          const active = activePreset === id;

          return (
            <button
              key={id}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              onClick={() => onApplyPreset(id)}
              className={cn(
                "group flex min-h-14 w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left outline-none",
                "transition-[border-color,background-color,box-shadow,color] duration-200 ease-out-expo motion-reduce:transition-none",
                "focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-panel",
                "disabled:cursor-not-allowed disabled:opacity-45",
                active
                  ? "border-accent/55 bg-accent-soft text-fg ring-1 ring-accent/20"
                  : "border-line/70 bg-card text-fg-2 hover:border-line-strong hover:bg-raised hover:text-fg"
              )}
            >
              <span
                className={cn(
                  "grid size-10 shrink-0 place-items-center rounded-lg border transition-colors duration-200 motion-reduce:transition-none",
                  active
                    ? "border-accent bg-accent text-on-accent"
                    : "border-line bg-raised text-fg-2 group-hover:text-fg"
                )}
              >
                <Icon className="size-4" aria-hidden />
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-2">
                  <strong className="truncate text-xs font-semibold">{label}</strong>
                  <span className="flex shrink-0 items-center gap-1 text-[0.61rem] font-medium text-fg-3">
                    <span className="rounded-md bg-raised px-1.5 py-0.5">{primaryRole}</span>
                    <span aria-hidden>+</span>
                    <span className="rounded-md bg-raised px-1.5 py-0.5">{secondaryRole}</span>
                  </span>
                </span>
                <span className="mt-0.5 block line-clamp-2 text-[0.66rem] leading-relaxed text-fg-3">
                  {description}
                </span>
              </span>

              <span
                aria-hidden
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded-full border transition-colors duration-200 motion-reduce:transition-none",
                  active ? "border-accent bg-accent text-on-accent" : "border-line text-transparent"
                )}
              >
                <Check className="size-3" />
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export default StudioCompanionWorkspacePresets;
