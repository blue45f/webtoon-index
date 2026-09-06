import { Download, Loader2, Sparkles, Trash2, Upload } from "lucide-react";
import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";

import { confirmStudioDestructiveAction } from "../studio-destructive-action-preview";
import { studioDeletePoseMaterialRequest } from "../studio-destructive-command-catalog";
import {
  STUDIO_POSE_SCOPES,
  isStudioHumanoidBoneInScope,
  type StudioPoseScope,
} from "../studio-humanoid-bones";
import {
  STUDIO_POSE_MATERIAL_MAX_NAME_LENGTH,
  serializeStudioPoseMaterial,
  type StudioPoseMaterial,
} from "../studio-pose-material";
import {
  EMPTY_STUDIO_POSE_MATERIAL_LIBRARY,
  STUDIO_POSE_MATERIAL_LIBRARY_MAX_BYTES,
  deleteStudioPoseMaterial,
  exportStudioPoseMaterialLibrary,
  importStudioPoseMaterialLibrary,
  loadStudioPoseMaterialLibrary,
  upsertStudioPoseMaterial,
  type StudioPoseMaterialLibraryFailureReason,
  type StudioPoseMaterialLibraryLoadStatus,
  type StudioPoseMaterialLibraryPayload,
  type StudioPoseMaterialStorage,
} from "../studio-pose-material-library";

import {
  createStudioVrmPoseMaterialSqliteRepository,
  type StudioVrmPoseMaterialSqliteRepository,
} from "./studio-vrm-pose-material-sqlite-repository";

import type {
  StudioVrmPoseMaterialApplyResult,
  StudioVrmPoseMaterialCaptureOptions,
} from "./studio-vrm-pose-material-adapter";

interface StudioVrmPoseMaterialPanelProps {
  readonly disabled: boolean;
  readonly activeMaterialId: string | null;
  readonly lockedBoneCount: number;
  readonly onCapture: (
    options: StudioVrmPoseMaterialCaptureOptions,
  ) => StudioPoseMaterial | null;
  readonly onApply: (
    material: StudioPoseMaterial,
    scope: StudioPoseScope,
    strength?: number,
  ) => StudioVrmPoseMaterialApplyResult | null;
  readonly onMaterialDeleted?: (materialId: string) => void;
  /** Invalidates pose provenance when merge-import replaces the content behind an existing id. */
  readonly onMaterialReplaced?: (materialId: string) => void;
  /** Explicit legacy import/test seam. Product defaults never resolve or auto-read localStorage. */
  readonly storage?: StudioPoseMaterialStorage | null;
  /** Async product/test seam. Undefined selects the shared V12 SQLite/OPFS repository. */
  readonly repository?: StudioVrmPoseMaterialSqliteRepository;
}

type MessageTone = "neutral" | "success" | "warning" | "error";

interface PanelState {
  readonly loadStatus: StudioPoseMaterialLibraryLoadStatus;
  readonly payload: StudioPoseMaterialLibraryPayload;
  readonly message: string;
  readonly messageTone: MessageTone;
  readonly authority: "hydrating" | "sqlite" | "memory" | "legacy";
}

const SCOPE_LABELS: Readonly<Record<StudioPoseScope, string>> = Object.freeze({
  full: "전신",
  upper: "상체",
  lower: "하체",
  "left-hand": "왼손",
  "right-hand": "오른손",
  "gaze-jaw": "시선·턱",
});

let fallbackMaterialIdSequence = 0;

function createPoseMaterialId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `pose-${crypto.randomUUID()}`;
    }
  } catch {
    // A deterministic, bounded fallback is sufficient for storage environments without Web Crypto.
  }
  fallbackMaterialIdSequence = (fallbackMaterialIdSequence + 1) % 1_000_000;
  return `pose-${Date.now().toString(36)}-${fallbackMaterialIdSequence.toString(36)}`;
}

function canonicalizeMaterialName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

