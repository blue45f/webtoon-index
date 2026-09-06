// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CreatorMarketplaceReportAction } from "./CreatorMarketplaceReportAction";

import type { SessionContextValue } from "@/src/compat/auth-session-store";

import { SessionContext } from "@/src/compat/auth-session-store";

const { reportCreatorMarketplaceResource } = vi.hoisted(() => ({
  reportCreatorMarketplaceResource: vi.fn(),
}));

vi.mock("@/src/infrastructure/creator-marketplace-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/infrastructure/creator-marketplace-client")>()),
  reportCreatorMarketplaceResource,
}));

const resource = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  isOwner: false,
  name: "검수용 잉크 브러시",
  publisher: {
    id: "323e4567-e89b-42d3-a456-426614174000",
    name: "마켓 작가",
    avatar: null,
  },
  resourceVersion: "1.2.0",
} as const;

function sessionValue(userId?: string, ready = true): SessionContextValue {
  if (!userId) {
    return {
      data: null,
      ready,
      status: "unauthenticated",
      update: async () => null,
    };
  }
  const data = {
    user: { id: userId, name: "검수 사용자", role: "user" },
    token: null,
  };
  return {
    data,
    ready,
    status: "authenticated",
    update: async () => data,
  };
}

function renderAction(userId?: string, ready = true) {
  return render(
    <SessionContext.Provider value={sessionValue(userId, ready)}>
      <CreatorMarketplaceReportAction record={resource} />
    </SessionContext.Provider>,
  );
}

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CreatorMarketplaceReportAction", () => {
  it("requires a verified authenticated session and guards publisher self-report", () => {
    const { rerender } = renderAction(undefined, false);
    expect((screen.getByRole("button", { name: "세션 확인 중" }) as HTMLButtonElement).disabled)
      .toBe(true);

    rerender(
      <SessionContext.Provider value={sessionValue()}>
        <CreatorMarketplaceReportAction record={resource} />
      </SessionContext.Provider>,
    );
    expect((screen.getByRole("button", { name: "로그인 후 신고" }) as HTMLButtonElement).disabled)
      .toBe(true);
    expect(screen.getByText("로그인한 계정만 마켓 리소스를 신고할 수 있습니다."))
      .toBeTruthy();

    rerender(
      <SessionContext.Provider value={sessionValue(resource.publisher.id)}>
        <CreatorMarketplaceReportAction record={resource} />
      </SessionContext.Provider>,
    );
    expect((screen.getByRole("button", { name: "내 리소스 신고 불가" }) as HTMLButtonElement).disabled)
      .toBe(true);
    expect(screen.getByText("자신이 배포한 마켓 리소스는 신고할 수 없습니다."))
      .toBeTruthy();
    expect(reportCreatorMarketplaceResource).not.toHaveBeenCalled();
  });

  it("opens an accessible trapped dialog, handles Escape, and restores trigger focus", async () => {
    renderAction("reporter-1");
    const trigger = screen.getByRole("button", { name: "리소스 신고" });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = await screen.findByRole("dialog", { name: "검수용 잉크 브러시 신고" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const reason = screen.getByLabelText("신고 사유");
    await waitFor(() => expect(document.activeElement).toBe(reason));
    fireEvent.change(reason, { target: { value: "other" } });
    const submit = screen.getByRole("button", { name: "신고 제출" });
    submit.focus();
    fireEvent.keyDown(submit, { key: "Tab" });
    expect(document.activeElement)
      .toBe(screen.getByRole("button", { name: "신고 창 닫기" }));

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("submits bounded reason/details once and gives an explicit durable success state", async () => {
    reportCreatorMarketplaceResource.mockResolvedValueOnce({
      reported: true,
      reportId: "423e4567-e89b-42d3-a456-426614174000",
      status: "open",
    });
    renderAction("reporter-1");
    fireEvent.click(screen.getByRole("button", { name: "리소스 신고" }));
    fireEvent.change(await screen.findByLabelText("신고 사유"), {
      target: { value: "misleading" },
    });
    const details = screen.getByLabelText("상세 설명 (선택)");
    expect(details.getAttribute("maxlength")).toBe("500");
    fireEvent.change(details, { target: { value: "설명과 실제 패키지가 다릅니다." } });
    fireEvent.click(screen.getByRole("button", { name: "신고 제출" }));

    expect(await screen.findByText("신고가 접수되었습니다.")).toBeTruthy();
    expect(reportCreatorMarketplaceResource).toHaveBeenCalledTimes(1);
    expect(reportCreatorMarketplaceResource).toHaveBeenCalledWith(resource.id, {
      reason: "misleading",
      details: "설명과 실제 패키지가 다릅니다.",
    });

    fireEvent.click(screen.getByRole("button", { name: "확인" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect((screen.getByRole("button", { name: "신고 접수됨" }) as HTMLButtonElement).disabled)
      .toBe(true);
    expect(screen.getByText(/관리자 검수 전에는 공개 상태가 달라지지 않습니다/u))
      .toBeTruthy();
  });

  it("treats a duplicate as already recorded and never offers an unsafe retry", async () => {
    reportCreatorMarketplaceResource.mockRejectedValueOnce({
      code: "creator_marketplace_report_duplicate",
    });
    renderAction("reporter-1");
    fireEvent.click(screen.getByRole("button", { name: "리소스 신고" }));
    fireEvent.change(await screen.findByLabelText("신고 사유"), {
      target: { value: "spam" },
    });
    fireEvent.click(screen.getByRole("button", { name: "신고 제출" }));

    expect(await screen.findByText("현재 패키지 주기에 이미 신고했습니다.")).toBeTruthy();
    expect(screen.getByText(/같은 관리자 상태와 절대 head 릴리스/u)).toBeTruthy();
    expect(screen.getByText(/중복 요청은 새 신고로 제출되지 않았습니다/u)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "다시 제출" })).toBeNull();
    expect(reportCreatorMarketplaceResource).toHaveBeenCalledTimes(1);
  });

  it("keeps form input after an error and retries only after an explicit second action", async () => {
    reportCreatorMarketplaceResource
      .mockRejectedValueOnce(new Error("일시적으로 신고를 제출하지 못했습니다."))
      .mockResolvedValueOnce({
        reported: true,
        reportId: "523e4567-e89b-42d3-a456-426614174000",
        status: "open",
      });
    renderAction("reporter-1");
    fireEvent.click(screen.getByRole("button", { name: "리소스 신고" }));
    fireEvent.change(await screen.findByLabelText("신고 사유"), {
      target: { value: "copyright" },
    });
    fireEvent.change(screen.getByLabelText("상세 설명 (선택)"), {
      target: { value: "권리자 확인 자료가 있습니다." },
    });
    fireEvent.click(screen.getByRole("button", { name: "신고 제출" }));

    expect((await screen.findByRole("alert")).textContent)
      .toContain("입력한 내용은 유지되었습니다");
    expect((screen.getByLabelText("상세 설명 (선택)") as HTMLTextAreaElement).value)
      .toBe("권리자 확인 자료가 있습니다.");
    expect(reportCreatorMarketplaceResource).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "다시 제출" }));
    expect(await screen.findByText("신고가 접수되었습니다.")).toBeTruthy();
    expect(reportCreatorMarketplaceResource).toHaveBeenCalledTimes(2);
  });
});
