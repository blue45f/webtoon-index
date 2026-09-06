/**
 * THESIS: 저장된 3D 장면을 바꾸지 않고 실제 공간과 헤드셋에서 검토하는 한정된 출구를 제공한다.
 * OWN-WORLD: BG3D의 warm-ink 표면, 얇은 경계, persimmon 활성 신호와 조밀한 상태 문법을 계승한다.
 * STORY: 기기 지원을 확인하고 현재 canonical 장면의 AR·VR 미리보기를 시작한 뒤 안전하게 끝낸다.
 * FIRST VIEWPORT: 런타임 권한 안내, 두 실행 버튼, 단일 상태 알림 순으로 현재 가능 여부가 바로 읽힌다.
 * FORM: 기존 BG3D 도구 패널을 확장하는 Operate 표면이며 브라우저 WebXR 세션만 제어한다.
 */

import {
  Box,
  Glasses,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  Square,
  TriangleAlert,
} from "lucide-react";
import { useId } from "react";

import {
  STUDIO_BG3D_CONTROL_BUTTON,
  studioBg3dClassNames as cx,
} from "./studio-bg3d-editor-ui";

import type {
  StudioWebXrMode,
  StudioWebXrSessionErrorCode,
  StudioWebXrSessionState,
  StudioWebXrSupportLevel,
  StudioWebXrSupportSnapshot,
} from "../studio-webxr-session";

export interface StudioBg3dImmersivePanelProps {
  /** Last browser capability probe. Null keeps direct, user-activated requests possible. */
  readonly support: StudioWebXrSupportSnapshot | null;
  /** Controlled session state from the Three WebXRManager session authority. */
  readonly sessionState: StudioWebXrSessionState;
  readonly onStart: (mode: StudioWebXrMode) => void | Promise<unknown>;
  readonly onEnd: () => void | Promise<unknown>;
  /** True only while an explicit capability probe is still running. */
  readonly supportPending?: boolean;
  /** Parent-owned edit, restore, or capture lock. Ending an active session stays available. */
  readonly disabledReason?: string | null;
  /** Optional context only; the first slice previews the current canonical view, not a shot tour. */
  readonly savedShotCount?: number;
}

const MODE_LABELS: Readonly<Record<StudioWebXrMode, string>> = Object.freeze({
  "immersive-ar": "AR 미니어처 미리보기",
  "immersive-vr": "VR 장면 미리보기",
});

function modeSupport(
  support: StudioWebXrSupportSnapshot | null,
  mode: StudioWebXrMode,
): StudioWebXrSupportLevel {
  if (!support) return "unknown";
  return mode === "immersive-ar" ? support.immersiveAr : support.immersiveVr;
}

function errorMessage(
  code: StudioWebXrSessionErrorCode,
  mode: StudioWebXrMode | null,
): string {
  switch (code) {
    case "insecure-context":
      return "HTTPS 보안 연결이 필요합니다. 장면은 그대로 두고 기존 3D 보기에서 계속 작업해 주세요.";
    case "unavailable":
      return "이 브라우저에는 WebXR API가 없습니다. 최신 지원 브라우저 또는 기기에서 다시 열어 주세요.";
    case "unsupported":
      return `${mode ? MODE_LABELS[mode] : "선택한 몰입형 모드"}를 이 기기에서 지원하지 않습니다. 기존 3D 보기는 계속 사용할 수 있습니다.`;
    case "busy":
      return "다른 AR·VR 전환이 진행 중입니다. 전환이 끝난 뒤 다시 시도해 주세요.";
    case "request-failed":
      return "카메라·헤드셋 권한이 거절됐거나 기기 세션을 시작하지 못했습니다. 브라우저 권한을 확인한 뒤 다시 시도해 주세요.";
    case "renderer-failed":
      return "3D 렌더러가 WebXR 세션에 연결되지 않아 기존 보기로 돌아왔습니다. 장면 데이터는 바뀌지 않았습니다.";
    case "disposed":
      return "닫힌 3D 장면에서는 몰입형 미리보기를 시작할 수 없습니다. 편집기를 다시 열어 주세요.";
  }
}

