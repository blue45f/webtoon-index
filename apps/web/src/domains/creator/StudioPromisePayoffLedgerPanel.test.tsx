// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addStudioPromisePayoffEntry,
  createEmptyStudioPromisePayoffLedger,
  type StudioPromisePayoffLedger,
} from "./studio-promise-payoff-ledger";
import {
  StudioPromisePayoffLedgerPanel,
  type StudioPromisePayoffLedgerPanelProps,
} from "./StudioPromisePayoffLedgerPanel";

function link(id: string, episode: number, frameId: string) {
  return {
    id,
    episode,
    pageId: `page-${episode}`,
    frameId,
    label: `${episode}화 ${frameId}`,
    note: "",
  };
}

function fixture(): StudioPromisePayoffLedger {
  let ledger = createEmptyStudioPromisePayoffLedger(20);
  ledger = addStudioPromisePayoffEntry(ledger, {
    id: "promise-clock",
    kind: "foreshadow",
    title: "깨진 시계의 주인",
    summary: "시계의 문양이 범인의 정체와 연결된다.",
    status: "foreshadow",
    urgency: "high",
    owner: "김작가",
    visibility: "editorial",
    spoilerLevel: "major",
    dueEpisode: 24,
    seed: link("clock-seed", 1, "frame-12"),
    foreshadows: [link("clock-clue", 15, "frame-7")],
  });
  ledger = addStudioPromisePayoffEntry(ledger, {
    id: "promise-letter",
    kind: "mystery",
    title: "봉인된 편지",
    status: "seed",
    urgency: "critical",
    dueEpisode: 19,
    seed: link("letter-seed", 3, "frame-2"),
  });
  ledger = addStudioPromisePayoffEntry(ledger, {
    id: "promise-train",
    kind: "reader-question",
    title: "마지막 열차",
    status: "intentional-non-payoff",
    urgency: "low",
    dueEpisode: null,
    seed: link("train-seed", 18, "frame-9"),
    intentionalNonPayoffReason: "시즌 2의 열린 결말로 남긴다.",
  });
  return ledger;
}

interface HarnessProps
  extends Omit<StudioPromisePayoffLedgerPanelProps, "ledger" | "onChange"> {
  readonly initial?: StudioPromisePayoffLedger;
  readonly onChange?: (ledger: StudioPromisePayoffLedger) => void;
}

function Harness({ initial = fixture(), onChange, ...props }: HarnessProps) {
  const [ledger, setLedger] = useState(initial);
  return (
    <StudioPromisePayoffLedgerPanel
      {...props}
      ledger={ledger}
      onChange={(next) => {
        setLedger(next);
        onChange?.(next);
      }}
    />
  );
}

afterEach(cleanup);

