// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { STORYWORLD_DRAFT_NAMESPACE } from "./draft-store";
import { STORYWORLD_DEMO_PROJECT } from "./studio-storyworld-causality";
import { StudioStoryworldLabPage } from "./StudioStoryworldLabPage";

const db = vi.hoisted(() => ({ rows: new Map<string, string>(), kvGet: vi.fn(), kvSet: vi.fn() }));
vi.mock("../studio-local-database-runtime", () => ({ acquireStudioLocalDatabase: async () => db }));
const key = (id: string) => `toonspectrum:storyworld-lab:v1:work:${id}`;
const rowKey = (id: string) => `${STORYWORLD_DRAFT_NAMESPACE}:${key(id)}`;
const saved = (id: string) => JSON.parse(db.rows.get(rowKey(id)) ?? "null");
function page(workId: string) {
  return <MemoryRouter><StudioStoryworldLabPage key={workId} workId={workId} remixSourceWorkId={null} /></MemoryRouter>;
}
async function ready() { await screen.findByRole("button", { name: "원본 데이터" }); }
async function open(workId: string) {
  const view = render(page(workId));
  await ready();
  return view;
}
function editProject(title: string) {
  fireEvent.click(screen.getByRole("button", { name: "원본 데이터" }));
  fireEvent.change(screen.getByRole("textbox", { name: "스토리월드 JSON" }), {
    target: { value: JSON.stringify({ ...STORYWORLD_DEMO_PROJECT, id: "authored-test", title }) },
  });
  fireEvent.click(screen.getByRole("button", { name: "적용 후 분석" }));
}

describe("Storyworld actual page integration", () => {
  beforeEach(() => {
    db.rows.clear();
    db.kvGet.mockReset().mockImplementation(async (namespace: string, id: string) => db.rows.get(`${namespace}:${id}`) ?? null);
    db.kvSet.mockReset().mockImplementation(async (namespace: string, id: string, value: string) => { db.rows.set(`${namespace}:${id}`, value); });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });
  it("uses the real href contract and labels demo data", async () => {
    await open("work-first");
    expect(screen.getByRole("link", { name: "Studio 편집기로 돌아가기" }).getAttribute("href")).toBe("/studio/work/work-first/canvas");
    expect(screen.getByText(/예시 데이터 ·/)).toBeTruthy();
    expect(screen.getByLabelText("스토리월드 JSON 가져오기")).toBeTruthy();
    expect(screen.getByText(/캔버스 원고와 자동 연결되지 않은 로컬 실험/)).toBeTruthy();
  });
  it("opens every user-facing analysis surface", async () => {
    await open("work-tabs");
    for (const label of ["모순·위험", "멀티버스", "인물 지식", "서사 계약", "창의 기능 지도", "원본 데이터", "대시보드"]) {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${label}`) }));
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(label);
    }
  });
  it("saves validated authored JSON only through the shared SQLite authority", async () => {
    const localWrite = vi.spyOn(Storage.prototype, "setItem");
    await open("work-save");
    editProject("내가 만든 세계");
    await waitFor(() => expect(saved("work-save")?.project.title).toBe("내가 만든 세계"));
    expect(db.kvSet).toHaveBeenCalledWith(STORYWORLD_DRAFT_NAMESPACE, key("work-save"), expect.any(String));
    expect(localWrite).not.toHaveBeenCalled();
  });
  it("keeps A-to-B-to-A private drafts isolated on real keyed remounts", async () => {
    const view = await open("work-a");
    editProject("A의 사적인 초안");
    await waitFor(() => expect(saved("work-a")?.project.title).toBe("A의 사적인 초안"));
    view.rerender(page("work-b"));
    await ready();
    await waitFor(() => expect(saved("work-b")?.project.title).toBe(STORYWORLD_DEMO_PROJECT.title));
    expect(saved("work-a").project.title).toBe("A의 사적인 초안");
    view.rerender(page("work-a"));
    await ready();
    expect(screen.getByText("A의 사적인 초안")).toBeTruthy();
    const router = readFileSync(resolve(process.cwd(), "apps/web/src/domains/creator/studio-router/StudioRouter.tsx"), "utf8");
    expect(router).toContain("key={resolution.lifecycleKey}");
  });
  it("keeps the current project after malformed JSON is rejected", async () => {
    await open("work-invalid");
    fireEvent.click(screen.getByRole("button", { name: "원본 데이터" }));
    fireEvent.change(screen.getByRole("textbox", { name: "스토리월드 JSON" }), { target: { value: "{broken" } });
    fireEvent.click(screen.getByRole("button", { name: "적용 후 분석" }));
    expect(screen.getByRole("alert")).toBeTruthy();
    await waitFor(() => expect(saved("work-invalid")?.project.title).toBe(STORYWORLD_DEMO_PROJECT.title));
  });
  it("rejects excessive scene counts before analysis", async () => {
    await open("work-budget");
    fireEvent.click(screen.getByRole("button", { name: "원본 데이터" }));
    const oversized = { ...STORYWORLD_DEMO_PROJECT, scenes: Array.from({ length: 257 }, (_, i) => ({ id: `s-${i}`, title: "장면", order: i })) };
    fireEvent.change(screen.getByRole("textbox", { name: "스토리월드 JSON" }), { target: { value: JSON.stringify(oversized) } });
    fireEvent.click(screen.getByRole("button", { name: "적용 후 분석" }));
    expect(screen.getByRole("alert").textContent).toContain("장면 256개");
  });
  it("reports SQL write failures without claiming a durable save", async () => {
    db.kvSet.mockRejectedValue(new Error("quota"));
    await open("work-quota");
    editProject("아직 보관되지 않은 초안");
    expect(await screen.findByText("저장 실패")).toBeTruthy();
    expect(screen.getByText(/SQLite\/OPFS에 저장하지 못했습니다/)).toBeTruthy();
    expect(screen.getByText("아직 보관되지 않은 초안")).toBeTruthy();
    expect(saved("work-quota")).toBeNull();
  });
  it("does not save a demo before asynchronous restoration completes", async () => {
    let finish!: (value: string) => void;
    db.kvGet.mockReturnValueOnce(new Promise<string>((resolveRead) => { finish = resolveRead; }));
    render(page("work-delayed"));
    expect(screen.queryByRole("button", { name: "원본 데이터" })).toBeNull();
    expect(db.kvSet).not.toHaveBeenCalled();
    await act(async () => {
      finish(JSON.stringify({ version: 1, documentKey: key("work-delayed"), project: { ...STORYWORLD_DEMO_PROJECT, title: "복원된 원본" } }));
    });
    await ready();
    await waitFor(() => expect(saved("work-delayed")?.project.title).toBe("복원된 원본"));
    expect(db.kvSet.mock.calls.every((call) => JSON.parse(String(call[2])).project.title === "복원된 원본")).toBe(true);
  });
  it("preserves corrupt rows and offers retry without writing demo data", async () => {
    db.rows.set(rowKey("work-corrupt"), "{corrupt");
    render(page("work-corrupt"));
    expect((await screen.findByRole("alert")).textContent).toContain("복원 실패");
    expect(db.rows.get(rowKey("work-corrupt"))).toBe("{corrupt");
    expect(db.kvSet).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "원본 데이터" })).toBeNull();
    db.rows.delete(rowKey("work-corrupt"));
    fireEvent.click(screen.getByRole("button", { name: "저장소 다시 열기" }));
    await ready();
  });
});
