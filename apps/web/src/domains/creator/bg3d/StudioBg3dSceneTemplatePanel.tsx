// "3D 배경" 도구의 씬 템플릿 피커 — StudioBackground3D.tsx "도형" 탭의 복합 오브젝트 프리셋 그리드와
// 같은 패턴(카테고리 칩 + 카드 그리드)을 쓰되, 한 항목이 건물 한 채가 아니라 "교실"·"거리"처럼 이미
// 여러 프리셋이 배치된 완성된 공간이라는 차이가 있다. 프레젠테이션 전용(무상태) — 카테고리 선택 상태와
// "추가" 액션은 모두 부모(StudioBackground3D.tsx)가 소유한다(설계 문서 §2 통합 지점 참고).
import {
  Building2,
  Coffee,
  Layers,
  LocateFixed,
  Move,
  RotateCcw,
  Trash2,
  Trees,
} from "lucide-react";
import { useEffect, useState } from "react";

import type { BgCompositePreset } from "../studio-background-3d-composites";
import type {
  BgSceneTemplate,
  BgSceneTemplateCategory,
} from "../studio-background-3d-scene-templates";

import { cx } from "@/shared/lib/cx";

// 템플릿마다 손으로 아이콘을 지정하는 대신 카테고리 단위로만 아이콘을 준다(교실/카페처럼 실내형
// 템플릿이 늘어도 카테고리에 맞는 아이콘을 그대로 재사용할 수 있도록 — COMPOSITE_CATEGORY 칩이
// 아이콘 없이 텍스트만 쓰는 것과 달리, 씬 템플릿 카드는 설명 텍스트가 길어 아이콘으로 스캔성을 보강).
const CATEGORY_ICON: Record<BgSceneTemplateCategory, typeof Building2> = {
  interior: Coffee,
  urban: Building2,
  nature: Trees,
};

// 카드 대표 스와치 색 — 템플릿의 첫 배치가 primitive면 그 color, composite면 참조한 프리셋의
// parts[0].color(복합 프리셋 그리드가 이미 쓰는 "앵커 파츠 색" 관례와 동일). 못 찾으면 중립 회색.
function templatePreviewColor(
  template: BgSceneTemplate,
  compositePresets: readonly BgCompositePreset[],
): string {
  const first = template.placements[0];
  if (!first) return "#9aa0a6";
  if (first.type === "primitive") return first.color;
  const preset = compositePresets.find((p) => p.id === first.presetId);
  return preset?.parts[0]?.color ?? "#9aa0a6";
}

// 오브젝트(=최종 BgPrimitive) 개수 근사치 — instantiateSceneTemplate을 실제로 돌리지 않고도(순수
// 프레젠테이션 컴포넌트에서 부수효과 없이) 카드에 "대략 몇 개짜리 배치인지" 보여주기 위한 집계.
function estimatedObjectCount(
  template: BgSceneTemplate,
  compositePresets: readonly BgCompositePreset[],
): number {
  return template.placements.reduce((sum, placement) => {
    if (placement.type === "primitive") return sum + 1;
    const preset = compositePresets.find((p) => p.id === placement.presetId);
    return sum + (preset?.parts.length ?? 0);
  }, 0);
}

export interface StudioBg3dSceneTemplatePanelProps {
  templates: readonly BgSceneTemplate[];
  templateCategories: readonly BgSceneTemplateCategory[];
  templateCategoryLabels: Readonly<Record<BgSceneTemplateCategory, string>>;
  compositePresets: readonly BgCompositePreset[];
  /** null = 전체 카테고리. StudioBackground3D.tsx의 compositeCategory와 동형인 별도 상태(설계 문서 §2). */
  activeCategory: BgSceneTemplateCategory | null;
  onCategoryChange: (category: BgSceneTemplateCategory | null) => void;
  /** 카드를 클릭하면 템플릿 id로 호출됨 — 실제 instantiateSceneTemplate 호출/primitives 배열 반영은 부모 책임. */
  onAddTemplate: (templateId: string) => void;
  templateInstances: readonly StudioBg3dTemplateInstanceSummary[];
  organizationDisabledReason: string | null;
  onSelectTemplateInstance: (instanceId: string) => void;
  onSelectAllTemplateInstances: () => void;
  onGroundTemplateInstance: (instanceId: string) => void;
  onArrangeAllTemplateInstances: () => void;
  onResetTemplateInstance: (instanceId: string) => void;
  onResetAllTemplateInstances: () => void;
  onDeleteTemplateInstance: (instanceId: string) => void;
  onDeleteAllTemplateInstances: () => void;
}

