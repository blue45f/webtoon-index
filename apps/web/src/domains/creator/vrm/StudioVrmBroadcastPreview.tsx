/**
 * Session-only broadcast preview controls for the existing VRM R3F renderer.
 *
 * No recording, stream, browser-source, model, or project authority lives here. The panel chooses
 * one validated background; the bridge leases presentation-only renderer state and restores it on
 * every cleanup path; the overlay keeps a keyboard-reachable exit while editor chrome is hidden.
 */

import { useThree } from "@react-three/fiber";
import { LogOut, MonitorUp, ShieldCheck } from "lucide-react";
import { useEffectEvent, useId, useLayoutEffect, type RefObject } from "react";

import {
  STUDIO_VRM_BROADCAST_BACKGROUNDS,
  type StudioVrmBroadcastBackgroundId,
  type StudioVrmBroadcastPreviewReceipt,
} from "./studio-vrm-broadcast-preview";
import { acquireStudioVrmBroadcastRenderLease } from "./studio-vrm-broadcast-render-lease";

import type * as THREE from "three";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export interface StudioVrmBroadcastPreviewPanelProps {
  readonly backgroundId: StudioVrmBroadcastBackgroundId;
  readonly disabledReason?: string | null;
  readonly error?: string | null;
  readonly onBackgroundChange: (backgroundId: StudioVrmBroadcastBackgroundId) => void;
  readonly onStart: () => void;
}

export function StudioVrmBroadcastPreviewPanel({
  backgroundId,
  disabledReason = null,
  error = null,
  onBackgroundChange,
  onStart,
}: StudioVrmBroadcastPreviewPanelProps) {
  const titleId = useId();
  const authorityId = useId();
  const statusId = useId();

  return (
    <section
      aria-labelledby={titleId}
      aria-describedby={`${authorityId} ${statusId}`}
      className="border-t border-line/50 pt-4"
      data-studio-vrm-broadcast-panel="true"
    >
      <header className="flex items-start gap-2.5">
        <span
          aria-hidden
          className="grid size-9 shrink-0 place-items-center rounded-lg border border-accent/35 bg-accent-soft text-accent"
        >
          <MonitorUp size={17} />
        </span>
        <div className="min-w-0">
          <h3 id={titleId} className="text-sm font-bold text-fg">방송 미리보기</h3>
          <p id={authorityId} className="mt-1 text-[0.68rem] leading-relaxed text-fg-3">
            현재 VRM 장면을 고정 크로마 배경에서 확인합니다. 녹화·송출 연결은 만들지 않으며,
            카메라와 배경 선택을 프로젝트·OPFS·Undo 기록에 저장하지 않습니다.
          </p>
        </div>
      </header>

      <div className="mt-3" role="group" aria-label="방송 미리보기 배경">
        <p className="mb-1.5 text-[0.65rem] font-bold uppercase text-fg-3">검증된 배경</p>
        <div className="grid grid-cols-3 gap-2">
          {STUDIO_VRM_BROADCAST_BACKGROUNDS.map((background) => {
            const selected = background.id === backgroundId;
            return (
              <button
                key={background.id}
                type="button"
                aria-label={background.label}
                aria-pressed={selected}
                disabled={Boolean(disabledReason)}
                className={cx(
                  "min-h-11 rounded-lg border px-2 py-2 text-[0.66rem] font-bold transition-colors",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                  "disabled:cursor-not-allowed disabled:opacity-45",
                  selected
                    ? "border-accent/60 bg-accent-soft text-accent"
                    : "border-line bg-card text-fg-2 hover:bg-raised hover:text-fg",
                )}
                onClick={() => onBackgroundChange(background.id)}
              >
                <span
                  aria-hidden
                  className="mx-auto mb-1 block size-4 rounded-sm border border-white/25 shadow-sm"
                  style={{ backgroundColor: background.hex }}
                />
                {background.label}
              </button>
            );
          })}
        </div>
      </div>

      <p
        id={statusId}
        className={cx(
          "mt-3 text-[0.68rem] leading-relaxed",
          error ? "text-bad" : disabledReason ? "text-warn" : "text-fg-3",
        )}
        role={error ? "alert" : "status"}
        aria-live={error ? "assertive" : "polite"}
        aria-atomic="true"
      >
        {error
          ? error
          : disabledReason
            ? disabledReason
            : "현재 카메라 구도를 그대로 사용하며 편집 UI와 장면 환경·바닥 그림자만 임시로 숨깁니다."}
      </p>

      <button
        type="button"
        data-studio-vrm-broadcast-enter="true"
        disabled={Boolean(disabledReason)}
        className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-accent/60 bg-accent px-3 py-2 text-xs font-bold text-on-accent transition-colors hover:bg-accent/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45"
        onClick={onStart}
      >
        <MonitorUp size={15} aria-hidden />
        방송 화면 열기
      </button>
    </section>
  );
}

