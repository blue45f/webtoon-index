// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { StudioBg3dSharedCharacterStatusOverlay } from "./StudioBg3dSharedCharacterStatusOverlay";

afterEach(cleanup);

describe("StudioBg3dSharedCharacterStatusOverlay", () => {
  it("counts unsupported settings separately from omitted characters", () => {
    render(
      <StudioBg3dSharedCharacterStatusOverlay
        totalCount={2}
        readyCount={2}
        unavailableCount={0}
        previewOmissionCount={3}
        capacityOmissionCount={1}
        includeInCapture
      />,
    );

    expect(screen.getByText(/지원하지 않는 캐릭터 설정이 3개 있어요/u)).toBeTruthy();
    expect(screen.getByText(/나머지 1명은 이번 미리보기에서 제외했어요/u)).toBeTruthy();
    expect(screen.queryByText(/3명/u)).toBeNull();
  });

  it("does not warn about capture omissions in preview-only mode", () => {
    render(
      <StudioBg3dSharedCharacterStatusOverlay
        totalCount={1}
        readyCount={1}
        unavailableCount={0}
        previewOmissionCount={2}
        capacityOmissionCount={0}
        includeInCapture={false}
      />,
    );

    expect(screen.getByText(/배치 참고용으로만 보여요/u)).toBeTruthy();
    expect(screen.queryByText(/지원하지 않는 캐릭터 설정/u)).toBeNull();
  });
});
