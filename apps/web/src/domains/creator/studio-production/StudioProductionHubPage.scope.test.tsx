// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioProductionHubPage } from "./StudioProductionHubPage";

const database = vi.hoisted(() => ({ kvGet: vi.fn(async () => null), kvSet: vi.fn(async () => undefined) }));
vi.mock("../studio-local-database-runtime", () => ({ acquireStudioLocalDatabase: async () => database }));
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

function mount(path: string) {
  return render(<MemoryRouter initialEntries={[path]}>
    <StudioProductionHubPage surface="share" onOpenStudio={vi.fn()} />
  </MemoryRouter>);
}

describe("production scope at the actual React page", () => {
  it.each(["work", "remix"])("loads %s query identity and retains every destination", async (kind) => {
    mount(`/studio/share?scope=${kind}%3Achapter-1`);
    await screen.findByText("SQLite/OPFS 저장됨");
    expect(database.kvGet).toHaveBeenCalledWith("studio-production-command-center-v1", `${kind}:chapter-1`);
    expect(screen.getByRole("link", { name: "원고 열기" }).getAttribute("href")).toBe(`/studio/${kind}/chapter-1/canvas`);
    expect(screen.getByRole("link", { name: "프로젝트" }).getAttribute("href")).toBe(`/studio/projects?scope=${kind}%3Achapter-1`);
    expect(screen.getByRole("link", { name: "참여" }).getAttribute("href")).toBe(`/studio/join?scope=${kind}%3Achapter-1`);
    expect(database.kvSet).not.toHaveBeenCalled();
  });

  it.each(["scope=work%3Aa&scope=work%3Ab", "scope=work%3A..", "scope=work%3Aa&id=b"])(
    "does not read or overwrite any draft for invalid scope %s", async (search) => {
      mount(`/studio/share?${search}`);
      expect(screen.getByRole("alert").textContent).toContain("프로젝트 범위");
      expect(database.kvGet).not.toHaveBeenCalled();
      expect(database.kvSet).not.toHaveBeenCalled();
    },
  );

  it("keys query-only document changes so local edits do not leak across projects", async () => {
    function Harness() {
      const navigate = useNavigate();
      return <>
        <button onClick={() => navigate("/studio/share?scope=work%3Ab")}>다른 작품</button>
        <StudioProductionHubPage surface="share" onOpenStudio={vi.fn()} />
      </>;
    }
    render(<MemoryRouter initialEntries={["/studio/share?scope=work%3Aa"]}><Harness /></MemoryRouter>);
    await screen.findByText("SQLite/OPFS 저장됨");
    fireEvent.click(screen.getByRole("button", { name: "다른 작품" }));
    await waitFor(() => expect(database.kvGet).toHaveBeenLastCalledWith("studio-production-command-center-v1", "work:b"));
    expect(screen.getByRole("link", { name: "원고 열기" }).getAttribute("href")).toBe("/studio/work/b/canvas");
    expect(database.kvSet).not.toHaveBeenCalled();
  });

  it("does not steal typing or IME keyboard events for workspace shortcuts", async () => {
    mount("/studio/share?scope=work%3Aa");
    await screen.findByText("SQLite/OPFS 저장됨");
    const input = screen.getByRole("textbox", { name: "프로젝트 제목" });
    fireEvent.keyDown(input, { key: "1", altKey: true });
    expect(document.querySelector("[data-scope-key]")?.getAttribute("data-scope-key")).toBe("work:a");
    expect(screen.getByRole("link", { name: "공유" }).getAttribute("aria-current")).toBe("page");
    const event = new KeyboardEvent("keydown", { key: "1", altKey: true, isComposing: true, cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
