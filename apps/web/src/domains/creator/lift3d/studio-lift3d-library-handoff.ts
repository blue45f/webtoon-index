/**
 * Studio Lift 3D — 리프트 결과를 배경 3D 모델 라이브러리에 바로 등록하는 경계.
 *
 * 이전에는 GLB 를 내려받아 사용자가 배경 편집기에서 다시 올려야 했다. 같은 브라우저 안에서
 * 만든 파일을 다시 고르게 하는 왕복인데, 그 사이에 파일이 다운로드 폴더에 쌓이고 어느 것이
 * 방금 만든 것인지도 흐려진다.
 *
 * 새로 저장 경로를 만들지는 않는다. 기존 모델 라이브러리의 **검증된 등록 경계**를 그대로 타므로
 * 여기서 넣은 모델도 업로드한 모델과 똑같이 GLB 안전 검사·무결성 확인을 거치고, 같은 저장소에
 * 같은 형태로 남는다.
 */

import {
  saveVerifiedBg3dModelV12,
  type Bg3dModelImportItem,
  type Bg3dModelUploadSource,
  type Bg3dModelVerificationOptions,
  type Bg3dVerifiedStoredRecord,
} from "../bg3d/bg3d-model-library";
import { STUDIO_BG3D_GLB_MIME } from "../bg3d/studio-bg3d-scene-document";

import type { StudioLift3dGlbFile } from "./studio-lift3d-glb";

/**
 * 등록 시 선언할 수 있는 이용 권리.
 *
 * 편집기 업로드 패널의 네 가지 중 `licensed` 는 뺐다. `normalizeBg3dModelRights` 는 그 상태에서
 * 비어 있지 않은 `licenseName` 을 요구하고, 없으면 값 전체를 기본값(unknown)으로 되돌린다.
 * 라이선스 이름을 받는 입력이 없는 채로 그 선택지를 내주면 "구매·허가로 등록했다"고 알리면서
 * 실제로는 unknown 으로 저장되고, 나중에 같은 해시를 진짜 라이선스 정보와 함께 올릴 때
 * `rights-conflict` 까지 난다. 받을 수 없는 선언은 아예 제안하지 않는다.
 */
export type StudioLift3dLibraryRights = "owned" | "public-domain" | "unknown";

/**
 * 등록에 실어 보낼 권리 선언 한 벌.
 *
 * 상태만 넘기면 안 된다. `normalizeBg3dModelRights` 는 `commercialUse` 를 받지 못하면 `false`
 * 로 굳히므로, 퍼블릭 도메인으로 올린 모델조차 "상업 이용 확인 필요" 로 표시된다. 게다가 중복
 * 판정이 이 필드까지 비교하는 탓에, 같은 GLB 를 나중에 업로드 패널에서 `commercialUse: true`
 * 로 다시 넣으면 `rights-conflict` 가 난다. 상태와 상업 이용은 함께 정해야 한다.
 */
export interface StudioLift3dRightsDeclaration {
  readonly status: StudioLift3dLibraryRights;
  readonly commercialUse: boolean;
}

/**
 * 라이브러리가 실제로 저장할 값으로 굳힌다.
 *
 * `unknown` 은 언제나 상업 이용 불가다 — 저장 레코드 불변식이 그렇게 되어 있어서, 여기서
 * 맞춰 두지 않으면 화면의 체크와 저장된 값이 조용히 갈라진다.
 */
function normalizeDeclaration(
  rights: StudioLift3dRightsDeclaration,
): { readonly status: StudioLift3dLibraryRights; readonly commercialUse: boolean } {
  return {
    status: rights.status,
    commercialUse: rights.status !== "unknown" && rights.commercialUse,
  };
}

export interface StudioLift3dLibraryPorts {
  readonly saveVerifiedModel: (
    item: Bg3dModelImportItem,
    options?: Bg3dModelVerificationOptions,
  ) => Promise<Bg3dVerifiedStoredRecord>;
}

export const DEFAULT_STUDIO_LIFT3D_LIBRARY_PORTS: StudioLift3dLibraryPorts = Object.freeze({
  saveVerifiedModel: (
    item: Bg3dModelImportItem,
    options?: Bg3dModelVerificationOptions,
  ) => saveVerifiedBg3dModelV12(item, options ?? {}),
});

/**
 * GLB 바이트를 라이브러리가 받는 업로드 소스로 감싼다.
 *
 * `File` 을 만들지 않는다 — 라이브러리 경계는 이름·크기·형식과 `arrayBuffer()` 만 요구하는
 * 덕 타입이라, 파일 시스템을 거치지 않고 메모리에서 곧장 넘길 수 있다. 호출할 때마다 사본을
 * 새로 떠서 넘기므로, 검증 도중 원본 버퍼가 다른 곳에서 바뀌어도 저장된 바이트는 흔들리지 않는다.
 */
