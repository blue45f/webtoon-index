import { describe, expect, it, vi } from "vitest";

import { Bg3dModelLibraryError } from "../bg3d/bg3d-model-library";
import { StudioBg3dValidationWorkerError } from "../bg3d/studio-bg3d-glb-validation-worker-client";

import { buildStudioLift3dDepthField } from "./studio-lift3d-depth";
import { encodeStudioLift3dGlb } from "./studio-lift3d-glb";
import {
  createStudioLift3dImportItem,
  createStudioLift3dUploadSource,
  saveStudioLift3dToBg3dLibrary,
} from "./studio-lift3d-library-handoff";
import { extractStudioLift3dMask, resampleStudioLift3dImage } from "./studio-lift3d-mask";
import { buildStudioLift3dGeometry } from "./studio-lift3d-mesh";
import { discImage } from "./studio-lift3d.test-fixture";

import type { StudioLift3dGlbFile } from "./studio-lift3d-glb";

function liftedGlb(name = "주인공"): StudioLift3dGlbFile {
  const grid = resampleStudioLift3dImage(discImage(48), 48);
  const mask = extractStudioLift3dMask(grid, { mode: "alpha" });
  const depth = buildStudioLift3dDepthField(mask, grid, { profile: "round", smoothing: 1 });
  const built = buildStudioLift3dGeometry(mask, depth, {
    mode: "inflate",
    depthScale: 0.3,
    targetHeight: 1.7,
  });
  if (!built.ok) throw new Error(built.detail);
  const encoded = encodeStudioLift3dGlb(built.value, { name });
  if (!encoded.ok) throw new Error("encode failed");
  return encoded.value;
}

const UNKNOWN_RIGHTS = { status: "unknown", commercialUse: false } as const;

