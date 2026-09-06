// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  acceptStudioWriterRoomSuggestion,
  addStudioWriterRoomSuggestion,
  createEmptyStudioWriterRoomDocument,
  replaceStudioWriterRoomStage,
  type StudioWriterRoomDocument,
  type StudioWriterRoomStage,
} from "./studio-writer-room";
import {
  StudioWriterRoomAiReviewPanel,
  StudioWriterRoomCanvasPlanHandoff,
  StudioWriterRoomSuggestionsPanel,
} from "./StudioWriterRoomReviewSurfaces";

afterEach(cleanup);

const CREATED_AT = "2026-07-19T00:00:00.000Z";
const DECIDED_AT = "2026-07-19T00:01:00.000Z";
const CHARACTER = {
  id: "char-a",
  name: "아라",
  role: "주인공",
  appearance: "",
  costume: "",
  colors: [],
  voice: "",
  goal: "",
  relationships: [],
  props: [],
  lockedFields: [],
};

function addTextSuggestion(
  document: StudioWriterRoomDocument,
  stage: Extract<StudioWriterRoomStage, "premise" | "synopsis">,
  id: string,
  proposedValue: string
): StudioWriterRoomDocument {
  return addStudioWriterRoomSuggestion(document, {
    id,
    targetPath: `stages.${stage}.text`,
    proposedValue,
    rationale: `${stage} 개선 이유`,
    createdAt: CREATED_AT,
  });
}

function deferredPromise() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("StudioWriterRoomSuggestionsPanel", () => {
  it("현재 단계의 대기 제안만 노출하고 승인 결과를 controlled callback으로 전달한다", () => {
    let document = createEmptyStudioWriterRoomDocument();
    document = addTextSuggestion(document, "premise", "premise-suggestion", "선명한 한 줄 기획");
    document = addTextSuggestion(document, "synopsis", "synopsis-suggestion", "숨겨진 시놉시스");
    const onChange = vi.fn();
    const onError = vi.fn();

    render(
      <StudioWriterRoomSuggestionsPanel
        stage="premise"
        document={document}
        characters={[]}
        onChange={onChange}
        onError={onError}
      />
    );

    expect(screen.getByRole("complementary", { name: "AI 제안 검토함" })).toBeTruthy();
    expect(screen.getByText("선명한 한 줄 기획")).toBeTruthy();
    expect(screen.queryByText("숨겨진 시놉시스")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "승인" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]?.[0] as StudioWriterRoomDocument;
    expect(next.stages.premise.text).toBe("선명한 한 줄 기획");
    expect(next.suggestions.find(({ id }) => id === "premise-suggestion")?.status).toBe(
      "accepted"
    );
    expect(onError).toHaveBeenLastCalledWith(null);
  });

  it("거절과 마지막 결정 취소를 명시적 callback으로 전달한다", () => {
    const suggested = addTextSuggestion(
      createEmptyStudioWriterRoomDocument(),
      "premise",
      "premise-suggestion",
      "거절할 기획"
    );
    const onReject = vi.fn();

    const { rerender } = render(
      <StudioWriterRoomSuggestionsPanel
        stage="premise"
        document={suggested}
        characters={[]}
        onChange={onReject}
        onError={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "거절" }));

    const rejected = onReject.mock.calls[0]?.[0] as StudioWriterRoomDocument;
    expect(rejected.stages.premise.text).toBe("");
    expect(rejected.suggestions[0]?.status).toBe("rejected");

    const onUndo = vi.fn();
    rerender(
      <StudioWriterRoomSuggestionsPanel
        stage="premise"
        document={rejected}
        characters={[]}
        onChange={onUndo}
        onError={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "마지막 결정 취소" }));

    const restored = onUndo.mock.calls[0]?.[0] as StudioWriterRoomDocument;
    expect(restored.suggestions[0]?.status).toBe("pending");
    expect(restored.lastDecision).toBeUndefined();
  });

  it("같은 단계의 여러 필드를 일괄 승인하고 캐릭터 ID를 이름으로 표시한다", () => {
    let document = addTextSuggestion(
      createEmptyStudioWriterRoomDocument(),
      "premise",
      "premise-suggestion",
      "일괄 승인할 기획"
    );
    document = addStudioWriterRoomSuggestion(document, {
      id: "character-suggestion",
      targetPath: "stages.premise.characterIds",
      proposedValue: [CHARACTER.id],
      rationale: "주인공 연결",
      createdAt: "2026-07-19T00:00:01.000Z",
    });
    const onChange = vi.fn();

    render(
      <StudioWriterRoomSuggestionsPanel
        stage="premise"
        document={document}
        characters={[CHARACTER]}
        onChange={onChange}
        onError={vi.fn()}
      />
    );

    expect(screen.getByText("아라")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "모두 승인" }));

    const accepted = onChange.mock.calls[0]?.[0] as StudioWriterRoomDocument;
    expect(accepted.stages.premise).toEqual({
      text: "일괄 승인할 기획",
      characterIds: [CHARACTER.id],
    });
    expect(accepted.suggestions.every(({ status }) => status === "accepted")).toBe(true);
  });

  it("원문이 바뀐 stale 제안은 적용하지 않고 부모 오류 표면으로 전달한다", () => {
    const suggested = addTextSuggestion(
      createEmptyStudioWriterRoomDocument(),
      "premise",
      "premise-suggestion",
      "오래된 제안"
    );
    const edited = replaceStudioWriterRoomStage(suggested, "premise", {
      text: "사용자가 직접 수정",
      characterIds: [],
    });
    const onChange = vi.fn();
    const onError = vi.fn();

    render(
      <StudioWriterRoomSuggestionsPanel
        stage="premise"
        document={edited}
        characters={[]}
        onChange={onChange}
        onError={onError}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "승인" }));

    expect(onChange).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0]?.[0])).toContain("대상 값이 바뀌었어요");
  });

  it("이미 처리한 제안은 되돌리기 전까지 대기 목록에 다시 섞지 않는다", () => {
    const suggested = addTextSuggestion(
      createEmptyStudioWriterRoomDocument(),
      "premise",
      "premise-suggestion",
      "승인된 기획"
    );
    const accepted = acceptStudioWriterRoomSuggestion(
      suggested,
      "premise-suggestion",
      DECIDED_AT
    );

    render(
      <StudioWriterRoomSuggestionsPanel
        stage="premise"
        document={accepted}
        characters={[]}
        onChange={vi.fn()}
        onError={vi.fn()}
      />
    );

    expect(screen.getByText("대기 0개 · 처리 1개")).toBeTruthy();
    expect(screen.getByText("검토할 제안이 없습니다")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "승인" })).toBeNull();
  });
});

