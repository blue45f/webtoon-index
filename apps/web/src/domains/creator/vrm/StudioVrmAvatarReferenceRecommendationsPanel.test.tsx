// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  STUDIO_VRM_AVATAR_REFERENCE_MODEL_ID,
  STUDIO_VRM_AVATAR_REFERENCE_MODEL_REVISION,
  STUDIO_VRM_AVATAR_REFERENCE_MODEL_SHA256,
  STUDIO_VRM_AVATAR_REFERENCE_PROVIDER_ID,
  StudioVrmAvatarReferenceError,
  rankStudioVrmAvatarReferenceRecommendations,
  type StudioVrmAvatarReferenceCatalogue,
  type StudioVrmAvatarReferenceRecommendationReceipt,
} from "./studio-vrm-avatar-reference-recommendation";
import { StudioVrmAvatarReferenceRecommendationsPanel } from "./StudioVrmAvatarReferenceRecommendationsPanel";

afterEach(cleanup);

function catalogue(): StudioVrmAvatarReferenceCatalogue {
  return {
    version: 1,
    providerId: STUDIO_VRM_AVATAR_REFERENCE_PROVIDER_ID,
    modelId: STUDIO_VRM_AVATAR_REFERENCE_MODEL_ID,
    modelRevision: STUDIO_VRM_AVATAR_REFERENCE_MODEL_REVISION,
    modelSha256: STUDIO_VRM_AVATAR_REFERENCE_MODEL_SHA256,
    catalogueRevision: "avatar-forge-render-v1",
    entries: [
      {
        presetId: "natural-short",
        embedding: { headIndex: 0, headName: "feature", floatEmbedding: [1, 0] },
      },
      {
        presetId: "soft-bob",
        embedding: { headIndex: 0, headName: "feature", floatEmbedding: [0, 1] },
      },
      {
        presetId: "romance-long",
        embedding: { headIndex: 0, headName: "feature", floatEmbedding: [-1, 0] },
      },
    ],
  };
}