describe("Studio Lift 3D 라이브러리 등록", () => {
  it("파일 시스템을 거치지 않고 업로드 소스를 만든다", async () => {
    const glb = liftedGlb();
    const source = createStudioLift3dUploadSource(glb);

    expect(source.name).toBe(glb.fileName);
    expect(source.type).toBe("model/gltf-binary");
    expect(source.size).toBe(glb.bytes.byteLength);
    expect(new Uint8Array(await source.arrayBuffer())).toEqual(glb.bytes);
  });

  it("소스를 여러 번 읽어도 같은 바이트를 준다", async () => {
    const source = createStudioLift3dUploadSource(liftedGlb());
    const first = new Uint8Array(await source.arrayBuffer());
    const second = new Uint8Array(await source.arrayBuffer());
    expect(first).toEqual(second);
  });

  it("메인 스레드에서 중복 해싱하지 않고 권리만 실어 넘긴다", () => {
    // expectedSha256 은 외부 매니페스트를 든 호출자용이다. 여기서는 방금 만든 메모리 버퍼를
    // 그대로 넘기므로 대조할 제3의 출처가 없고, 라이브러리가 같은 바이트를 어차피 다시 해싱한다.
    const item = createStudioLift3dImportItem(liftedGlb(), { status: "owned", commercialUse: true });

    expect(item.expectedSha256).toBeUndefined();
    expect(item.rights).toEqual({ status: "owned", commercialUse: true });
  });

  it("확인 전 표기는 상업 이용 선언을 실어 보내지 않는다", () => {
    // 저장 레코드 불변식이 "unknown 이면 commercialUse 는 false" 다. 화면에서 체크가 남아 있어도
    // 여기서 굳혀 두지 않으면 보이는 값과 저장되는 값이 갈라진다.
    const item = createStudioLift3dImportItem(liftedGlb(), {
      status: "unknown",
      commercialUse: true,
    });

    expect(item.rights).toEqual({ status: "unknown", commercialUse: false });
  });

  it("퍼블릭 도메인의 상업 이용 선언을 잃지 않는다", () => {
    // status 만 넘기면 normalizeBg3dModelRights 가 commercialUse 를 false 로 굳혀, 퍼블릭
    // 도메인 모델이 "상업 이용 확인 필요" 로 뜨고 같은 GLB 를 업로드 패널에서 true 로 다시
    // 넣을 때 rights-conflict 가 난다(중복 판정이 이 필드까지 본다).
    const item = createStudioLift3dImportItem(liftedGlb(), {
      status: "public-domain",
      commercialUse: true,
    });

    expect(item.rights).toEqual({ status: "public-domain", commercialUse: true });
  });

  it("등록에 성공하면 검증된 레코드를 돌려준다", async () => {
    const glb = liftedGlb();
    const record = { id: "model-1", contentHash: "sha256:abc" };
    const saveVerifiedModel = vi.fn().mockResolvedValue(record);

    const result = await saveStudioLift3dToBg3dLibrary(
      glb,
      { status: "owned", commercialUse: true },
      {},
      { saveVerifiedModel },
    );

    expect(result).toEqual({ ok: true, record });
    const [item] = saveVerifiedModel.mock.calls[0]!;
    expect(item.file.name).toBe(glb.fileName);
    expect(item.rights).toEqual({ status: "owned", commercialUse: true });
  });

  it("라이브러리 오류 문장을 그대로 전달한다", async () => {
    const failure = new Bg3dModelLibraryError("file-too-large");
    const result = await saveStudioLift3dToBg3dLibrary(liftedGlb(), UNKNOWN_RIGHTS, {}, {
      saveVerifiedModel: vi.fn().mockRejectedValue(failure),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toBe(failure.message);
    expect(result.detail).toContain("100MiB");
  });

  it("취소는 실패가 아니라 취소로 알린다", async () => {
    const aborted = new Error("aborted");
    aborted.name = "AbortError";
    const result = await saveStudioLift3dToBg3dLibrary(liftedGlb(), UNKNOWN_RIGHTS, {}, {
      saveVerifiedModel: vi.fn().mockRejectedValue(aborted),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toContain("취소");
  });

  it("취소가 아닌 워커 오류도 내부 식별자 대신 읽을 문장으로 바꾼다", async () => {
    // StudioBg3dValidationWorkerError 의 message 는 studio-bg3d-validation-worker:timeout
    // 같은 내부 식별자다. 취소만 알아보면 나머지가 그대로 화면에 뜬다.
    const cases: ReadonlyArray<readonly [
      ConstructorParameters<typeof StudioBg3dValidationWorkerError>[0],
      string,
    ]> = [
      ["timeout", "제한 시간"],
      ["protocol", "끊겼습니다"],
      ["worker-failed", "끊겼습니다"],
      ["disposed", "끊겼습니다"],
      ["basis-worker-attestation-required", "새로고침"],
    ];

    for (const [code, expected] of cases) {
      const result = await saveStudioLift3dToBg3dLibrary(liftedGlb(), UNKNOWN_RIGHTS, {}, {
        saveVerifiedModel: vi.fn().mockRejectedValue(new StudioBg3dValidationWorkerError(code)),
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.detail).toContain(expected);
      expect(result.detail).not.toContain("studio-bg3d-validation-worker");
    }
  });

  it("라이브러리의 진짜 취소(검증 워커 오류)도 취소로 알아본다", async () => {
    // signal 로 끊으면 오는 것은 AbortError 가 아니라 StudioBg3dValidationWorkerError("aborted") 다.
    // 이름만 보면 놓치고 studio-bg3d-validation-worker:aborted 를 사용자에게 그대로 보여준다.
    const workerAbort = new StudioBg3dValidationWorkerError("aborted");
    const result = await saveStudioLift3dToBg3dLibrary(liftedGlb(), UNKNOWN_RIGHTS, {}, {
      saveVerifiedModel: vi.fn().mockRejectedValue(workerAbort),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toContain("취소");
    expect(result.detail).not.toContain("studio-bg3d-validation-worker");
  });
});
