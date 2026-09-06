import { studioCompanionPopupGuidance } from "./studio-companion-popup-guidance";

import type { StudioCompanionPrimaryRuntime } from "./studio-tools-companion";

export type StudioToolsCompanionProtocol = typeof import("./studio-tools-companion");
export type StudioToolsCompanionReviewProjectionInput = Parameters<
  StudioToolsCompanionProtocol["createStudioCompanionReviewProjectionFromSource"]
>[0];
export type StudioToolsCompanionPrimaryRuntime = StudioCompanionPrimaryRuntime & {
  protocol: StudioToolsCompanionProtocol;
};
type StudioCompanionReferenceCaptureRuntimeModule = typeof import("@/domains/creator/studio/components/runtime/studio-companion-reference-capture-runtime"
);
export type StudioCompanionReferenceCaptureRuntime = ReturnType<
  StudioCompanionReferenceCaptureRuntimeModule["createStudioCompanionReferenceCaptureRuntime"]
>;
export type StudioToolsCompanionRuntimeInput = Omit<
  Parameters<StudioToolsCompanionProtocol["startStudioCompanionPrimaryRuntimeFromSources"]>[0],
  "getReviewProjectionInput"
> & { getReviewProjectionInput?: () => StudioToolsCompanionReviewProjectionInput };

type StudioToolsCompanionProtocolModule = typeof import("./studio-tools-companion");

let studioToolsCompanionProtocolPromise: Promise<StudioToolsCompanionProtocolModule> | null = null;
let studioCompanionReferenceCaptureRuntimePromise:
  Promise<StudioCompanionReferenceCaptureRuntimeModule> | null = null;

const STUDIO_TOOLS_COMPANION_RESERVATION_FEATURES =
  "popup=yes,width=520,height=820,menubar=no,toolbar=no,location=no,status=no";

function loadStudioToolsCompanionProtocol():
Promise<StudioToolsCompanionProtocolModule> {
  return studioToolsCompanionProtocolPromise ??= import("./studio-tools-companion")
    .catch((error: unknown) => {
      studioToolsCompanionProtocolPromise = null;
      throw error;
    });
}

function loadStudioCompanionReferenceCaptureRuntimeModule():
Promise<StudioCompanionReferenceCaptureRuntimeModule> {
  return studioCompanionReferenceCaptureRuntimePromise ??= import("@/domains/creator/studio/components/runtime/studio-companion-reference-capture-runtime"
  ).catch((error: unknown) => {
    studioCompanionReferenceCaptureRuntimePromise = null;
    throw error;
  });
}

export async function startStudioToolsCompanionPrimaryRuntime(
  input: StudioToolsCompanionRuntimeInput,
): Promise<StudioToolsCompanionPrimaryRuntime | null> {
  const protocol = await loadStudioToolsCompanionProtocol();
  const runtime = protocol.startStudioCompanionPrimaryRuntimeFromSources(input);
  return runtime ? { protocol, ...runtime } : null;
}

export function loadStudioCompanionReferenceCaptureRuntime():
Promise<StudioCompanionReferenceCaptureRuntimeModule> {
  return loadStudioCompanionReferenceCaptureRuntimeModule();
}

export function openStudioToolsCompanionForMenu(input: {
  ensureRuntime: () => Promise<StudioToolsCompanionPrimaryRuntime | null>;
  runtimeRef: { current: StudioToolsCompanionPrimaryRuntime | null };
  windowRef: { current: Window | null };
  announce: (message: string) => void;
  workId: string | null;
  t: (key: string) => string;
}): void {
  const localize = (key: string, fallback: string) => {
    const translated = input.t(key);
    return translated === key ? fallback : translated;
  };
  const ready = input.runtimeRef.current;
  if (ready) {
    ready.protocol.openReadyStudioToolsCompanionForMenu({
      sessionId: ready.sessionId,
      binding: ready.binding,
      windowRef: input.windowRef,
      announce: input.announce,
      workId: input.workId,
      t: input.t,
    });
    return;
  }

  const existingReservation = input.windowRef.current;
  if (existingReservation && !existingReservation.closed) {
    try {
      existingReservation.focus();
    } catch {
      // Browsers may deny focus while the reserved popup is still loading.
    }
    input.announce(
      localize(
        "studio.toolsCompanion.open.readyMessage",
        "도구 창을 준비 중입니다 · 잠시만 기다려 주세요",
      ),
    );
    return;
  }

  let reservation: Window | null = null;
  try {
    reservation = window.open("", "_blank", STUDIO_TOOLS_COMPANION_RESERVATION_FEATURES);
  } catch {
    reservation = null;
  }
  if (!reservation) {
    // 인앱 브라우저에는 팝업 허용 설정이 없다 — 환경에 맞는 실행 가능한 안내로 바꾼다.
    const guidance = studioCompanionPopupGuidance();
    input.announce(localize(guidance.key, guidance.text));
    return;
  }
  try {
    reservation.opener = null;
  } catch {
    // The lazy companion protocol retries this before navigation; keep the popup usable here.
  }
  input.windowRef.current = reservation;
  input.announce(
    localize(
      "studio.toolsCompanion.open.readyToOpen",
      "도구 창을 준비 중입니다 · 연결이 끝나면 자동으로 열립니다",
    ),
  );

  const abandonReservation = (message: string) => {
    try {
      reservation?.close();
    } catch {
      // Ignore a reservation already closed by the browser.
    }
    if (input.windowRef.current !== reservation) return;
    input.windowRef.current = null;
    input.announce(message);
  };
  const reservationTimeout = globalThis.setTimeout(() => {
    abandonReservation(
      localize(
        "studio.toolsCompanion.open.prepareTimeout",
        "도구 창 준비 시간이 초과됐습니다. 다시 시도해 주세요.",
      ),
    );
  }, 8_000);
  const unavailableMessage = localize(
    "studio.toolsCompanion.open.unavailable",
    "도구 창을 사용할 수 없습니다. 다시 시도해 주세요.",
  );

  void input.ensureRuntime().then((runtime) => {
    globalThis.clearTimeout(reservationTimeout);
    if (!runtime) {
      abandonReservation(unavailableMessage);
      return;
    }
    runtime.protocol.completeReservedStudioToolsCompanionWindow({
      sessionId: runtime.sessionId,
      reservation,
      windowRef: input.windowRef,
      announce: input.announce,
      workId: input.workId,
      t: input.t,
    });
  }).catch(() => {
    globalThis.clearTimeout(reservationTimeout);
    abandonReservation(unavailableMessage);
  });
}
