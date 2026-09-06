/**
 * StudioLayerCompsPanel.tsx
 *
 * CLIP STUDIO PAINT Ver.3.0 & Ver.4.0 Parity:
 * - Layer Comps (레이어 콤프 / 레이어 표시 상태 세트):
 *   - Allows webtoon creators to capture, switch, and export different layer visibility/opacity setups:
 *     - Lineart-only (선화 검토용)
 *     - Flat colors (밑색 및 배색용)
 *     - Full render with background (완성본)
 *     - Clean textless version (식자 제거 클린본 — 굿즈/해외수출용)
 *     - Day/Night lighting mood variations (시간대별 조명 변형)
 *   - One-click apply, state synchronization, and batch export planning.
 */

import {
  Bookmark,
  Check,
  Download,
  Eye,
  FolderSync,
  Layers,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import {
  captureLayerComp,
  planLayerCompsBatchExport,
  updateLayerCompWithCurrentLayers,
  type StudioLayerComp,
  type StudioLayerLikeItem,
} from "./studio-layer-comps";

import { buttonClass } from "@/shared/components/ui/button-utils";
import { cn } from "@/shared/lib/utils";

export interface StudioLayerCompsPanelProps<T extends StudioLayerLikeItem = StudioLayerLikeItem> {
  readonly layers: readonly T[];
  readonly comps?: readonly StudioLayerComp[];
  readonly activeCompId?: string | null;
  readonly onApplyComp: (comp: StudioLayerComp) => void;
  readonly onCompsChange?: (nextComps: readonly StudioLayerComp[]) => void;
  readonly onBatchExportPlan?: (
    plan: ReturnType<typeof planLayerCompsBatchExport>,
  ) => void;
  readonly className?: string;
}

export function StudioLayerCompsPanel<T extends StudioLayerLikeItem = StudioLayerLikeItem>({
  layers,
  comps,
  activeCompId = null,
  onApplyComp,
  onCompsChange,
  onBatchExportPlan,
  className,
}: StudioLayerCompsPanelProps<T>) {
  const [internalComps, setInternalComps] = useState<readonly StudioLayerComp[]>([]);
  const effectiveComps = comps ?? internalComps;

  const updateComps = (next: readonly StudioLayerComp[]) => {
    if (onCompsChange) {
      onCompsChange(next);
    } else {
      setInternalComps(next);
    }
  };

  const [newCompName, setNewCompName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [editingCompId, setEditingCompId] = useState<string | null>(null);
  const [editNameText, setEditNameText] = useState("");

  const handleCreateComp = () => {
    const trimmed = newCompName.trim();
    const defaultName = `콤프 ${effectiveComps.length + 1}`;
    const nameToUse = trimmed || defaultName;
    const newComp = captureLayerComp(nameToUse, layers);
    updateComps([...effectiveComps, newComp]);
    setNewCompName("");
    setIsCreating(false);
  };

  const handleUpdateComp = (compId: string) => {
    const target = effectiveComps.find((c) => c.id === compId);
    if (!target) return;
    const updated = updateLayerCompWithCurrentLayers(target, layers);
    updateComps(effectiveComps.map((c) => (c.id === compId ? updated : c)));
  };

  const handleDeleteComp = (compId: string) => {
    updateComps(effectiveComps.filter((c) => c.id !== compId));
    if (editingCompId === compId) {
      setEditingCompId(null);
    }
  };

  const handleSaveRename = () => {
    if (!editingCompId) return;
    const trimmed = editNameText.trim();
    if (trimmed) {
      updateComps(
        effectiveComps.map((c) =>
          c.id === editingCompId ? { ...c, name: trimmed } : c,
        ),
      );
    }
    setEditingCompId(null);
  };

  const handleBatchExport = () => {
    if (effectiveComps.length === 0 || !onBatchExportPlan) return;
    const plan = planLayerCompsBatchExport(effectiveComps, "webtoon_cut", "png");
    onBatchExportPlan(plan);
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-3 p-3 text-xs bg-slate-900/90 text-slate-100 rounded-lg border border-slate-800 shadow-xl",
        className,
      )}
      data-testid="studio-layer-comps-panel"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <div className="flex items-center gap-1.5 font-semibold text-slate-200">
          <Bookmark size={15} className="text-indigo-400" />
          <span>레이어 콤프 (Layer Comps)</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-medium">
            CSP 3.0
          </span>
        </div>
        <button
          type="button"
          onClick={() => setIsCreating(!isCreating)}
          className={buttonClass({
            size: "sm",
            variant: "ghost",
            className: "h-6 px-2 text-[11px] gap-1 text-slate-300 hover:text-white",
          })}
          title="새 콤프 캡처"
        >
          <Plus size={13} />
          <span>새 콤프</span>
        </button>
      </div>

      {/* Description / Guide */}
      <p className="text-[11px] text-slate-400 leading-relaxed">
        선화, 밑색, 텍스트 유무, 조명 변화 등 다양한 레이어 표시 상태를 저장하고
        원클릭으로 전환하거나 일괄 내보냅니다.
      </p>

      {/* Creation Row */}
      {isCreating && (
        <div className="flex items-center gap-1.5 bg-slate-800/80 p-2 rounded border border-indigo-500/40">
          <input
            type="text"
            value={newCompName}
            onChange={(e) => setNewCompName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateComp();
              if (e.key === "Escape") setIsCreating(false);
            }}
            placeholder="콤프 이름 (예: 대사 없는 클린본)"
            className="flex-1 bg-slate-950 px-2 py-1 rounded text-slate-200 text-xs border border-slate-700 focus:outline-none focus:border-indigo-400"
          />
          <button
            type="button"
            onClick={handleCreateComp}
            className={buttonClass({
              size: "sm",
              variant: "solid",
              className: "h-6 px-2 text-[11px] bg-indigo-600 hover:bg-indigo-500 text-white",
            })}
          >
            저장
          </button>
        </div>
      )}

      {/* Comps List */}
      <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto pr-0.5">
        {effectiveComps.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-4 text-center border border-dashed border-slate-800 rounded bg-slate-950/40">
            <Layers size={22} className="text-slate-600 mb-1" />
            <span className="text-[11px] text-slate-500">
              저장된 레이어 콤프가 없습니다.
            </span>
            <span className="text-[10px] text-slate-600 mt-0.5">
              현재 레이어 상태를 새 콤프로 캡처해보세요.
            </span>
          </div>
        ) : (
          effectiveComps.map((comp) => {
            const isActive = comp.id === activeCompId;
            const visibleCount = Object.values(comp.layerStates).filter(
              (s) => s.visible,
            ).length;
            const totalCount = Object.keys(comp.layerStates).length;

            return (
              <div
                key={comp.id}
                className={cn(
                  "flex items-center justify-between p-2 rounded border transition-colors group",
                  isActive
                    ? "bg-indigo-950/40 border-indigo-500/60 text-white"
                    : "bg-slate-800/40 border-slate-800/80 hover:bg-slate-800 hover:border-slate-700 text-slate-300",
                )}
              >
                {editingCompId === comp.id ? (
                  <div className="flex items-center gap-1.5 flex-1 mr-2">
                    <input
                      type="text"
                      value={editNameText}
                      onChange={(e) => setEditNameText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveRename();
                        if (e.key === "Escape") setEditingCompId(null);
                      }}
                      className="w-full bg-slate-950 px-2 py-0.5 rounded text-xs border border-indigo-400 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleSaveRename}
                      className="text-indigo-300 hover:text-white p-1"
                    >
                      <Check size={13} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="flex flex-col flex-1 text-left cursor-pointer select-none bg-transparent p-0 m-0 border-0 text-inherit focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-400 rounded"
                    onClick={() => onApplyComp(comp)}
                  >
                    <div className="flex items-center gap-1.5">
                      {isActive && (
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
                      )}
                      <span className="font-medium text-[12px]">{comp.name}</span>
                    </div>
                    <span className="text-[10px] text-slate-500 mt-0.5">
                      표시 레이어 {visibleCount} / {totalCount}개
                    </span>
                  </button>
                )}

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => onApplyComp(comp)}
                    className={buttonClass({
                      size: "sm",
                      variant: isActive ? "solid" : "outline",
                      className: cn(
                        "h-6 px-2 text-[11px] gap-1",
                        isActive
                          ? "bg-indigo-600 text-white"
                          : "border-slate-700 hover:bg-slate-700 text-slate-300",
                      ),
                    })}
                    title="이 콤프 적용"
                  >
                    <Eye size={12} />
                    <span>적용</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleUpdateComp(comp.id)}
                    className="p-1 text-slate-400 hover:text-amber-300 transition-colors"
                    title="현재 레이어 상태로 업데이트"
                  >
                    <FolderSync size={13} />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setEditingCompId(comp.id);
                      setEditNameText(comp.name);
                    }}
                    className="p-1 text-slate-400 hover:text-slate-200 transition-colors"
                    title="이름 수정"
                  >
                    <Pencil size={12} />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDeleteComp(comp.id)}
                    className="p-1 text-slate-400 hover:text-red-400 transition-colors"
                    title="콤프 삭제"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Batch Export Footer */}
      {effectiveComps.length > 0 && onBatchExportPlan && (
        <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
          <span className="text-[11px] text-slate-400">
            총 {effectiveComps.length}개 상태 콤프
          </span>
          <button
            type="button"
            onClick={handleBatchExport}
            className={buttonClass({
              size: "sm",
              variant: "outline",
              className: "h-6 px-2 text-[11px] gap-1.5 text-indigo-300 border-indigo-800/60 hover:bg-indigo-950/40",
            })}
          >
            <Download size={12} />
            <span>콤프 일괄 내보내기</span>
          </button>
        </div>
      )}
    </div>
  );
}