export interface StudioBg3dTemplateInstanceSummary {
  readonly id: string;
  readonly label: string;
  readonly sourceKind: "catalog" | "user";
  readonly nodeCount: number;
  readonly lockedNodeCount: number;
  readonly selected: boolean;
  readonly resetAvailable: boolean;
  readonly sourceAvailable: boolean;
}

type StudioBg3dTemplatePendingDelete =
  | { readonly kind: "instance"; readonly id: string }
  | { readonly kind: "all"; readonly membershipSignature: string };

function templateInstanceMembershipSignature(
  instances: readonly StudioBg3dTemplateInstanceSummary[],
): string {
  return JSON.stringify(instances.map((instance) => instance.id).sort());
}

export function StudioBg3dSceneTemplatePanel({
  templates,
  templateCategories,
  templateCategoryLabels,
  compositePresets,
  activeCategory,
  onCategoryChange,
  onAddTemplate,
  templateInstances,
  organizationDisabledReason,
  onSelectTemplateInstance,
  onSelectAllTemplateInstances,
  onGroundTemplateInstance,
  onArrangeAllTemplateInstances,
  onResetTemplateInstance,
  onResetAllTemplateInstances,
  onDeleteTemplateInstance,
  onDeleteAllTemplateInstances,
}: StudioBg3dSceneTemplatePanelProps) {
  const visibleTemplates = templates.filter((t) => activeCategory === null || t.category === activeCategory);
  const [pendingDelete, setPendingDelete] =
    useState<StudioBg3dTemplatePendingDelete | null>(null);
  const templateMembershipSignature = templateInstanceMembershipSignature(templateInstances);
  const organizationDisabled = organizationDisabledReason !== null;
  const allArrangeAvailable = templateInstances.length > 0 &&
    templateInstances.every((instance) => instance.lockedNodeCount === 0);
  const allResetAvailable = templateInstances.length > 0 &&
    templateInstances.every((instance) => instance.resetAvailable);

  useEffect(() => {
    if (
      pendingDelete !== null &&
      (
        pendingDelete.kind === "all"
          ? pendingDelete.membershipSignature !== templateMembershipSignature
          : !templateInstances.some((instance) => instance.id === pendingDelete.id)
      )
    ) {
      setPendingDelete(null);
    }
  }, [pendingDelete, templateInstances, templateMembershipSignature]);

  const runInstanceAction = (
    action: (instanceId: string) => void,
    instanceId: string,
  ) => {
    setPendingDelete(null);
    action(instanceId);
  };

  return (
    <div>
      <p className="mb-2.5 text-[0.68rem] leading-relaxed text-fg-3">
        건물·나무·소품 여러 개가 이미 자연스럽게 배치된 완성형 공간을 한 번에 추가합니다. 추가한 뒤에도 각 부품을 따로 선택해 다듬을 수 있어요.
      </p>

      <div className="mb-2.5 flex flex-wrap gap-1.5">
        <button
          type="button"
          className={cx(
            "rounded-full border px-2.5 py-1 text-[0.68rem] font-semibold transition-colors",
            activeCategory === null ? "border-accent/60 bg-accent-soft text-accent" : "border-line bg-card text-fg-3 hover:bg-raised hover:text-fg"
          )}
          onClick={() => onCategoryChange(null)}
        >
          전체
        </button>
        {templateCategories.map((cat) => (
          <button
            key={cat}
            type="button"
            className={cx(
              "rounded-full border px-2.5 py-1 text-[0.68rem] font-semibold transition-colors",
              activeCategory === cat ? "border-accent/60 bg-accent-soft text-accent" : "border-line bg-card text-fg-3 hover:bg-raised hover:text-fg"
            )}
            onClick={() => onCategoryChange(cat)}
          >
            {templateCategoryLabels[cat]}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {visibleTemplates.map((template) => {
          const CategoryIcon = CATEGORY_ICON[template.category];
          return (
            <button
              key={template.id}
              type="button"
              className="flex w-full items-start gap-2.5 rounded-lg border border-line bg-card px-3 py-2.5 text-left transition-colors hover:border-accent/50 hover:bg-raised"
              onClick={() => onAddTemplate(template.id)}
            >
              <span
                className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md border border-line/70"
                style={{ backgroundColor: templatePreviewColor(template, compositePresets) }}
                aria-hidden
              >
                <CategoryIcon size={15} className="text-white/85 mix-blend-luminosity" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-fg">
                  {template.label}
                  <span className="rounded-full bg-panel px-1.5 py-0.5 text-[0.6rem] font-medium text-fg-3">오브젝트 {estimatedObjectCount(template, compositePresets)}개</span>
                </span>
                <span className="mt-0.5 block text-[0.66rem] leading-snug text-fg-3">{template.description}</span>
              </span>
            </button>
          );
        })}
        {visibleTemplates.length === 0 ? <p className="py-4 text-center text-[0.68rem] text-fg-3">이 카테고리에는 아직 템플릿이 없어요.</p> : null}
      </div>

      <section className="mt-5 border-t border-line pt-4" aria-labelledby="bg3d-template-organizer-title">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h4 id="bg3d-template-organizer-title" className="flex items-center gap-1.5 text-xs font-bold text-fg">
            <Layers size={14} className="text-accent" aria-hidden />
            추가된 템플릿 정리
          </h4>
          <span className="rounded-full border border-line bg-card px-2 py-1 text-[0.62rem] font-semibold text-fg-3">
            {templateInstances.length}개 묶음
          </span>
        </div>
        <p className="mb-3 text-[0.66rem] leading-relaxed text-fg-3">
          템플릿 부품을 한 묶음으로 선택하거나, 바닥에 붙이고 묶음 사이를 1m 간격으로 정돈할 수 있어요.
        </p>

        {organizationDisabledReason ? (
          <p role="status" className="mb-3 rounded-lg border border-line bg-card/70 px-2.5 py-2 text-[0.65rem] leading-relaxed text-fg-3">
            {organizationDisabledReason}
          </p>
        ) : null}

        {templateInstances.length > 0 ? (
          <>
            <div className="mb-3 grid grid-cols-2 gap-1.5" role="group" aria-label="모든 템플릿 정리">
              <button
                type="button"
                className="inline-flex min-h-11 items-center justify-center gap-1 rounded-lg border border-line bg-card px-2 text-[0.66rem] font-semibold text-fg-2 transition-colors hover:bg-raised hover:text-fg disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9"
                disabled={organizationDisabled}
                onClick={() => { setPendingDelete(null); onSelectAllTemplateInstances(); }}
              >
                <Layers size={13} aria-hidden />
                전체 선택
              </button>
              <button
                type="button"
                className="inline-flex min-h-11 items-center justify-center gap-1 rounded-lg border border-line bg-card px-2 text-[0.66rem] font-semibold text-fg-2 transition-colors hover:bg-raised hover:text-fg disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9"
                disabled={organizationDisabled || !allArrangeAvailable}
                title={!allArrangeAvailable ? "잠긴 템플릿 객체의 잠금을 먼저 해제해 주세요." : undefined}
                onClick={() => { setPendingDelete(null); onArrangeAllTemplateInstances(); }}
              >
                <Move size={13} aria-hidden />
                바닥 · 간격 정돈
              </button>
              <button
                type="button"
                className="inline-flex min-h-11 items-center justify-center gap-1 rounded-lg border border-line bg-card px-2 text-[0.66rem] font-semibold text-fg-2 transition-colors hover:bg-raised hover:text-fg disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9"
                disabled={organizationDisabled || !allResetAvailable}
                title={!allResetAvailable ? "원본을 찾을 수 없거나 잠긴 템플릿이 있습니다." : undefined}
                onClick={() => { setPendingDelete(null); onResetAllTemplateInstances(); }}
              >
                <RotateCcw size={13} aria-hidden />
                전체 원래 배치
              </button>
              <button
                type="button"
                className={cx(
                  "inline-flex min-h-11 items-center justify-center gap-1 rounded-lg border px-2 text-[0.66rem] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9",
                  pendingDelete?.kind === "all"
                    && pendingDelete.membershipSignature === templateMembershipSignature
                    ? "border-danger/60 bg-danger/10 text-danger"
                    : "border-line bg-card text-fg-2 hover:border-danger/50 hover:text-danger",
                )}
                disabled={organizationDisabled}
                onClick={() => {
                  if (
                    pendingDelete?.kind === "all"
                    && pendingDelete.membershipSignature === templateMembershipSignature
                  ) {
                    setPendingDelete(null);
                    onDeleteAllTemplateInstances();
                    return;
                  }
                  setPendingDelete({
                    kind: "all",
                    membershipSignature: templateMembershipSignature,
                  });
                }}
              >
                <Trash2 size={13} aria-hidden />
                {pendingDelete?.kind === "all"
                  && pendingDelete.membershipSignature === templateMembershipSignature
                  ? "전체 삭제 확인"
                  : "전체 삭제"}
              </button>
            </div>

            <div className="space-y-2" aria-label="추가된 템플릿 묶음">
              {templateInstances.map((instance) => {
                const confirmingDelete = pendingDelete?.kind === "instance"
                  && pendingDelete.id === instance.id;
                const resetUnavailableReason = instance.lockedNodeCount > 0
                  ? `잠긴 객체 ${instance.lockedNodeCount}개의 잠금을 먼저 해제해 주세요.`
                  : !instance.sourceAvailable
                    ? "템플릿 원본을 찾을 수 없어 원래 배치로 초기화할 수 없습니다."
                    : "템플릿 묶음 구조가 손상되어 원래 배치로 초기화할 수 없습니다.";
                return (
                  <article
                    key={instance.id}
                    className={cx(
                      "rounded-lg border bg-card/70 p-2.5",
                      instance.selected ? "border-accent/60 ring-1 ring-accent/20" : "border-line",
                    )}
                  >
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold text-fg">{instance.label}</p>
                        <p className="mt-0.5 text-[0.62rem] text-fg-3">
                          {instance.sourceKind === "catalog" ? "기본 씬" : "내 템플릿"} · 오브젝트 {instance.nodeCount}개
                          {instance.lockedNodeCount > 0 ? ` · 잠김 ${instance.lockedNodeCount}개` : ""}
                        </p>
                      </div>
                      {instance.selected ? (
                        <span className="shrink-0 rounded-full bg-accent-soft px-1.5 py-0.5 text-[0.6rem] font-bold text-accent">
                          묶음 선택됨
                        </span>
                      ) : null}
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        className="inline-flex min-h-11 items-center justify-center gap-1 rounded-md border border-line bg-panel px-2 text-[0.64rem] font-semibold text-fg-2 hover:bg-raised disabled:opacity-50 sm:min-h-9"
                        disabled={organizationDisabled}
                        onClick={() => runInstanceAction(onSelectTemplateInstance, instance.id)}
                      >
                        <Layers size={12} aria-hidden /> 묶음 선택
                      </button>
                      <button
                        type="button"
                        className="inline-flex min-h-11 items-center justify-center gap-1 rounded-md border border-line bg-panel px-2 text-[0.64rem] font-semibold text-fg-2 hover:bg-raised disabled:opacity-50 sm:min-h-9"
                        disabled={organizationDisabled || instance.lockedNodeCount > 0}
                        title={instance.lockedNodeCount > 0 ? "잠긴 최상위 객체를 먼저 해제해 주세요." : undefined}
                        onClick={() => runInstanceAction(onGroundTemplateInstance, instance.id)}
                      >
                        <LocateFixed size={12} aria-hidden /> 바닥 접지
                      </button>
                      <button
                        type="button"
                        className="inline-flex min-h-11 items-center justify-center gap-1 rounded-md border border-line bg-panel px-2 text-[0.64rem] font-semibold text-fg-2 hover:bg-raised disabled:opacity-50 sm:min-h-9"
                        disabled={organizationDisabled || !instance.resetAvailable}
                        title={!instance.resetAvailable ? resetUnavailableReason : undefined}
                        onClick={() => runInstanceAction(onResetTemplateInstance, instance.id)}
                      >
                        <RotateCcw size={12} aria-hidden /> 원래 배치
                      </button>
                      <button
                        type="button"
                        className={cx(
                          "inline-flex min-h-11 items-center justify-center gap-1 rounded-md border px-2 text-[0.64rem] font-semibold disabled:opacity-50 sm:min-h-9",
                          confirmingDelete
                            ? "border-danger/60 bg-danger/10 text-danger"
                            : "border-line bg-panel text-fg-2 hover:border-danger/50 hover:text-danger",
                        )}
                        disabled={organizationDisabled}
                        onClick={() => {
                          if (confirmingDelete) {
                            setPendingDelete(null);
                            onDeleteTemplateInstance(instance.id);
                            return;
                          }
                          setPendingDelete({ kind: "instance", id: instance.id });
                        }}
                      >
                        <Trash2 size={12} aria-hidden />
                        {confirmingDelete ? "묶음 삭제 확인" : "묶음 삭제"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        ) : (
          <p className="rounded-lg border border-dashed border-line bg-card/40 px-3 py-3 text-center text-[0.66rem] leading-relaxed text-fg-3">
            추적 가능한 템플릿 배치가 없습니다. 새 씬 템플릿이나 내 템플릿을 추가하면 이곳에서 한 묶음으로 정리할 수 있어요.
          </p>
        )}
      </section>
    </div>
  );
}