describe("StudioWriterRoomCanvasPlanHandoff", () => {
  it("적용 불가 계획은 음수 카운트를 보정하고 제한된 진단만 읽기 전용으로 노출한다", () => {
    const onApply = vi.fn();

    render(
      <StudioWriterRoomCanvasPlanHandoff
        plan={{
          canApply: false,
          pageCount: -2,
          panelCount: -5,
          errorCount: 4,
          warningCount: 0,
          diagnosticMessages: [" 첫 문제 ", "둘째 문제", "셋째 문제", "넷째 문제"],
        }}
        onApply={onApply}
        busy={false}
        onError={vi.fn()}
      />
    );

    const region = screen.getByRole("region", { name: "캔버스 컷 플랜" });
    expect(within(region).getByText("0컷")).toBeTruthy();
    expect(within(region).getByText("새 페이지 0개")).toBeTruthy();
    expect(within(region).getByText("첫 문제")).toBeTruthy();
    expect(within(region).queryByText("넷째 문제")).toBeNull();
    expect(within(region).getByText("그 밖의 확인 항목 1개")).toBeTruthy();
    expect(within(region).queryByRole("button", { name: /컷 플랜/ })).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("컷이 아직 없는 첫 진입은 오류가 아니라 중립 빈 상태로 안내한다", () => {
    render(
      <StudioWriterRoomCanvasPlanHandoff
        plan={{
          canApply: false,
          pageCount: 0,
          panelCount: 0,
          errorCount: 1,
          warningCount: 0,
          diagnosticMessages: ["캔버스로 보낼 패널 계획이 없어요."],
        }}
        onApply={vi.fn()}
        busy={false}
        onError={vi.fn()}
      />
    );

    const region = screen.getByRole("region", { name: "캔버스 컷 플랜" });
    expect(within(region).getByText("아직 없음")).toBeTruthy();
    expect(within(region).queryByText("수정 필요")).toBeNull();
    expect(within(region).queryByText("적용 전 확인")).toBeNull();
    // 붉은 "오류 N" 배지는 사라지되, 진단 자체는 접힌 채로 남아 있다.
    expect(within(region).queryByText("오류 1")).toBeNull();
    expect(within(region).getByText(/1단계 기획부터/)).toBeTruthy();
    expect(within(region).getByText("확인 항목 1개 보기")).toBeTruthy();
    expect(within(region).getByText("캔버스로 보낼 패널 계획이 없어요.")).toBeTruthy();
    expect(within(region).getByText("진단 상세 — 오류 1건 · 경고 0건")).toBeTruthy();
  });

  it("컷이 실제로 있는데 적용 불가면 여전히 오류 상태를 유지한다", () => {
    render(
      <StudioWriterRoomCanvasPlanHandoff
        plan={{
          canApply: false,
          pageCount: 0,
          panelCount: 4,
          errorCount: 2,
          warningCount: 0,
          diagnosticMessages: ["패널이 참조한 장면을 찾을 수 없어요."],
        }}
        onApply={vi.fn()}
        busy={false}
        onError={vi.fn()}
      />
    );

    const region = screen.getByRole("region", { name: "캔버스 컷 플랜" });
    expect(within(region).getByText("수정 필요")).toBeTruthy();
    expect(within(region).queryByText("아직 없음")).toBeNull();
    expect(within(region).getByText("오류 2")).toBeTruthy();
    expect(within(region).getByText("적용 전 확인")).toBeTruthy();
    expect(within(region).getByText("패널이 참조한 장면을 찾을 수 없어요.")).toBeTruthy();
  });

  it("비동기 적용 중에는 중복 요청을 차단하고 완료 후 다시 활성화한다", async () => {
    const pending = deferredPromise();
    const onApply = vi.fn(() => pending.promise);
    const onError = vi.fn();

    render(
      <StudioWriterRoomCanvasPlanHandoff
        plan={{
          canApply: true,
          pageCount: 2,
          panelCount: 8,
          errorCount: 0,
          warningCount: 0,
          diagnosticMessages: [],
        }}
        onApply={onApply}
        busy={false}
        onError={onError}
      />
    );

    const applyButton = screen.getByRole("button", { name: "컷 플랜 → 새 페이지 2개" });
    fireEvent.click(applyButton);
    fireEvent.click(applyButton);

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(null);
    expect(applyButton.getAttribute("aria-busy")).toBe("true");
    expect((applyButton as HTMLButtonElement).disabled).toBe(true);

    await act(async () => pending.resolve());
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "컷 플랜 → 새 페이지 2개" })).toBeTruthy();
    });
  });

  it("적용 실패를 부모 오류 callback으로 전달하고 버튼을 복구한다", async () => {
    const onError = vi.fn();

    render(
      <StudioWriterRoomCanvasPlanHandoff
        plan={{
          canApply: true,
          pageCount: 1,
          panelCount: 3,
          errorCount: 0,
          warningCount: 1,
          diagnosticMessages: ["경고를 확인하세요"],
        }}
        onApply={async () => {
          throw new Error("페이지 생성 실패");
        }}
        busy={false}
        onError={onError}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "컷 플랜 → 새 페이지 1개" }));

    await waitFor(() => expect(onError).toHaveBeenLastCalledWith("페이지 생성 실패"));
    expect(screen.getByRole("button", { name: "컷 플랜 → 새 페이지 1개" })).toBeTruthy();
    expect(screen.getByText("적용 가능한 경고 1개 확인")).toBeTruthy();
  });
});

