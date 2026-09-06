// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  STUDIO_ASSET_RIGHTS_MANIFEST_DISCLAIMER,
  STUDIO_ASSET_RIGHTS_MANIFEST_EXPORT_SCHEMA,
  buildStudioAssetRightsManifest,
  type StudioAssetRightsUsageInput,
} from "./studio-asset-rights-manifest";
import { StudioAssetRightsManifestPanel } from "./StudioAssetRightsManifestPanel";

const NOW = Date.parse("2026-07-26T06:00:00.000Z");

function validUsage(
  overrides: Partial<StudioAssetRightsUsageInput> = {}
): StudioAssetRightsUsageInput {
  return {
    assetId: "asset-city-night",
    assetVersion: "v4",
    source: { kind: "community", id: "catalog:city-night" },
    scope: ["commercial-publication"],
    licenseId: "cc-by-4.0",
    attributionRequired: true,
    attributionText: "City Night © Hana · CC BY 4.0",
    commercialUse: true,
    aiTraining: "unknown",
    redistribution: true,
    expiresAt: null,
    pageId: "page-02",
    elementId: "background-04",
    ...overrides,
  };
}

function readyResult() {
  return buildStudioAssetRightsManifest({
    workId: "work-episode-007",
    usages: [validUsage()],
    attestation: {
      status: "confirmed",
      reviewedAt: "2026-07-26T05:55:00.000Z",
      reviewer: "납품 검수자",
    },
    now: NOW,
  });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});

describe("StudioAssetRightsManifestPanel", () => {
  it("presents readiness, asset permissions, placements and the local-only legal boundary", () => {
    render(
      <StudioAssetRightsManifestPanel
        result={readyResult()}
        reviewer="납품 검수자"
        onReviewerChange={vi.fn()}
      />
    );

    expect(screen.getByRole("region", { name: "에셋 사용권 및 납품 감사" }))
      .toBeTruthy();
    expect(screen.getByTestId("asset-rights-readiness").textContent)
      .toContain("사전점검 연결 가능");
    expect(screen.getByTestId("asset-rights-asset-asset-city-night").textContent)
      .toContain("CC BY");
    expect(screen.getByTestId("asset-rights-asset-asset-city-night").textContent)
      .toContain("상업허용");
    expect(screen.getByText("페이지·요소 사용 위치")).toBeTruthy();
    expect(screen.getByTestId("studio-asset-rights-manifest-panel").textContent)
      .toContain(STUDIO_ASSET_RIGHTS_MANIFEST_DISCLAIMER);
    expect(screen.getByText("자동 점검을 통과했습니다")).toBeTruthy();
  });

  it("makes blocking diagnostics and summary counts scannable", () => {
    const result = buildStudioAssetRightsManifest({
      workId: "work-episode-007",
      usages: [validUsage({
        licenseId: "cc-by-nc-4.0",
        commercialUse: true,
      })],
      attestation: null,
      now: NOW,
    });
    render(
      <StudioAssetRightsManifestPanel
        result={result}
        reviewer=""
        onReviewerChange={vi.fn()}
      />
    );

    expect(screen.getByTestId("asset-rights-readiness").textContent)
      .toContain("게시 전 확인 필요");
    expect(screen.getByTestId(
      "asset-rights-diagnostic-COMMERCIAL_USE_PROHIBITED"
    )).toBeTruthy();
    expect(screen.getByTestId(
      "asset-rights-diagnostic-ATTESTATION_REQUIRED"
    )).toBeTruthy();
    expect(screen.getByText("금지")).toBeTruthy();
  });

  it("uses 44px mobile-safe controls and sends a minimal manual attestation", () => {
    const onReviewerChange = vi.fn();
    const onAttestationChange = vi.fn();
    render(
      <StudioAssetRightsManifestPanel
        result={readyResult()}
        reviewer="  납품 담당  "
        onReviewerChange={onReviewerChange}
        onAttestationChange={onAttestationChange}
      />
    );

    const reviewer = screen.getByRole("textbox", { name: "검토자 표시 이름" });
    const confirm = screen.getByRole("button", { name: "확인 완료" });
    const reject = screen.getByRole("button", { name: "반려" });
    expect(reviewer.className).toContain("min-h-11");
    expect(confirm.className).toContain("min-h-11");
    expect(reject.className).toContain("min-h-11");

    fireEvent.change(reviewer, { target: { value: "새 검수자" } });
    expect(onReviewerChange).toHaveBeenCalledWith("새 검수자");

    fireEvent.click(confirm);
    expect(onAttestationChange).toHaveBeenCalledWith({
      status: "confirmed",
      reviewedAt: "2026-07-26T06:00:00.000Z",
      reviewer: "납품 담당",
    });
    fireEvent.click(reject);
    expect(onAttestationChange).toHaveBeenLastCalledWith({
      status: "rejected",
      reviewedAt: "2026-07-26T06:00:00.000Z",
      reviewer: "납품 담당",
    });
  });

  it("disables review until a local display name and callback are available", () => {
    const { rerender } = render(
      <StudioAssetRightsManifestPanel
        result={readyResult()}
        reviewer=""
        onReviewerChange={vi.fn()}
        onAttestationChange={vi.fn()}
      />
    );
    expect(
      (screen.getByRole("button", { name: "확인 완료" }) as HTMLButtonElement).disabled
    ).toBe(true);

    rerender(
      <StudioAssetRightsManifestPanel
        result={readyResult()}
        reviewer="검수자"
        onReviewerChange={vi.fn()}
      />
    );
    expect(
      (screen.getByRole("button", { name: "확인 완료" }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it("creates bounded deterministic JSON and CSV only through host save callbacks", async () => {
    vi.useRealTimers();
    const onExportJson = vi.fn(async (_payload: string) => undefined);
    const onExportCsv = vi.fn(async (_payload: string) => undefined);
    render(
      <StudioAssetRightsManifestPanel
        result={readyResult()}
        reviewer="납품 검수자"
        onReviewerChange={vi.fn()}
        onExportJson={onExportJson}
        onExportCsv={onExportCsv}
      />
    );

    const jsonButton = screen.getByRole("button", { name: /JSON/ });
    const csvButton = screen.getByRole("button", { name: /CSV/ });
    expect(jsonButton.className).toContain("min-h-11");
    expect(csvButton.className).toContain("min-h-11");

    fireEvent.click(jsonButton);
    await waitFor(() => expect(onExportJson).toHaveBeenCalledTimes(1));
    const json = onExportJson.mock.calls[0]?.[0] ?? "";
    expect(JSON.parse(json)).toMatchObject({
      schema: STUDIO_ASSET_RIGHTS_MANIFEST_EXPORT_SCHEMA,
      integrity: {
        algorithm: "SHA-256",
        canonicalHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      },
    });
    await waitFor(() =>
      expect(screen.getByTestId("asset-rights-export-status").textContent)
        .toContain("JSON 권리 명세")
    );

    fireEvent.click(csvButton);
    await waitFor(() => expect(onExportCsv).toHaveBeenCalledTimes(1));
    const csv = onExportCsv.mock.calls[0]?.[0] ?? "";
    expect(csv).toContain('"asset_id","asset_version"');
    expect(csv).toContain('"asset-city-night"');
    expect(csv.endsWith("\r\n")).toBe(true);
  });
});