function failureMessage(reason: StudioPoseMaterialLibraryFailureReason): string {
  const messages: Record<StudioPoseMaterialLibraryFailureReason, string> = {
    "storage-unavailable": "이 브라우저에서는 로컬 포즈 소재 저장소를 사용할 수 없습니다.",
    "storage-read-error": "포즈 소재 저장소를 읽지 못했습니다.",
    "storage-write-error": "브라우저 저장 공간에 포즈 소재를 쓰지 못했습니다.",
    "library-corrupt": "기존 포즈 소재 데이터가 손상되어 원문 보호를 위해 변경을 막았습니다.",
    "library-future": "더 최신 버전의 포즈 소재 데이터라 현재 버전에서는 읽기 전용입니다.",
    "replace-requires-force": "기존 라이브러리를 교체하려면 명시적인 확인이 필요합니다.",
    "invalid-library": "ToonSpectrum 포즈 소재 라이브러리 JSON 형식이 아닙니다.",
    "invalid-material": "유효하지 않은 포즈 소재입니다.",
    "invalid-id": "포즈 소재 식별자가 올바르지 않습니다.",
    "duplicate-id": "같은 식별자의 포즈 소재가 중복되어 있습니다.",
    "max-count": "포즈 소재는 이 기기에 최대 64개까지 저장할 수 있습니다.",
    "max-bytes": "포즈 소재 라이브러리가 256 KiB 제한을 초과합니다.",
    "not-found": "삭제할 포즈 소재를 찾지 못했습니다.",
  };
  return messages[reason];
}

function loadStatusMessage(status: StudioPoseMaterialLibraryLoadStatus): string {
  if (status === "future") {
    return "더 최신 버전의 포즈 소재 저장소가 감지되었습니다. 기존 데이터를 덮어쓰지 않습니다.";
  }
  if (status === "corrupt") {
    return "손상된 포즈 소재 저장소가 감지되었습니다. 복구 전까지 기존 원문을 보존합니다.";
  }
  if (status === "read-error") return "포즈 소재 저장소를 읽지 못했습니다.";
  if (status === "unavailable") return "이 브라우저에서는 포즈 소재를 기기에 저장할 수 없습니다.";
  return "";
}

function messageClass(tone: MessageTone): string {
  if (tone === "success") return "text-good";
  if (tone === "warning") return "text-warn";
  if (tone === "error") return "text-bad";
  return "text-fg-3";
}

function scopesApplicableTo(material: StudioPoseMaterial): readonly StudioPoseScope[] {
  return STUDIO_POSE_SCOPES.filter((scope) =>
    material.bones.some((entry) => isStudioHumanoidBoneInScope(entry.bone, scope))
  );
}

function applicableScopeOrAuthored(
  material: StudioPoseMaterial,
  candidate: StudioPoseScope | undefined,
): StudioPoseScope {
  return candidate && scopesApplicableTo(material).includes(candidate)
    ? candidate
    : material.scope;
}

function poseMaterialContentMatches(
  left: StudioPoseMaterial,
  right: StudioPoseMaterial,
): boolean {
  const leftJson = serializeStudioPoseMaterial(left);
  const rightJson = serializeStudioPoseMaterial(right);
  return leftJson !== null && leftJson === rightJson;
}

