/**
 * Character Shaper — floating controls over the 3D viewport.
 *
 * Top-left: camera presets · top-right: turntable, lighting tone, transparent background, zoom.
 * Bottom-left: a status pill (model status / busy reason / hold-to-compare). Every control is a
 * labelled 44px button; the wrapper is pointer-transparent so orbiting the model keeps working.
 */
import { Eye, EyeOff, LoaderCircle, Maximize2, RotateCw, SunMedium, ZoomIn, ZoomOut } from "lucide-react";

import { StudioHudPill } from "../studio-chrome-ui";
import { STUDIO_FOCUS_RING } from "../studio-panel-ui";
import { STUDIO_VRM_INSPECTION_VIEWS } from "../vrm/studio-vrm-inspection-framing";
import { CAMERA_PRESETS } from "../vrm/studio-vrm-poser-catalogs";

import {
  CHARACTER_SHAPER_CAMERA_PRESET_IDS,
  characterLightingToneLabel,
  nextCharacterLightingTone,
} from "./character-shaper-ui-model";

import type { CharacterShaperViewportHudProps } from "./character-shaper-ui-contract";
import type { LoadStatus } from "../vrm/StudioVrmPoserTypes";
import type { VrmLibraryEntry } from "../vrm/vrm-library";

import { cn } from "@/shared/lib/utils";

const HUD_BUTTON = cn(
  "grid size-11 shrink-0 place-items-center rounded-xl border border-line/70 bg-panel/85 text-fg-2 shadow-sm backdrop-blur",
  "transition-colors duration-150 hover:bg-accent-soft hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none",
  STUDIO_FOCUS_RING,
);

const HUD_BUTTON_ACTIVE = "border-accent/60 bg-accent text-on-accent hover:bg-accent-2 hover:text-on-accent";

function statusText(input: {
  readonly status: LoadStatus;
  readonly compareActive: boolean;
  readonly busyReason: string | null;
  readonly cameraLabel: string;
  readonly transparent: boolean;
  readonly paintMode: boolean;
}): { readonly text: string; readonly accent: boolean } {
  if (input.compareActive) return { text: "기준 상태 보는 중", accent: true };
  if (input.busyReason) return { text: input.busyReason, accent: true };
  if (input.status === "loading") return { text: "VRM 불러오는 중", accent: false };
  if (input.status === "error") return { text: "불러오기 실패", accent: false };
  if (input.status === "empty") return { text: "모델 없음", accent: false };
  const parts = [input.cameraLabel];
  if (input.paintMode) parts.push("표면 드로잉");
  if (input.transparent) parts.push("투명 배경");
  return { text: parts.join(" · "), accent: false };
}