export interface StudioVrmBroadcastPreviewOverlayProps {
  readonly receipt: StudioVrmBroadcastPreviewReceipt;
  readonly exitButtonRef: RefObject<HTMLButtonElement | null>;
  readonly onExit: () => void;
}

export function StudioVrmBroadcastPreviewOverlay({
  receipt,
  exitButtonRef,
  onExit,
}: StudioVrmBroadcastPreviewOverlayProps) {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-40"
      data-studio-vrm-broadcast-overlay="true"
    >
      <div className="pointer-events-auto absolute right-3 top-3 flex items-center gap-2 rounded-lg border border-white/30 bg-black/75 p-2 text-white shadow-xl backdrop-blur sm:right-4 sm:top-4">
        <span className="hidden items-center gap-1.5 px-1 text-[0.68rem] font-semibold sm:flex">
          <ShieldCheck size={14} aria-hidden />
          {receipt.background.label} · 세션 전용
        </span>
        <button
          ref={exitButtonRef}
          type="button"
          aria-label="방송 미리보기 종료"
          aria-keyshortcuts="Escape"
          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-white/35 bg-white/10 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          onClick={onExit}
        >
          <LogOut size={15} aria-hidden />
          편집기로 돌아가기
        </button>
      </div>
      <p
        className="absolute bottom-3 left-3 rounded-md border border-white/25 bg-black/70 px-2.5 py-1.5 text-[0.65rem] font-medium text-white/90 backdrop-blur sm:bottom-4 sm:left-4"
        role="status"
        aria-live="polite"
      >
        방송 미리보기 실행 중 · 녹화와 송출은 외부 도구에서 제어합니다.
      </p>
    </div>
  );
}

export interface StudioVrmBroadcastPreviewBridgeProps {
  readonly receipt: StudioVrmBroadcastPreviewReceipt;
  readonly environmentRef: RefObject<THREE.Group | null>;
  readonly groundRef: RefObject<THREE.Mesh | null>;
  readonly onError: (message: string) => void;
}

/** Mounted only inside the existing StudioVrmPoser Canvas. */
export function StudioVrmBroadcastPreviewBridge({
  receipt,
  environmentRef,
  groundRef,
  onError,
}: StudioVrmBroadcastPreviewBridgeProps) {
  const renderer = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const invalidate = useThree((state) => state.invalidate);
  const reportError = useEffectEvent(onError);

  useLayoutEffect(() => {
    const result = acquireStudioVrmBroadcastRenderLease({
      renderer,
      scene,
      environment: environmentRef.current,
      ground: groundRef.current,
      backgroundHex: receipt.background.hex,
      invalidate,
    });
    if (!result.ok) {
      reportError(result.reason);
      return;
    }

    return () => {
      try {
        result.lease.release();
      } catch {
        reportError("기존 3D 배경을 복원하지 못했습니다. 편집기를 닫았다가 다시 열어 주세요.");
      }
    };
  }, [environmentRef, groundRef, invalidate, receipt, renderer, scene]);

  return null;
}