export function StudioVrmPoseMaterialPanel({
  disabled,
  activeMaterialId,
  lockedBoneCount,
  onCapture,
  onApply,
  onMaterialDeleted,
  onMaterialReplaced,
  storage,
  repository: repositoryOverride,
}: StudioVrmPoseMaterialPanelProps) {
  const nameInputId = useId();
  const captureScopeId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const legacyStorageSeam = storage !== undefined;
  const storageAdapter = storage ?? null;
  const [repository] = useState<StudioVrmPoseMaterialSqliteRepository>(() =>
    repositoryOverride ?? createStudioVrmPoseMaterialSqliteRepository()
  );
  const mountedRef = useRef(false);
  const mutationGenerationRef = useRef(0);
  const mutationTailRef = useRef<Promise<void>>(Promise.resolve());
  const [panelState, setPanelState] = useState<PanelState>(() => {
    if (!legacyStorageSeam) {
      return {
        loadStatus: "missing",
        payload: EMPTY_STUDIO_POSE_MATERIAL_LIBRARY,
        message: "SQLite/OPFS 포즈 소재를 불러오는 중입니다.",
        messageTone: "neutral",
        authority: "hydrating",
      };
    }
    const loaded = loadStudioPoseMaterialLibrary(storageAdapter);
    const message = loadStatusMessage(loaded.status);
    return {
      loadStatus: loaded.status,
      payload: loaded.payload,
      message,
      messageTone: message ? "warning" : "neutral",
      authority: "legacy",
    };
  });
  const [materialName, setMaterialName] = useState("");
  const [captureScope, setCaptureScope] = useState<StudioPoseScope>("full");
  const [applyScopes, setApplyScopes] = useState<Partial<Record<string, StudioPoseScope>>>({});
  /** 적용 강도 0..1 — 1이면 소재 회전 전체, 0이면 rest-relative identity. */
  const [applyStrength, setApplyStrength] = useState(1);
  const [importing, setImporting] = useState(false);
  const strengthSliderId = useId();

  useEffect(() => {
    mountedRef.current = true;
    if (legacyStorageSeam) {
      return () => {
        mountedRef.current = false;
        mutationGenerationRef.current += 1;
      };
    }

    const hydrationGeneration = mutationGenerationRef.current;
    void repository.load().then((payload) => {
      if (
        !mountedRef.current
        || mutationGenerationRef.current !== hydrationGeneration
      ) return;
      setPanelState({
        loadStatus: payload.materials.length === 0 ? "missing" : "loaded",
        payload,
        message: "",
        messageTone: "neutral",
        authority: "sqlite",
      });
    }).catch((error: unknown) => {
      if (
        !mountedRef.current
        || mutationGenerationRef.current !== hydrationGeneration
      ) return;
      setPanelState({
        loadStatus: "read-error",
        payload: EMPTY_STUDIO_POSE_MATERIAL_LIBRARY,
        message: `SQLite/OPFS 포즈 소재를 검증해 불러오지 못했습니다. 원문 보호를 위해 변경을 막았습니다: ${
          error instanceof Error ? error.message : String(error)
        }`,
        messageTone: "error",
        authority: "memory",
      });
    });

    return () => {
      mountedRef.current = false;
      mutationGenerationRef.current += 1;
    };
  }, [legacyStorageSeam, repository]);

  const storageReadOnly = ["future", "corrupt", "read-error", "unavailable"].includes(
    panelState.loadStatus
  ) || panelState.authority === "hydrating";
  const mutationDisabled = disabled || storageReadOnly || importing;

  function inMemoryStorage(
    payload: StudioPoseMaterialLibraryPayload,
  ): StudioPoseMaterialStorage {
    let value = JSON.stringify(payload);
    return {
      getItem: () => value,
      setItem: (_key, next) => {
        value = next;
      },
    };
  }

  function commitMutation(
    result: ReturnType<typeof upsertStudioPoseMaterial>,
    successMessage: string,
  ): boolean {
    if (!result.ok) {
      setPanelState((current) => ({
        ...current,
        message: failureMessage(result.reason),
        messageTone: "error",
      }));
      return false;
    }
    if (!legacyStorageSeam) {
      const generation = mutationGenerationRef.current + 1;
      mutationGenerationRef.current = generation;
      const optimisticPayload = result.payload;
      setPanelState({
        loadStatus: "loaded",
        payload: optimisticPayload,
        message: "SQLite/OPFS에 저장하는 중입니다.",
        messageTone: "neutral",
        authority: "sqlite",
      });
      const persisted = mutationTailRef.current
        .catch(() => undefined)
        .then(() => repository.save(optimisticPayload));
      mutationTailRef.current = persisted.then(() => undefined, () => undefined);
      void persisted.then((payload) => {
        if (!mountedRef.current || mutationGenerationRef.current !== generation) return;
        setPanelState({
          loadStatus: "loaded",
          payload,
          message: successMessage,
          messageTone: "success",
          authority: "sqlite",
        });
      }).catch((error: unknown) => {
        if (!mountedRef.current || mutationGenerationRef.current !== generation) return;
        setPanelState({
          loadStatus: "loaded",
          payload: optimisticPayload,
          message: `SQLite/OPFS 저장에 실패해 변경을 현재 탭 메모리에만 유지합니다. 현재 탭 메모리 임시 · 새로고침 시 사라짐: ${
            error instanceof Error ? error.message : String(error)
          }`,
          messageTone: "error",
          authority: "memory",
        });
      });
      return true;
    }
    setPanelState({
      loadStatus: "loaded",
      payload: result.payload,
      message: successMessage,
      messageTone: "success",
      authority: "legacy",
    });
    return true;
  }

  function handleSave(): void {
    const name = canonicalizeMaterialName(materialName);
    if (!name) {
      setPanelState((current) => ({
        ...current,
        message: "포즈 소재 이름을 입력해 주세요.",
        messageTone: "warning",
      }));
      return;
    }
    const material = onCapture({
      id: createPoseMaterialId(),
      name,
      scope: captureScope,
      description: "",
      tags: [],
    });
    if (!material) {
      setPanelState((current) => ({
        ...current,
        message: "현재 캐릭터의 normalized 포즈를 안전하게 읽지 못했습니다.",
        messageTone: "error",
      }));
      return;
    }
    if (
      commitMutation(
        upsertStudioPoseMaterial(
          legacyStorageSeam ? storageAdapter : inMemoryStorage(panelState.payload),
          material,
        ),
        `“${material.name}” 소재에 ${material.bones.length}개 본을 저장했습니다.`,
      )
    ) {
      setMaterialName("");
    }
  }

  function handleApply(material: StudioPoseMaterial): void {
    const scope = applicableScopeOrAuthored(material, applyScopes[material.id]);
    const result = onApply(material, scope, applyStrength);
    if (!result) {
      setPanelState((current) => ({
        ...current,
        message: "포즈 소재 적용에 실패해 캐릭터 상태를 변경하지 않았습니다.",
        messageTone: "error",
      }));
      return;
    }
    const details = [
      `${result.appliedBones.length}개 본 적용`,
      result.skippedLocked.length > 0 ? `잠금 ${result.skippedLocked.length}개 유지` : "",
      result.skippedMissing.length > 0 ? `모델 미지원 ${result.skippedMissing.length}개 건너뜀` : "",
      result.skippedOutsideScope.length > 0
        ? `범위 밖 ${result.skippedOutsideScope.length}개 유지`
        : "",
    ].filter(Boolean);
    setPanelState((current) => ({
      ...current,
      message: `“${material.name}” · ${details.join(" · ")}`,
      messageTone: result.appliedBones.length > 0 ? "success" : "warning",
    }));
  }

  async function handleDelete(material: StudioPoseMaterial): Promise<void> {
    if (
      !(await confirmStudioDestructiveAction(
        studioDeletePoseMaterialRequest(material.name),
      ))
    ) return;
    if (
      commitMutation(
        deleteStudioPoseMaterial(
          legacyStorageSeam ? storageAdapter : inMemoryStorage(panelState.payload),
          material.id,
        ),
        `“${material.name}” 소재를 삭제했습니다. 이미 적용된 캐릭터 자세는 유지됩니다.`,
      )
    ) {
      onMaterialDeleted?.(material.id);
    }
  }

  function handleExport(): void {
    const result = exportStudioPoseMaterialLibrary(
      legacyStorageSeam ? storageAdapter : inMemoryStorage(panelState.payload),
    );
    if (!result.ok) {
      setPanelState((current) => ({
        ...current,
        message: failureMessage(result.reason),
        messageTone: "error",
      }));
      return;
    }
    try {
      const url = URL.createObjectURL(new Blob([result.json], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "toonspectrum-pose-materials-v1.json";
      anchor.click();
      URL.revokeObjectURL(url);
      setPanelState((current) => ({
        ...current,
        message: `포즈 소재 ${result.count}개를 canonical JSON으로 내보냈습니다.`,
        messageTone: "success",
      }));
    } catch {
      setPanelState((current) => ({
        ...current,
        message: "포즈 소재 파일을 만들지 못했습니다.",
        messageTone: "error",
      }));
    }
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      if (file.size > STUDIO_POSE_MATERIAL_LIBRARY_MAX_BYTES) {
        setPanelState((current) => ({
          ...current,
          message: "가져올 JSON이 256 KiB 제한을 초과합니다.",
          messageTone: "error",
        }));
        return;
      }
      const json = await file.text();
      const result = importStudioPoseMaterialLibrary(
        legacyStorageSeam ? storageAdapter : inMemoryStorage(panelState.payload),
        json,
        "merge",
      );
      const updated = commitMutation(
        result,
        "검증된 포즈 소재를 기존 라이브러리에 병합했습니다.",
      );
      if (updated && result.ok) {
        const previousById = new Map(
          panelState.payload.materials.map((material) => [material.id, material]),
        );
        setApplyScopes({});
        for (const material of result.payload.materials) {
          const previous = previousById.get(material.id);
          if (previous && !poseMaterialContentMatches(previous, material)) {
            onMaterialReplaced?.(material.id);
          }
        }
      }
    } catch {
      setPanelState((current) => ({
        ...current,
        message: "포즈 소재 JSON 파일을 읽지 못했습니다.",
        messageTone: "error",
      }));
    } finally {
      input.value = "";
      setImporting(false);
    }
  }

  return (
    <details className="group mt-3.5 rounded-xl border border-accent/25 bg-accent-soft/15 p-3">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-xs font-bold text-fg [&::-webkit-details-marker]:hidden">
        <Sparkles size={15} className="text-accent" aria-hidden />
        캐릭터 공용 포즈 소재
        <span className="ml-auto rounded-full bg-card px-2 py-0.5 text-[0.65rem] text-fg-3">
          {panelState.payload.materials.length}/64
        </span>
      </summary>

      <p className="mt-1 text-[0.65rem] leading-relaxed text-fg-3">
        VRM normalized 55본 회전만 저장해 체형이 다른 캐릭터에도 이식합니다. 높이·표정·캐릭터 회전은 v1 소재에 포함하지 않습니다.
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem]">
        <label htmlFor={nameInputId} className="sr-only">포즈 소재 이름</label>
        <input
          id={nameInputId}
          type="text"
          value={materialName}
          maxLength={STUDIO_POSE_MATERIAL_MAX_NAME_LENGTH}
          disabled={mutationDisabled}
          onChange={(event) => setMaterialName(event.target.value)}
          placeholder="소재 이름 (예: 검을 든 상체)"
          className="min-h-11 min-w-0 rounded-lg border border-line bg-card px-3 text-xs text-fg placeholder:text-fg-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-45"
        />
        <label htmlFor={captureScopeId} className="sr-only">저장할 포즈 범위</label>
        <select
          id={captureScopeId}
          value={captureScope}
          disabled={mutationDisabled}
          onChange={(event) => setCaptureScope(event.target.value as StudioPoseScope)}
          className="min-h-11 rounded-lg border border-line bg-card px-2 text-xs text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-45"
        >
          {STUDIO_POSE_SCOPES.map((scope) => (
            <option key={scope} value={scope}>{SCOPE_LABELS[scope]} 저장</option>
          ))}
        </select>
      </div>

      <button
        type="button"
        disabled={mutationDisabled || !materialName.trim()}
        onClick={handleSave}
        className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-accent/40 bg-accent-soft px-3 text-xs font-bold text-accent transition-colors hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-45"
      >
        <Sparkles size={14} aria-hidden /> 현재 자세를 범용 소재로 저장
      </button>

      {disabled ? (
        <p className="mt-2 text-[0.65rem] leading-relaxed text-warn" role="status">
          실시간 추적·애니메이션·캡처·관절 드래그가 끝나면 저장하고 적용할 수 있습니다.
        </p>
      ) : null}
      {lockedBoneCount > 0 ? (
        <p className="mt-1 text-[0.65rem] text-fg-3">현재 잠금 본 {lockedBoneCount}개는 소재 적용 시 그대로 유지됩니다.</p>
      ) : null}

      <div className="mt-3 rounded-lg border border-line/50 bg-card/40 px-2.5 py-2">
        <label
          htmlFor={strengthSliderId}
          className="flex items-center justify-between gap-2 text-[0.68rem] font-semibold text-fg-2"
        >
          <span>적용 강도</span>
          <span className="tabular-nums text-fg-3">{Math.round(applyStrength * 100)}%</span>
        </label>
        <input
          id={strengthSliderId}
          aria-label="적용 강도"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={applyStrength}
          disabled={disabled}
          onChange={(event) => setApplyStrength(Number(event.target.value))}
          className="mt-1.5 w-full accent-accent disabled:opacity-45"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(applyStrength * 100)}
          aria-valuetext={`${Math.round(applyStrength * 100)}%`}
        />
        <p className="mt-1 text-[0.62rem] leading-relaxed text-fg-3">
          100%는 소재 자세 전체, 0%는 rest에 가깝게 섞입니다. 모든 적용 버튼에 공통으로 쓰입니다.
        </p>
      </div>

      {panelState.message ? (
        <p
          className={`mt-2 text-[0.65rem] leading-relaxed ${messageClass(panelState.messageTone)}`}
          role="status"
          aria-live="polite"
          data-studio-vrm-pose-material-authority={panelState.authority}
        >
          {panelState.message}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2 border-t border-line/45 pt-3">
        <button
          type="button"
          disabled={storageReadOnly || panelState.payload.materials.length === 0 || importing}
          onClick={handleExport}
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border border-line bg-card px-3 text-[0.68rem] font-bold text-fg-2 hover:bg-raised disabled:opacity-45"
        >
          <Download size={13} aria-hidden /> JSON 내보내기
        </button>
        <button
          type="button"
          disabled={mutationDisabled}
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border border-line bg-card px-3 text-[0.68rem] font-bold text-fg-2 hover:bg-raised disabled:opacity-45"
        >
          {importing ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Upload size={13} aria-hidden />}
          JSON 병합
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          className="sr-only"
          tabIndex={-1}
          onChange={(event) => void handleImport(event)}
        />
      </div>

      {panelState.payload.materials.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-line/60 bg-card/25 px-3 py-4 text-center text-[0.68rem] text-fg-3">
          저장된 범용 포즈 소재가 없습니다.
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {panelState.payload.materials.map((material) => {
            const applicableScopes = scopesApplicableTo(material);
            const selectedScope = applicableScopeOrAuthored(
              material,
              applyScopes[material.id],
            );
            const isActive = activeMaterialId === material.id;
            return (
              <article
                key={material.id}
                className={`rounded-xl border p-2.5 ${
                  isActive ? "border-accent/60 bg-accent-soft/35" : "border-line bg-card/65"
                }`}
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-bold text-fg" title={material.name}>{material.name}</p>
                    <p className="mt-0.5 text-[0.65rem] text-fg-3">
                      {SCOPE_LABELS[material.scope]} 소재 · {material.bones.length}본
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={mutationDisabled}
                    onClick={() => void handleDelete(material)}
                    className="grid size-11 shrink-0 place-items-center rounded-lg border border-line bg-card text-fg-3 hover:border-bad/40 hover:text-bad disabled:opacity-45"
                    aria-label={`${material.name} 포즈 소재 삭제`}
                  >
                    <Trash2 size={14} aria-hidden />
                  </button>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_6.5rem]">
                  <label className="sr-only" htmlFor={`pose-material-scope-${material.id}`}>적용 범위</label>
                  <select
                    id={`pose-material-scope-${material.id}`}
                    value={selectedScope}
                    disabled={disabled}
                    onChange={(event) =>
                      setApplyScopes((current) => ({
                        ...current,
                        [material.id]: event.target.value as StudioPoseScope,
                      }))
                    }
                    className="min-h-11 min-w-0 rounded-lg border border-line bg-card px-2 text-[0.68rem] text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-45"
                  >
                    {applicableScopes.map((scope) => (
                      <option key={scope} value={scope}>{SCOPE_LABELS[scope]}에 적용</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => handleApply(material)}
                    className="min-h-11 rounded-lg border border-accent/40 bg-accent-soft px-3 text-[0.68rem] font-bold text-accent hover:bg-accent/15 disabled:opacity-45"
                  >
                    적용
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </details>
  );
}