function sessionStatusMessage(
  sessionState: StudioWebXrSessionState,
  support: StudioWebXrSupportSnapshot | null,
  supportPending: boolean,
  disabledReason: string | null,
): string {
  if (sessionState.status === "requesting") {
    return `${MODE_LABELS[sessionState.mode]}를 여는 중입니다. 기기의 권한 요청을 확인해 주세요.`;
  }
  if (sessionState.status === "presenting") {
    return `${MODE_LABELS[sessionState.mode]}가 실행 중입니다. 종료하면 기존 3D 편집 보기로 돌아옵니다.`;
  }
  if (sessionState.status === "ending") {
    return `${MODE_LABELS[sessionState.mode]}를 종료하고 기존 3D 보기로 돌아가는 중입니다.`;
  }
  if (sessionState.status === "error") {
    const message = errorMessage(sessionState.code, sessionState.mode);
    if (disabledReason) return `${message} 현재 작업 잠금: ${disabledReason}`;
    if (supportPending) return `${message} 기기 지원 여부를 다시 확인하는 중입니다.`;
    return message;
  }
  if (disabledReason) return disabledReason;
  if (supportPending) return "이 브라우저와 기기의 WebXR 지원 여부를 확인하는 중입니다.";
  if (support && !support.secureContext) {
    return "HTTPS 보안 연결이 없어 AR·VR 미리보기를 시작할 수 없습니다.";
  }
  if (!support) {
    return "아직 기기 지원을 확인하지 않았습니다. 실행하면 브라우저가 선택한 모드를 직접 확인합니다.";
  }
  if (support.immersiveAr === "unsupported" && support.immersiveVr === "unsupported") {
    return "이 기기는 몰입형 AR·VR 모드를 지원하지 않습니다. 기존 3D 미리보기는 그대로 사용할 수 있습니다.";
  }
  if (support.immersiveAr === "unknown" || support.immersiveVr === "unknown") {
    return "일부 모드의 지원 여부를 확인하지 못했습니다. 실행 시 브라우저가 다시 판정합니다.";
  }
  return "사용할 모드를 선택하세요. 브라우저의 카메라·헤드셋 권한 요청은 실행할 때만 표시됩니다.";
}

function supportLabel(level: StudioWebXrSupportLevel): string {
  if (level === "supported") return "사용 가능";
  if (level === "unsupported") return "지원 안 함";
  return "실행 시 확인";
}

function invokeControlledAction(action: () => void | Promise<unknown>): void {
  try {
    void Promise.resolve(action()).catch(() => undefined);
  } catch {
    // The controlled session authority owns and announces transition failures.
  }
}