function receipt(query: readonly number[] = [1, 0]): StudioVrmAvatarReferenceRecommendationReceipt {
  return rankStudioVrmAvatarReferenceRecommendations({
    catalogue: catalogue(),
    queryEmbedding: { headIndex: 0, headName: "feature", floatEmbedding: query },
    queryEmbeddingSha256: "a".repeat(64),
    topK: 3,
    cosineSimilarity: (left, right) => {
      const leftVector = left.floatEmbedding!;
      const rightVector = right.floatEmbedding!;
      return leftVector.reduce((sum, value, index) => sum + value * rightVector[index]!, 0);
    },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function upload(name = "reference.png") {
  const consent = screen.getByRole("checkbox", { name: /MediaPipe 분석/u });
  if (!(consent as HTMLInputElement).checked) fireEvent.click(consent);
  const input = screen.getByLabelText("아바타 스타일 참고 이미지 선택");
  fireEvent.change(input, {
    target: { files: [new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" })] },
  });
}

describe("StudioVrmAvatarReferenceRecommendationsPanel", () => {
  it("requires explicit MediaPipe metadata consent before reading a reference image", async () => {
    const analyzeImage = vi.fn(async () => receipt());
    render(
      <StudioVrmAvatarReferenceRecommendationsPanel
        catalogue={catalogue()}
        runtimeSupported
        analyzeImage={analyzeImage}
        onPreview={vi.fn()}
        onApply={vi.fn()}
      />,
    );

    const consent = screen.getByRole("checkbox", { name: /MediaPipe 분석/u });
    const input = screen.getByLabelText("아바타 스타일 참고 이미지 선택");
    const selectButton = screen.getByRole("button", { name: "참고 이미지 선택" });
    expect((consent as HTMLInputElement).checked).toBe(false);
    expect((input as HTMLInputElement).disabled).toBe(true);
    expect((selectButton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/이용·성능 메타데이터를 처리할 수 있습니다/u)).toBeTruthy();
    expect(screen.getByRole("link", { name: "MediaPipe API 약관" })).toBeTruthy();

    fireEvent.change(input, {
      target: { files: [new File([new Uint8Array([1])], "blocked.png", { type: "image/png" })] },
    });
    expect(analyzeImage).not.toHaveBeenCalled();

    fireEvent.click(consent);
    expect((input as HTMLInputElement).disabled).toBe(false);
    upload();
    await waitFor(() => expect(analyzeImage).toHaveBeenCalledOnce());
  });

  it("shows an honest unavailable state with an explicit retry", () => {
    const onCatalogueRetry = vi.fn();
    render(
      <StudioVrmAvatarReferenceRecommendationsPanel
        catalogue={null}
        catalogueStatus="unavailable"
        catalogueUnavailableReason="추천 기준 파일을 안전하게 검증하지 못했습니다."
        runtimeSupported
        onCatalogueRetry={onCatalogueRetry}
        onPreview={vi.fn()}
        onApply={vi.fn()}
      />,
    );

    expect(screen.getByRole("status").textContent).toContain("안전하게 검증하지 못했습니다");
    expect(screen.queryByLabelText("아바타 스타일 참고 이미지 선택")).toBeNull();
    expect(screen.getByText(/추천은 자동 적용되지 않습니다/u)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "추천 기준 다시 불러오기" }));
    expect(onCatalogueRetry).toHaveBeenCalledOnce();
  });

  it("reports lazy catalogue loading without exposing an upload action early", () => {
    render(
      <StudioVrmAvatarReferenceRecommendationsPanel
        catalogue={null}
        catalogueStatus="loading"
        runtimeSupported
        onPreview={vi.fn()}
        onApply={vi.fn()}
      />,
    );

    expect(screen.getByRole("status").textContent).toContain("추천 기준을 불러오는 중");
    expect(screen.queryByLabelText("아바타 스타일 참고 이미지 선택")).toBeNull();
  });

  it("reports a missing Worker/OffscreenCanvas runtime instead of falling back to heuristics", () => {
    render(
      <StudioVrmAvatarReferenceRecommendationsPanel
        catalogue={catalogue()}
        runtimeSupported={false}
        onPreview={vi.fn()}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("OffscreenCanvas");
    expect(screen.queryByRole("button", { name: "참고 이미지 선택" })).toBeNull();
  });

  it("never auto-applies a recommendation and keeps preview/apply as separate explicit actions", async () => {
    const onPreview = vi.fn();
    const onApply = vi.fn();
    const analyzeImage = vi.fn(async () => receipt());
    render(
      <StudioVrmAvatarReferenceRecommendationsPanel
        catalogue={catalogue()}
        runtimeSupported
        analyzeImage={analyzeImage}
        onPreview={onPreview}
        onApply={onApply}
      />,
    );

    upload();
    expect(await screen.findByText("1. 내추럴 숏")).toBeTruthy();
    expect(analyzeImage).toHaveBeenCalledOnce();
    expect(onPreview).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "내추럴 숏 프리셋 미리 보기" }));
    expect(onPreview).toHaveBeenCalledOnce();
    expect(onApply).not.toHaveBeenCalled();
    expect(onPreview.mock.calls[0]?.[0]).toMatchObject({
      presetId: "natural-short",
      state: { presetId: "natural-short" },
      receipt: { modelSha256: STUDIO_VRM_AVATAR_REFERENCE_MODEL_SHA256 },
    });

    fireEvent.click(screen.getByRole("button", { name: "내추럴 숏 프리셋 적용" }));
    expect(onApply).toHaveBeenCalledOnce();
    expect(onApply.mock.calls[0]?.[0].presetId).toBe("natural-short");
  });

  it("exposes an explicit way back from a runtime-only preview", async () => {
    const onPreviewClear = vi.fn();
    render(
      <StudioVrmAvatarReferenceRecommendationsPanel
        catalogue={catalogue()}
        runtimeSupported
        previewingPresetId="natural-short"
        analyzeImage={vi.fn(async () => receipt())}
        onPreview={vi.fn()}
        onPreviewClear={onPreviewClear}
        onApply={vi.fn()}
      />,
    );

    upload();
    expect(await screen.findByText(/임시로 보고 있습니다/u)).toBeTruthy();
    expect(onPreviewClear).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: /원래대로/u }));
    expect(onPreviewClear).toHaveBeenCalledTimes(2);
  });

  it("ignores an aborted stale upload even if its promise resolves late", async () => {
    const first = deferred<StudioVrmAvatarReferenceRecommendationReceipt>();
    const second = deferred<StudioVrmAvatarReferenceRecommendationReceipt>();
    const signals: AbortSignal[] = [];
    const analyzeImage = vi.fn((_file, _catalogue, options) => {
      signals.push(options?.signal as AbortSignal);
      return signals.length === 1 ? first.promise : second.promise;
    });
    render(
      <StudioVrmAvatarReferenceRecommendationsPanel
        catalogue={catalogue()}
        runtimeSupported
        analyzeImage={analyzeImage}
        onPreview={vi.fn()}
        onApply={vi.fn()}
      />,
    );

    upload("first.png");
    await waitFor(() => expect(analyzeImage).toHaveBeenCalledTimes(1));
    upload("second.png");
    await waitFor(() => expect(analyzeImage).toHaveBeenCalledTimes(2));
    expect(signals[0]?.aborted).toBe(true);

    await act(async () => first.resolve(receipt([1, 0])));
    expect(screen.queryByText("1. 내추럴 숏")).toBeNull();
    await act(async () => second.resolve(receipt([0, 1])));
    expect(await screen.findByText("1. 소프트 보브")).toBeTruthy();
  });

  it("surfaces a model error with recovery copy and keeps raw image previews out of the DOM", async () => {
    const analyzeImage = vi.fn(async () => {
      throw new StudioVrmAvatarReferenceError("model-unavailable");
    });
    const view = render(
      <StudioVrmAvatarReferenceRecommendationsPanel
        catalogue={catalogue()}
        runtimeSupported
        analyzeImage={analyzeImage}
        onPreview={vi.fn()}
        onApply={vi.fn()}
      />,
    );

    upload();
    expect((await screen.findByRole("alert")).textContent).toContain("네트워크 상태를 확인");
    expect(view.container.querySelector("img")).toBeNull();
    expect(view.container.innerHTML).not.toContain("blob:");
    expect(view.container.innerHTML).not.toContain("data:image");
  });

  it("aborts the in-flight generation on unmount", async () => {
    const pending = deferred<StudioVrmAvatarReferenceRecommendationReceipt>();
    let signal: AbortSignal | undefined;
    const analyzeImage = vi.fn((_file, _catalogue, options) => {
      signal = options?.signal;
      return pending.promise;
    });
    const view = render(
      <StudioVrmAvatarReferenceRecommendationsPanel
        catalogue={catalogue()}
        runtimeSupported
        analyzeImage={analyzeImage}
        onPreview={vi.fn()}
        onApply={vi.fn()}
      />,
    );
    upload();
    await waitFor(() => expect(analyzeImage).toHaveBeenCalledOnce());
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });

  it("revokes consent by aborting inference and clearing every transient result", async () => {
    const pending = deferred<StudioVrmAvatarReferenceRecommendationReceipt>();
    const onPreviewClear = vi.fn();
    let signal: AbortSignal | undefined;
    const analyzeImage = vi.fn((_file, _catalogue, options) => {
      signal = options?.signal;
      return pending.promise;
    });
    render(
      <StudioVrmAvatarReferenceRecommendationsPanel
        catalogue={catalogue()}
        runtimeSupported
        analyzeImage={analyzeImage}
        onPreview={vi.fn()}
        onPreviewClear={onPreviewClear}
        onApply={vi.fn()}
      />,
    );

    upload();
    await waitFor(() => expect(analyzeImage).toHaveBeenCalledOnce());
    const consent = screen.getByRole("checkbox", { name: /MediaPipe 분석/u });
    fireEvent.click(consent);

    expect(signal?.aborted).toBe(true);
    expect(onPreviewClear).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("reference.png")).toBeNull();
    expect((screen.getByRole("button", { name: "참고 이미지 선택" }) as HTMLButtonElement).disabled)
      .toBe(true);
  });

  it("aborts and clears an in-flight image when the hidden Forge surface releases its catalogue", async () => {
    const pending = deferred<StudioVrmAvatarReferenceRecommendationReceipt>();
    let signal: AbortSignal | undefined;
    const analyzeImage = vi.fn((_file, _catalogue, options) => {
      signal = options?.signal;
      return pending.promise;
    });
    const view = render(
      <StudioVrmAvatarReferenceRecommendationsPanel
        catalogue={catalogue()}
        catalogueStatus="ready"
        runtimeSupported
        analyzeImage={analyzeImage}
        onPreview={vi.fn()}
        onApply={vi.fn()}
      />,
    );
    upload();
    await waitFor(() => expect(analyzeImage).toHaveBeenCalledOnce());

    view.rerender(
      <StudioVrmAvatarReferenceRecommendationsPanel
        catalogue={null}
        catalogueStatus="idle"
        runtimeSupported
        analyzeImage={analyzeImage}
        onPreview={vi.fn()}
        onApply={vi.fn()}
      />,
    );
    expect(signal?.aborted).toBe(true);
    expect(screen.queryByText("reference.png")).toBeNull();
  });
});