describe("StudioWriterRoomAiReviewPanel", () => {
  it("제공자·fallback·현재/제안 비교를 보존하고 적용·폐기를 위임한다", () => {
    const onApply = vi.fn();
    const onDiscard = vi.fn();

    render(
      <StudioWriterRoomAiReviewPanel
        review={{
          stage: "premise",
          rationale: "갈등을 더 선명하게 정리했어요.",
          draft: { text: "AI가 제안한 기획", characterIds: [] },
          provider: "DeepSeek",
          model: "deepseek-chat",
          totalTokens: 1_234,
          failover: { attemptedProvider: "zai", actualProvider: "deepseek" },
        }}
        currentValue={{ text: "원본 기획", characterIds: [] }}
        onApply={onApply}
        onDiscard={onDiscard}
      />
    );

    const region = screen.getByRole("region", { name: "AI 단계 초안 검토" });
    expect(within(region).getByText("한 줄 기획 AI 검토 초안")).toBeTruthy();
    expect(within(region).getByText("DeepSeek / deepseek-chat · 1,234 tokens")).toBeTruthy();
    const status = within(region).getByRole("status");
    expect(status.textContent).toContain("Z.ai 잔액·패키지");
    expect(status.textContent).toContain("DeepSeek에");
    expect(within(region).getByText(/원본 기획/)).toBeTruthy();
    expect(within(region).getByText(/AI가 제안한 기획/)).toBeTruthy();

    fireEvent.click(within(region).getByRole("button", { name: "초안 버리기" }));
    fireEvent.click(within(region).getByRole("button", { name: "검토 후 이 단계에 반영" }));

    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledTimes(1);
  });
});