export function createStudioLift3dUploadSource(
  glb: StudioLift3dGlbFile,
): Bg3dModelUploadSource {
  const owned = Uint8Array.from(glb.bytes);
  return {
    name: glb.fileName,
    size: owned.byteLength,
    type: STUDIO_BG3D_GLB_MIME,
    async arrayBuffer(): Promise<ArrayBuffer> {
      return Uint8Array.from(owned).buffer;
    },
  };
}

/**
 * 라이브러리에 넘길 등록 항목.
 *
 * `expectedSha256` 은 넣지 않는다. 그 필드는 **외부에서 온 신뢰할 수 있는 매니페스트**를 든
 * 호출자가 바이트와 대조하라고 있는 것인데, 여기서는 방금 이 자리에서 만든 메모리 버퍼를
 * 그대로 넘긴다. 대조할 제3의 출처가 없으므로 해시를 앞서 계산해봤자 라이브러리가 같은
 * 바이트에 대해 곧바로 다시 계산하는 값을 한 번 더 구하는 것뿐이고, 100MiB 까지 갈 수 있는
 * 동기 해싱으로 메인 스레드를 붙잡는 대가만 남는다.
 *
 * `rights` 는 호출자가 반드시 정해야 한다. 리프트 결과의 이용 권리는 **원화의 권리**를 따르는데
 * 그건 이 코드가 알 수 없다 — 편집기 업로드 경로가 사용자에게 묻는 것과 같은 이유다.
 * 상업 이용 여부까지 함께 받는 이유는 `StudioLift3dRightsDeclaration` 주석에 적어 두었다.
 */
export function createStudioLift3dImportItem(
  glb: StudioLift3dGlbFile,
  rights: StudioLift3dRightsDeclaration,
): Bg3dModelImportItem {
  return {
    file: createStudioLift3dUploadSource(glb),
    rights: normalizeDeclaration(rights),
  };
}

/**
 * 취소 판정.
 *
 * `signal` 로 끊으면 라이브러리의 검증 워커가 던지는 것은 `AbortError` 가 아니라
 * `StudioBg3dValidationWorkerError("aborted")` 다. 이름만 보면 진짜 취소를 놓치고
 * `studio-bg3d-validation-worker:aborted` 라는 내부 문자열을 사용자에게 그대로 보여주게 된다.
 */
function isAbort(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError") return true;
  return (error as { readonly code?: unknown }).code === "aborted";
}

/**
 * 검증 워커 오류를 사람이 읽을 문장으로 옮긴다.
 *
 * `StudioBg3dValidationWorkerError` 의 `message` 는 `studio-bg3d-validation-worker:timeout`
 * 같은 내부 식별자다. 취소만 알아보고 나머지를 그대로 흘려보내면, 이 모듈이 약속한 "읽을 수
 * 있는 실패 사유" 대신 내부 문자열이 화면에 뜬다. 사유마다 다음에 할 일이 다르므로 함께 적는다.
 */
function workerFailureDetail(error: unknown): string | null {
  if (!(error instanceof Error) || error.name !== "StudioBg3dValidationWorkerError") return null;
  const { code } = error as { readonly code?: unknown };
  switch (code) {
    case "timeout":
      return "3D 모델 검사가 제한 시간을 넘겼습니다. 해상도를 낮춰 다시 만들어 등록해 보세요.";
    case "basis-worker-attestation-required":
      return "3D 모델 검사기를 신뢰할 수 없어 등록을 멈췄습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.";
    case "disposed":
    case "protocol":
    case "worker-failed":
      return "3D 모델 검사가 중간에 끊겼습니다. 잠시 후 다시 등록해 주세요.";
    default:
      return null;
  }
}

export type StudioLift3dLibrarySaveResult =
  | { readonly ok: true; readonly record: Bg3dVerifiedStoredRecord }
  | { readonly ok: false; readonly detail: string };

/**
 * 리프트 GLB 를 배경 3D 모델 라이브러리에 등록한다.
 *
 * 실패는 던지지 않고 사유 문장으로 돌려준다. 라이브러리 오류는 이미 사용자가 읽을 수 있는
 * 한국어 메시지를 달고 오므로 그대로 전달한다.
 */
export async function saveStudioLift3dToBg3dLibrary(
  glb: StudioLift3dGlbFile,
  rights: StudioLift3dRightsDeclaration,
  options: Bg3dModelVerificationOptions = {},
  ports: StudioLift3dLibraryPorts = DEFAULT_STUDIO_LIFT3D_LIBRARY_PORTS,
): Promise<StudioLift3dLibrarySaveResult> {
  try {
    const record = await ports.saveVerifiedModel(
      createStudioLift3dImportItem(glb, rights),
      options,
    );
    return { ok: true, record };
  } catch (error) {
    if (isAbort(error)) {
      return { ok: false, detail: "3D 모델 등록을 취소했습니다." };
    }
    const workerDetail = workerFailureDetail(error);
    if (workerDetail !== null) return { ok: false, detail: workerDetail };
    return {
      ok: false,
      detail: error instanceof Error && error.message.length > 0
        ? error.message
        : "3D 모델 라이브러리에 등록하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    };
  }
}