export function CharacterShaperViewportHud({ h, binding, compact }: CharacterShaperViewportHudProps) {
  const status: LoadStatus = h.status ?? "empty";
  const activeCameraId: string = typeof h.activeCameraId === "string" ? h.activeCameraId : "front";
  const turntable = Boolean(h.turntable);
  const transparent = Boolean(h.transparentBackground);
  const paintMode = Boolean(h.texturePaintModeSelected);
  const cameraLocked = Boolean(h.viewportCameraInteractionLocked || h.isCapturing || h.isSharingPose || h.isThumbnailCapturing);
  const lightingTone: string | undefined = typeof h.lightingTone === "string" ? h.lightingTone : undefined;
  const modelReady = status === "ready";
  const presets = CHARACTER_SHAPER_CAMERA_PRESET_IDS
    .map((id) => CAMERA_PRESETS.find((preset) => preset.id === id) ?? null)
    .filter((preset): preset is (typeof CAMERA_PRESETS)[number] => preset !== null);
  const activePresetLabel = CAMERA_PRESETS.find((preset) => preset.id === activeCameraId)?.label ?? "정면";
  const entries: readonly VrmLibraryEntry[] = Array.isArray(h.libraryEntries) ? h.libraryEntries : [];
  const modelName = entries.find((entry) => entry.id === h.activeModelId)?.name ?? null;
  const pill = statusText({
    status,
    compareActive: binding.compareActive,
    busyReason: binding.busyReason,
    cameraLabel: activePresetLabel,
    transparent,
    paintMode,
  });
  const lightingLabel = characterLightingToneLabel(lightingTone);

  return (
    <div
      data-character-shaper-hud="true"
      className="pointer-events-none absolute inset-0 z-20"
    >
      <div
        role="group"
        aria-label="카메라 프리셋"
        className={cn(
          "pointer-events-auto absolute left-2 top-2 flex max-w-[calc(100%-4rem)] gap-1 overflow-x-auto rounded-2xl border border-line/60 bg-panel/80 p-1 backdrop-blur",
          "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          compact ? "right-16" : "",
        )}
      >
        {presets.map((preset) => {
          const active = preset.id === activeCameraId;
          return (
            <button
              key={preset.id}
              type="button"
              aria-pressed={active}
              disabled={cameraLocked || !modelReady}
              title={`카메라: ${preset.label}`}
              onClick={() => h.setActiveCameraId(preset.id)}
              className={cn(
                "min-h-11 shrink-0 rounded-xl px-3 text-[0.72rem] font-semibold transition-colors motion-reduce:transition-none",
                STUDIO_FOCUS_RING,
                active ? "bg-accent text-on-accent" : "text-fg-2 hover:bg-raised hover:text-fg",
                "disabled:cursor-not-allowed disabled:opacity-40",
              )}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      <select
        aria-label="부위·방향 확대 검사"
        title="측면·후면과 착장 접점을 확대합니다. 드래그로 자유롭게 회전할 수 있습니다."
        disabled={cameraLocked || !modelReady}
        value={STUDIO_VRM_INSPECTION_VIEWS.some((view) => view.id === activeCameraId) ? activeCameraId : ""}
        onChange={(event) => { if (event.target.value) h.setActiveCameraId(event.target.value); }}
        className={cn(
          "pointer-events-auto absolute left-2 top-16 min-h-11 max-w-[calc(100%-5rem)] rounded-xl border border-line/70 bg-panel/90 px-3 text-xs font-semibold text-fg shadow-sm backdrop-blur",
          "disabled:cursor-not-allowed disabled:opacity-40",
          STUDIO_FOCUS_RING,
        )}
      >
        <option value="" disabled>부위·방향 확대 검사</option>
        {STUDIO_VRM_INSPECTION_VIEWS.map((view) => <option key={view.id} value={view.id}>{view.label}</option>)}
      </select>

      <div
        role="group"
        aria-label="뷰포트 보기 설정"
        className={cn(
          "pointer-events-auto absolute right-2 top-2 flex flex-col gap-1.5",
          compact && "top-16",
        )}
      >
        <button
          type="button"
          aria-pressed={turntable}
          aria-keyshortcuts="T"
          disabled={paintMode || cameraLocked || !modelReady}
          title={
            paintMode
              ? "표면 드로잉 중에는 턴테이블을 잠급니다."
              : turntable
                ? "턴테이블 정지 (T)"
                : "턴테이블 회전 (T)"
          }
          aria-label={turntable ? "턴테이블 정지" : "턴테이블 회전"}
          onClick={() => h.setTurntable((value: boolean) => !value)}
          className={cn(HUD_BUTTON, turntable && HUD_BUTTON_ACTIVE)}
        >
          <RotateCw
            size={17}
            aria-hidden
            className={turntable ? "animate-spin [animation-duration:3s] motion-reduce:animate-none" : ""}
          />
        </button>
        <button
          type="button"
          aria-label={`조명 톤 바꾸기 (현재 ${lightingLabel})`}
          title={`조명 톤: ${lightingLabel} → ${characterLightingToneLabel(nextCharacterLightingTone(lightingTone))}`}
          disabled={!modelReady}
          onClick={() => h.setLightingTone(nextCharacterLightingTone(lightingTone))}
          className={cn(HUD_BUTTON, "relative")}
        >
          <SunMedium size={17} aria-hidden />
          <span aria-hidden className="absolute inset-x-0 bottom-0.5 text-center text-[0.55rem] font-semibold leading-none">
            {lightingLabel}
          </span>
        </button>
        <button
          type="button"
          aria-pressed={transparent}
          aria-label={transparent ? "투명 배경 끄기" : "투명 배경 켜기"}
          title={transparent ? "투명 배경 · 캔버스에 추가하면 캐릭터만 남습니다" : "배경색 포함 · 투명 배경으로 바꾸려면 누르세요"}
          onClick={() => h.setTransparentBackground(!transparent)}
          className={cn(
            HUD_BUTTON,
            transparent &&
              "border-accent/60 text-accent [background-image:linear-gradient(45deg,oklch(0.75_0.01_80/0.22)_25%,transparent_25%),linear-gradient(-45deg,oklch(0.75_0.01_80/0.22)_25%,transparent_25%),linear-gradient(45deg,transparent_75%,oklch(0.75_0.01_80/0.22)_75%),linear-gradient(-45deg,transparent_75%,oklch(0.75_0.01_80/0.22)_75%)] [background-position:0_0,0_6px,6px_-6px,-6px_0] [background-size:12px_12px]",
          )}
        >
          {transparent ? <Eye size={17} aria-hidden /> : <EyeOff size={17} aria-hidden />}
        </button>
        <div className="my-0.5 h-px w-full bg-line/70" aria-hidden />
        <button
          type="button"
          aria-label="확대"
          title="확대"
          disabled={cameraLocked || !modelReady}
          onClick={() => h.zoomViewport(0.82)}
          className={HUD_BUTTON}
        >
          <ZoomIn size={17} aria-hidden />
        </button>
        <button
          type="button"
          aria-label="축소"
          title="축소"
          disabled={cameraLocked || !modelReady}
          onClick={() => h.zoomViewport(1.22)}
          className={HUD_BUTTON}
        >
          <ZoomOut size={17} aria-hidden />
        </button>
        <button
          type="button"
          aria-label="시점 초기화"
          title="시점 초기화"
          disabled={cameraLocked || !modelReady}
          onClick={() => h.handleViewReset()}
          className={HUD_BUTTON}
        >
          <Maximize2 size={17} aria-hidden />
        </button>
      </div>

      <div role="status" className="pointer-events-auto absolute bottom-2 left-2 max-w-[70%]">
        <StudioHudPill
          accent={pill.accent}
          title={modelName ? `${modelName} · ${pill.text}` : pill.text}
          className="max-w-full truncate"
        >
          {status === "loading" ? (
            <LoaderCircle size={12} aria-hidden className="animate-spin motion-reduce:animate-none" />
          ) : null}
          {pill.text}
        </StudioHudPill>
      </div>
    </div>
  );
}