export function StudioBg3dImmersivePanel({
  support,
  sessionState,
  onStart,
  onEnd,
  supportPending = false,
  disabledReason = null,
  savedShotCount,
}: StudioBg3dImmersivePanelProps) {
  const titleId = useId();
  const authorityId = useId();
  const arDescriptionId = useId();
  const vrDescriptionId = useId();
  const statusId = useId();
  const arSupport = modeSupport(support, "immersive-ar");
  const vrSupport = modeSupport(support, "immersive-vr");
  const normalizedShotCount = savedShotCount === undefined
    ? null
    : Number.isFinite(savedShotCount)
      ? Math.max(0, Math.floor(savedShotCount))
      : 0;
  const transitionActive = sessionState.status === "requesting"
    || sessionState.status === "ending";
  const sessionActive = sessionState.status === "presenting"
    || sessionState.status === "ending";
  const activeMode = sessionState.status === "idle" ? null : sessionState.mode;
  const secureContextBlocked = support?.secureContext === false
    || (sessionState.status === "error" && sessionState.code === "insecure-context");
  const terminalSessionBlocked = sessionState.status === "error"
    && (sessionState.code === "unavailable" || sessionState.code === "disposed");
  const unsupportedErrorMode = sessionState.status === "error"
    && sessionState.code === "unsupported"
    ? sessionState.mode
    : null;
  const startLocked = supportPending
    || transitionActive
    || sessionActive
    || Boolean(disabledReason)
    || secureContextBlocked
    || terminalSessionBlocked;
  const arCapabilityBlocked = arSupport === "unsupported"
    || unsupportedErrorMode === "immersive-ar";
  const vrCapabilityBlocked = vrSupport === "unsupported"
    || unsupportedErrorMode === "immersive-vr";
  const arDisabled = startLocked || arCapabilityBlocked;
  const vrDisabled = startLocked
    || vrSupport === "unsupported"
    || vrCapabilityBlocked;
  const liveMessage = sessionStatusMessage(
    sessionState,
    support,
    supportPending,
    disabledReason,
  );
  const alertState = sessionState.status === "error" || secureContextBlocked;

  return (
    <section
      aria-labelledby={titleId}
      aria-describedby={authorityId}
      aria-busy={supportPending || transitionActive}
      className="space-y-4"
      data-testid="studio-bg3d-immersive-panel"
    >
      <header className="flex items-start gap-2.5">
        <span
          className="grid size-9 shrink-0 place-items-center rounded-lg border border-accent/35 bg-accent-soft text-accent"
          aria-hidden
        >
          <Glasses size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="text-sm font-bold text-fg">
            몰입형 장면 미리보기
          </h3>
          <p id={authorityId} className="mt-1 text-[0.7rem] leading-relaxed text-fg-3">
            카메라·헤드셋·추적 공간은 현재 브라우저 세션에서만 사용합니다. 프로젝트,
            OPFS, Undo 기록에는 기기 세션을 저장하지 않으며 3D 장면 원본은 그대로 유지됩니다.
          </p>
        </div>
      </header>

      <div
        className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2"
        role="group"
        aria-label="몰입형 미리보기 모드"
      >
        <button
          type="button"
          aria-label="AR 미니어처 미리보기"
          aria-describedby={`${arDescriptionId} ${statusId}`}
          aria-busy={sessionState.status === "requesting" && activeMode === "immersive-ar"}
          aria-disabled={arDisabled}
          disabled={startLocked}
          className={cx(
            "group min-h-28 rounded-xl border p-3 text-left transition-colors",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            "aria-disabled:cursor-not-allowed aria-disabled:opacity-45 disabled:cursor-not-allowed disabled:opacity-45",
            activeMode === "immersive-ar" && sessionActive
              ? "border-accent/60 bg-accent-soft"
              : "border-line bg-card hover:border-accent/45 hover:bg-raised",
          )}
          onClick={() => {
            if (arDisabled) return;
            invokeControlledAction(() => onStart("immersive-ar"));
          }}
        >
          <span className="flex items-start justify-between gap-3">
            <Box
              size={18}
              className="shrink-0 text-accent"
              aria-hidden
            />
            <span
              className={cx(
                "rounded-full border px-2 py-0.5 text-[0.6rem] font-bold",
                arSupport === "supported"
                  ? "border-good/35 bg-[oklch(0.80_0.15_150/0.10)] text-good"
                  : arSupport === "unsupported"
                    ? "border-bad/35 bg-[oklch(0.66_0.20_25/0.10)] text-bad"
                    : "border-line bg-panel text-fg-3",
              )}
              aria-hidden
            >
              {supportLabel(arSupport)}
            </span>
          </span>
          <span className="mt-3 block text-xs font-bold text-fg">
            AR 미니어처 미리보기
          </span>
          <span
            id={arDescriptionId}
            className="mt-1 block text-[0.68rem] leading-relaxed text-fg-3"
          >
            현재 시점 앞 약 2m에 장면을 미니어처로 자동 맞춰 배치합니다.
            {arCapabilityBlocked ? " 이 기기에서는 AR을 열 수 없습니다." : ""}
          </span>
        </button>

        <button
          type="button"
          aria-label="VR 장면 미리보기"
          aria-describedby={`${vrDescriptionId} ${statusId}`}
          aria-busy={sessionState.status === "requesting" && activeMode === "immersive-vr"}
          aria-disabled={vrDisabled}
          disabled={startLocked}
          className={cx(
            "group min-h-28 rounded-xl border p-3 text-left transition-colors",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            "aria-disabled:cursor-not-allowed aria-disabled:opacity-45 disabled:cursor-not-allowed disabled:opacity-45",
            activeMode === "immersive-vr" && sessionActive
              ? "border-accent/60 bg-accent-soft"
              : "border-line bg-card hover:border-accent/45 hover:bg-raised",
          )}
          onClick={() => {
            if (vrDisabled) return;
            invokeControlledAction(() => onStart("immersive-vr"));
          }}
        >
          <span className="flex items-start justify-between gap-3">
            <Glasses
              size={18}
              className="shrink-0 text-accent"
              aria-hidden
            />
            <span
              className={cx(
                "rounded-full border px-2 py-0.5 text-[0.6rem] font-bold",
                vrSupport === "supported"
                  ? "border-good/35 bg-[oklch(0.80_0.15_150/0.10)] text-good"
                  : vrCapabilityBlocked
                    ? "border-bad/35 bg-[oklch(0.66_0.20_25/0.10)] text-bad"
                    : "border-line bg-panel text-fg-3",
              )}
              aria-hidden
            >
              {supportLabel(vrSupport)}
            </span>
          </span>
          <span className="mt-3 block text-xs font-bold text-fg">
            VR 장면 미리보기
          </span>
          <span
            id={vrDescriptionId}
            className="mt-1 block text-[0.68rem] leading-relaxed text-fg-3"
          >
            현재 canonical 카메라 구도를 실제 스케일로 검토합니다.
            {normalizedShotCount !== null && normalizedShotCount > 0
              ? ` 저장된 컷 ${normalizedShotCount}개는 편집기로 돌아와 전환할 수 있습니다.`
              : " 컷 순회와 공간 Story Stop은 후속 기능입니다."}
            {vrSupport === "unsupported" || unsupportedErrorMode === "immersive-vr"
              ? " 이 기기에서는 VR을 열 수 없습니다."
              : ""}
          </span>
        </button>
      </div>

      <div
        id={statusId}
        role={alertState ? "alert" : "status"}
        aria-live={alertState ? "assertive" : "polite"}
        aria-atomic="true"
        className={cx(
          "flex min-h-11 items-start gap-2 rounded-lg border px-3 py-2 text-[0.7rem] leading-relaxed",
          alertState
            ? "border-bad/40 bg-[oklch(0.66_0.20_25/0.10)] text-fg"
            : sessionState.status === "presenting"
              ? "border-accent/45 bg-accent-soft text-fg"
              : "border-line bg-panel/75 text-fg-2",
        )}
      >
        {sessionState.status === "requesting" || sessionState.status === "ending" || supportPending ? (
          <Loader2
            size={14}
            className="mt-0.5 shrink-0 animate-spin text-accent motion-reduce:animate-none"
            aria-hidden
          />
        ) : alertState ? (
          <TriangleAlert size={14} className="mt-0.5 shrink-0 text-bad" aria-hidden />
        ) : sessionState.status === "presenting" ? (
          <ShieldCheck size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden />
        ) : (
          <LockKeyhole size={14} className="mt-0.5 shrink-0 text-fg-3" aria-hidden />
        )}
        <span>{liveMessage}</span>
      </div>

      {sessionActive ? (
        <button
          type="button"
          aria-label="몰입형 미리보기 종료"
          aria-describedby={statusId}
          disabled={sessionState.status === "ending"}
          className={cx(
            STUDIO_BG3D_CONTROL_BUTTON,
            "w-full border-line bg-card text-fg hover:bg-raised",
          )}
          onClick={() => invokeControlledAction(onEnd)}
        >
          {sessionState.status === "ending" ? (
            <Loader2
              size={14}
              className="animate-spin motion-reduce:animate-none"
              aria-hidden
            />
          ) : (
            <Square size={13} fill="currentColor" aria-hidden />
          )}
          {sessionState.status === "ending" ? "종료 중" : "몰입형 미리보기 종료"}
        </button>
      ) : null}
    </section>
  );
}