describe("StudioPromisePayoffLedgerPanel", () => {
  it("shows a dense deadline summary, named filters, and 44px mobile controls", () => {
    const { container } = render(<Harness />);

    expect(screen.getByLabelText("약속과 회수 원장")).toBeTruthy();
    expect((screen.getByLabelText("현재 작업 회차") as HTMLInputElement).value)
      .toBe("20");
    expect(screen.getByText("열린 약속").parentElement?.textContent).toContain("2");
    expect(screen.getByText("기한 초과").parentElement?.textContent).toContain("1");
    expect(screen.getByRole("tablist", { name: "약속 원장 필터" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "새 약속 등록" }).className)
      .toContain("min-h-11");
    expect(container.innerHTML).toContain("max-h-[42vh]");
    expect(container.innerHTML).toContain("overscroll-contain");
    expect(screen.getByText("로컬 결정 규칙")).toBeTruthy();
  });

  it("filters unresolved, warning, completed, and intentional items without hiding search", () => {
    render(<Harness />);
    const list = () => screen.getByRole("list", { name: "약속 원장 항목" });

    fireEvent.click(screen.getByRole("tab", { name: "경고 1" }));
    expect(within(list()).getByText("봉인된 편지")).toBeTruthy();
    expect(within(list()).queryByText("깨진 시계의 주인")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "의도 미회수 1" }));
    expect(within(list()).getByText("마지막 열차")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "전체 3" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "약속 원장 검색" }), {
      target: { value: "범인 frame-7" },
    });
    expect(within(list()).getByText("깨진 시계의 주인")).toBeTruthy();
    expect(within(list()).queryByText("봉인된 편지")).toBeNull();
  });

  it("adds a deterministic local entry and keeps it selected", () => {
    const onChange = vi.fn();
    render(<Harness initial={createEmptyStudioPromisePayoffLedger(8)} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "새 약속 등록" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0].entries[0]).toMatchObject({
      id: "promise-1",
      title: "새 약속 1",
      status: "seed",
    });
    expect(screen.getByText("안정 ID · promise-1")).toBeTruthy();
  });

  it("edits status, deadline, ownership, and intentional non-payoff reason", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    const list = screen.getByRole("list", { name: "약속 원장 항목" });
    fireEvent.click(
      within(list).getByText("깨진 시계의 주인").closest("button") as HTMLButtonElement
    );
    fireEvent.change(screen.getByLabelText("진행 상태"), {
      target: { value: "intentional-non-payoff" },
    });
    expect(screen.getByLabelText("의도적 미회수 사유")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("의도적 미회수 사유"), {
      target: { value: "독자의 해석에 맡기는 열린 결말" },
    });
    fireEvent.change(screen.getByLabelText("담당 작가·편집자"), {
      target: { value: "박편집" },
    });
    fireEvent.change(screen.getByLabelText("회수 예정 회차"), {
      target: { value: "30" },
    });

    const latest = onChange.mock.calls.at(-1)?.[0] as StudioPromisePayoffLedger;
    expect(latest.entries.find(({ id }) => id === "promise-clock")).toMatchObject({
      status: "intentional-non-payoff",
      intentionalNonPayoffReason: "독자의 해석에 맡기는 열린 결말",
      owner: "박편집",
      dueEpisode: 30,
    });
  });

  it("links seed, clues, and payoff to stable episode, scene, page, and frame references", () => {
    const onChange = vi.fn();
    const initial = addStudioPromisePayoffEntry(
      createEmptyStudioPromisePayoffLedger(7),
      {
        id: "promise-key",
        title: "사라진 열쇠",
      }
    );
    render(
      <Harness
        initial={initial}
        onChange={onChange}
        sceneOptions={[{ id: "scene-rooftop", label: "옥상 대치" }]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "첫 약속 회차·컷 연결" }));
    fireEvent.change(screen.getByLabelText("장면 바이블"), {
      target: { value: "scene-rooftop" },
    });
    fireEvent.change(screen.getByLabelText("페이지 ID"), {
      target: { value: "page-7" },
    });
    fireEvent.change(screen.getByLabelText("컷 ID"), {
      target: { value: "frame-4" },
    });
    fireEvent.click(screen.getByRole("button", { name: "단서 추가" }));
    fireEvent.click(screen.getByRole("button", { name: "회수 예정 회차·컷 연결" }));

    const latest = onChange.mock.calls.at(-1)?.[0] as StudioPromisePayoffLedger;
    const entry = latest.entries[0];
    expect(entry?.seed).toMatchObject({
      id: "promise-key-seed-1",
      episode: 7,
      sceneId: "scene-rooftop",
      pageId: "page-7",
      frameId: "frame-4",
    });
    expect(entry?.foreshadows[0]?.id).toBe("promise-key-foreshadow-1");
    expect(entry?.payoff?.id).toBe("promise-key-payoff-1");
  });

  it("recalculates overdue warnings from the stored current episode without clocks", () => {
    render(<Harness />);
    expect(screen.getByText("봉인된 편지").closest("button")?.textContent)
      .toContain("마감 지남");

    fireEvent.change(screen.getByLabelText("현재 작업 회차"), {
      target: { value: "18" },
    });
    expect(screen.getByText("봉인된 편지").closest("button")?.textContent)
      .toContain("19화 · 곧 마감");
    expect(screen.getByText("기한 초과").parentElement?.textContent).toContain("0");
  });
});
