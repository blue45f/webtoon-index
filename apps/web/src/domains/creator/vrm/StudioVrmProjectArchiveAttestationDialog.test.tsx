// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioVrmProjectArchiveAttestationDialog } from "./StudioVrmProjectArchiveAttestationDialog";

import type { StudioVrmProjectArchiveAttestationPlan } from "./studio-vrm-license-product-gate";

type ReadyPlan = Extract<StudioVrmProjectArchiveAttestationPlan, { readonly ok: true }>;

const PLAN: ReadyPlan = Object.freeze({
  ok: true,
  schema: "toonspectrum.vrm-project-archive-attestation-plan",
  version: 1,
  modelCount: 2,
  exactAttributionTexts: Object.freeze(["작가 A · CC BY 4.0", ""] as const),
  permittedActorBases: Object.freeze(["author", "other"] as const),
});

afterEach(cleanup);

describe("StudioVrmProjectArchiveAttestationDialog", () => {
  it("shows only admitted actor choices and preserves every attribution string exactly", () => {
    render(
      <StudioVrmProjectArchiveAttestationDialog
        plan={PLAN}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole("radio", { name: /^VRM 저작자 본인/ })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /^그 밖의 허용 사용자/ })).toBeTruthy();
    expect(screen.queryByRole("radio", { name: /^별도 이용 허락을 받은 사람/ })).toBeNull();

    const exactAttributions = [
      ...document.querySelectorAll<HTMLElement>(
        "[data-studio-vrm-project-archive-attribution]",
      ),
    ];
    expect(exactAttributions.map((entry) => entry.textContent)).toEqual([
      "작가 A · CC BY 4.0",
      "",
    ]);
    expect(
      document.querySelector("[data-studio-vrm-project-archive-empty-attribution-note]"),
    ).not.toBeNull();
  });

  it("requires an explicit actor, four known classifications, and exact-credit confirmation", () => {
    const onSubmit = vi.fn();
    render(
      <StudioVrmProjectArchiveAttestationDialog
        plan={PLAN}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    const submit = screen.getByRole("button", { name: "VRM 포함 archive 만들기" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryAllByRole("radio", { checked: true })).toHaveLength(0);

    fireEvent.click(screen.getByRole("radio", { name: /^VRM 저작자 본인/ }));
    for (const choice of screen.getAllByLabelText("포함하지 않음")) {
      fireEvent.click(choice);
    }
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(
      screen.getByLabelText(
        "표시된 모든 크레딧 원문을 순서와 내용 변경 없이 archive에 보존합니다.",
      ),
    );
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(submit);

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledWith({
      confirmedByUser: true,
      avatarPermissionBasis: "author",
      confirmedAttributionTexts: PLAN.exactAttributionTexts,
      excessivelyViolent: "absent",
      excessivelySexual: "absent",
      politicalOrReligious: "absent",
      antisocialOrHate: "absent",
    });
  });

  it("keeps an explicit unknown classification fail-closed", () => {
    render(
      <StudioVrmProjectArchiveAttestationDialog
        plan={PLAN}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: /^VRM 저작자 본인/ }));
    const absentChoices = screen.getAllByLabelText("포함하지 않음");
    absentChoices.slice(1).forEach((choice) => fireEvent.click(choice));
    fireEvent.click(screen.getAllByLabelText("확인하지 못함")[0]);
    fireEvent.click(
      screen.getByLabelText(
        "표시된 모든 크레딧 원문을 순서와 내용 변경 없이 archive에 보존합니다.",
      ),
    );

    expect(screen.getByText(/‘확인하지 못함’이 포함되어/)).toBeTruthy();
    expect(
      (screen.getByRole("button", {
        name: "VRM 포함 archive 만들기",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("uses the explicit cancel action for initial focus and Escape dismissal", () => {
    const onCancel = vi.fn();
    render(
      <StudioVrmProjectArchiveAttestationDialog
        plan={PLAN}
        onSubmit={vi.fn()}
        onCancel={onCancel}
      />,
    );

    const cancel = screen.getByRole("button", { name: "취소" });
    expect(cancel.getAttribute("data-autofocus")).toBe("true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
