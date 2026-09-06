// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioMusicPage } from "./StudioMusicPage";

import type { LocalMusicTrack } from "./studio-music-client";
import type { MusicBrief } from "@toonspectrum/core/studio-music";

import { defaultMusicBrief, MUSIC_TERMS_URL } from "@toonspectrum/core/studio-music";

const mocks = vi.hoisted(() => ({
  ownerId: "owner-a",
  load: vi.fn(), save: vi.fn(), remove: vi.fn(), generate: vi.fn(), status: vi.fn(), error: vi.fn(),
}));
vi.mock("./studio-music-client", () => ({ generateMusic: mocks.generate, getMusicStatus: mocks.status }));
vi.mock("./studio-music-library", () => ({ loadMusicTracks: mocks.load, saveMusicTrack: mocks.save, deleteMusicTrack: mocks.remove }));
vi.mock("@/src/compat/auth-session-store", () => ({ useSession: () => ({ data: mocks.ownerId ? { user: { id: mocks.ownerId } } : null }) }));
vi.mock("@/src/infrastructure/api", () => ({ getApiErrorMessage: mocks.error }));

function output(index = 1, ownerId = "owner-a", workId = "work-a"): LocalMusicTrack {
  return {
    ownerId, audio: new Blob(["ID3-UI-TEST-ONLY"], { type: "audio/mpeg" }),
    metadata: {
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      createdAt: "2026-09-06T00:00:00Z", provider: "elevenlabs", model: "music_v1", format: "mp3_44100_128",
      termsUrl: MUSIC_TERMS_URL,
      brief: { ...defaultMusicBrief(), title: `저장된 음악 ${index}`, scene: "비가 그친 역에서 다시 만난 두 사람", workId, rightsConfirmed: true },
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function Navigation() {
  const navigate = useNavigate();
  return <nav aria-label="테스트 경로 이동">
    <button type="button" onClick={() => void navigate("/music?workId=work-a")}>작품 A로 이동</button>
    <button type="button" onClick={() => void navigate("/music?workId=work-b")}>작품 B로 이동</button>
    <button type="button" onClick={() => void navigate("/music")}>작품 연결 해제</button>
  </nav>;
}
function Harness({ initial = "/music?workId=work-a" }: { initial?: string }) {
  return <StrictMode><MemoryRouter initialEntries={[initial]}><Navigation /><Routes>
    <Route path="/music" element={<StudioMusicPage />} />
    <Route path="/studio" element={<p>스튜디오로 이동함</p>} />
    <Route path="/create/:id" element={<p>작품으로 이동함</p>} />
  </Routes></MemoryRouter></StrictMode>;
}
const consent = () => screen.getByRole("checkbox", { name: /입력한 장면·가사를 사용할 권한/ });
const submit = () => screen.getByRole("form", { name: "AI 음악 만들기" });
const generateButton = () => screen.getByRole("button", { name: "AI 음악 생성" });
function fillBrief() {
  fireEvent.change(screen.getByLabelText("음악 제목"), { target: { value: "새 음악" } });
  fireEvent.change(screen.getByLabelText("장면 설명"), { target: { value: "조용한 역에서 두 사람이 재회한다." } });
  fireEvent.click(consent());
}
async function ready() {
  await screen.findByText("Eleven Music 연결 설정됨");
  await waitFor(() => expect(screen.queryByText("기기 보관함을 여는 중…")).toBeNull());
}
async function generatedCard() {
  return screen.findByRole("article", { name: "새 음악 음원" });
}
const originalCreate = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const originalRevoke = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
const createUrl = vi.fn(() => "blob:music-ui-test");
const revokeUrl = vi.fn();
beforeAll(() => {
  Object.defineProperty(URL, "createObjectURL", { configurable: true, writable: true, value: createUrl });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, writable: true, value: revokeUrl });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, writable: true, value: vi.fn() });
});
afterAll(() => {
  for (const [target, key, descriptor] of [
    [URL, "createObjectURL", originalCreate], [URL, "revokeObjectURL", originalRevoke],
    [HTMLElement.prototype, "scrollIntoView", originalScroll],
  ] as const) {
    if (descriptor) Object.defineProperty(target, key, descriptor);
    else Reflect.deleteProperty(target, key);
  }
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.ownerId = "owner-a";
  mocks.load.mockReset().mockResolvedValue([]);
  mocks.save.mockReset().mockResolvedValue(undefined);
  mocks.remove.mockReset().mockResolvedValue(undefined);
  mocks.status.mockReset().mockResolvedValue({ enabled: true, reason: "ready", provider: "elevenlabs", maxSeconds: 60 });
  mocks.generate.mockReset().mockImplementation(async (brief: MusicBrief, ownerId: string, requestId: string) => {
    const result = output(1, ownerId, brief.workId);
    result.metadata = { ...result.metadata, id: requestId, brief: { ...brief, instruments: [...brief.instruments] } };
    return result;
  });
  mocks.error.mockReset().mockImplementation(async (reason: unknown, fallback: string) => reason instanceof Error ? reason.message : fallback);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("music workspace rendered recovery and route regression", () => {
  it("keeps guests out of personal storage and paid generation", async () => {
    mocks.ownerId = "";
    render(<Harness />); await ready(); fillBrief();
    expect(generateButton()).toHaveProperty("disabled", true);
    fireEvent.submit(submit());
    expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("does not dispatch a paid request when the provider is disabled", async () => {
    mocks.status.mockResolvedValue({ enabled: false, reason: "disabled", provider: "elevenlabs", maxSeconds: 60 });
    render(<Harness />); await screen.findByText("음악 생성 연결 준비 중"); fillBrief();
    expect(generateButton()).toHaveProperty("disabled", true);
    fireEvent.submit(submit()); expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("retries a failed library read explicitly without presenting a false empty library", async () => {
    mocks.load.mockRejectedValueOnce(new Error("OPFS temporarily unavailable"));
    render(<Harness />); await ready(); fillBrief();
    await screen.findByText("OPFS temporarily unavailable");
    expect(screen.queryByText("아직 만들어진 음악이 없어요")).toBeNull();
    expect(generateButton()).toHaveProperty("disabled", true);
    fireEvent.submit(submit()); expect(mocks.generate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "보관함 다시 확인" }));
    await waitFor(() => expect(generateButton()).toHaveProperty("disabled", false));
    expect(mocks.load).toHaveBeenCalledTimes(2); expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("deduplicates rapid submissions before React can repaint the button", async () => {
    const gate = deferred<LocalMusicTrack>(); mocks.generate.mockReturnValue(gate.promise);
    render(<Harness />); await ready(); fillBrief();
    fireEvent.submit(submit()); fireEvent.submit(submit());
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    await act(async () => { gate.resolve(output()); });
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
  });

  it("retries only local saving of the identical output after a failed write", async () => {
    mocks.save.mockRejectedValueOnce(new Error("disk full"));
    render(<Harness />); await ready(); fillBrief(); fireEvent.submit(submit());
    const card = await generatedCard();
    const retry = within(card).getByRole("button", { name: "기기에 다시 저장" });
    await waitFor(() => expect(retry).toHaveProperty("disabled", false));
    const first = mocks.save.mock.calls[0][0] as LocalMusicTrack;
    expect(within(card).getByRole("button", { name: "MP3 저장" })).toHaveProperty("disabled", false);
    fireEvent.click(retry);
    await within(card).findByText("기기에 저장됨");
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(mocks.save.mock.calls[1][0]).toBe(first);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
  });

  it("disables deletion and refresh while the generated audio is being saved", async () => {
    const gate = deferred<void>(); mocks.save.mockReturnValue(gate.promise);
    render(<Harness />); await ready(); fillBrief(); fireEvent.submit(submit());
    const card = await generatedCard();
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(within(card).getByRole("button", { name: "삭제" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "보관함 다시 확인" })).toHaveProperty("disabled", true);
    expect(within(card).getByRole("button", { name: "MP3 저장" })).toHaveProperty("disabled", false);
    await act(async () => { gate.resolve(); });
    await within(card).findByText("기기에 저장됨");
  });

  it("keeps an unsaved audio Blob accessible across a read-only library refresh", async () => {
    mocks.save.mockRejectedValue(new Error("disk full"));
    render(<Harness />); await ready(); fillBrief(); fireEvent.submit(submit());
    const card = await generatedCard();
    await waitFor(() => expect(screen.getByRole("button", { name: "보관함 다시 확인" })).toHaveProperty("disabled", false));
    const original = mocks.save.mock.calls[0][0] as LocalMusicTrack;
    fireEvent.click(screen.getByRole("button", { name: "보관함 다시 확인" }));
    await screen.findByText("보관함을 다시 확인했습니다. 저장되지 않은 음원도 화면에 유지됩니다.");
    expect(screen.getByRole("article", { name: "새 음악 음원" })).toBe(card);
    expect(createUrl).toHaveBeenCalledWith(original.audio);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
  });

  it("keeps the audio and its confirmation dialog when deletion fails", async () => {
    mocks.load.mockResolvedValue([output()]); mocks.remove.mockRejectedValue(new Error("delete failed"));
    render(<Harness />); await ready();
    const card = await screen.findByRole("article", { name: "저장된 음악 1 음원" });
    fireEvent.click(within(card).getByRole("button", { name: "삭제" }));
    fireEvent.click(within(card).getByRole("button", { name: "삭제 확인" }));
    await within(card).findByText("delete failed");
    expect(within(card).getByRole("button", { name: "삭제 확인" })).toHaveProperty("disabled", false);
    expect(within(card).getByRole("button", { name: "MP3 저장" })).toHaveProperty("disabled", false);
  });

  it("switches the current work without reloading storage or losing the creative draft", async () => {
    render(<Harness />); await ready(); fillBrief();
    fireEvent.click(screen.getByRole("button", { name: "작품 B로 이동" }));
    await screen.findByText("새 음악 연결 작품: work-b");
    await waitFor(() => expect(consent()).toHaveProperty("checked", false));
    expect(screen.getByLabelText("장면 설명")).toHaveProperty("value", "조용한 역에서 두 사람이 재회한다.");
    expect(mocks.load).toHaveBeenCalledTimes(1);
    fireEvent.click(consent()); fireEvent.submit(submit());
    await waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(1));
    expect(mocks.generate.mock.calls[0][0]).toMatchObject({ workId: "work-b", rightsConfirmed: true });
  });

  it("does not resurrect a saved track's work when reusing it from unbound /music", async () => {
    mocks.load.mockResolvedValue([output(1, "owner-a", "previous-work")]);
    render(<Harness initial="/music" />); await ready();
    fireEvent.click(screen.getByRole("button", { name: "설정 다시 사용" }));
    expect(consent()).toHaveProperty("checked", false);
    fireEvent.click(consent()); fireEvent.submit(submit());
    await waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(1));
    expect(mocks.generate.mock.calls[0][0]).toMatchObject({ workId: "" });
  });

  it("retains unsaved output when navigating between work scopes", async () => {
    mocks.save.mockRejectedValue(new Error("disk full"));
    render(<Harness />); await ready(); fillBrief(); fireEvent.submit(submit());
    await generatedCard();
    await waitFor(() => expect(generateButton()).toHaveProperty("disabled", false));
    fireEvent.click(screen.getByRole("button", { name: "작품 B로 이동" }));
    await screen.findByText("새 음악 연결 작품: work-b");
    expect(screen.getByText(/저장 확인이 필요한 음원이 1곡/)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "현재 작품에 연결해 만든 음악만 보기" }));
    await generatedCard();
    expect(mocks.load).toHaveBeenCalledTimes(1); expect(mocks.generate).toHaveBeenCalledTimes(1);
  });

  it("preserves original lyric text when toggling vocals off and on", async () => {
    render(<Harness />); await ready();
    const vocals = screen.getByRole("checkbox", { name: "보컬이 있는 주제가 만들기" });
    fireEvent.click(vocals);
    fireEvent.change(screen.getByLabelText(/직접 작성한 가사/), { target: { value: "우리의 내일을 노래해" } });
    fireEvent.click(vocals); fireEvent.click(vocals);
    expect(screen.getByLabelText(/직접 작성한 가사/)).toHaveProperty("value", "우리의 내일을 노래해");
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("aborts a cancelled request and ignores a late successful response", async () => {
    const gate = deferred<LocalMusicTrack>(); mocks.generate.mockReturnValue(gate.promise);
    render(<Harness />); await ready(); fillBrief(); fireEvent.submit(submit());
    const signal = mocks.generate.mock.calls[0][3] as AbortSignal;
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(signal.aborted).toBe(true);
    await act(async () => { gate.resolve(output()); });
    expect(mocks.save).not.toHaveBeenCalled(); expect(screen.queryByRole("article")).toBeNull();
  });

  it("does not parse cancelled provider errors or automatically send a replacement request", async () => {
    const gate = deferred<LocalMusicTrack>(); mocks.generate.mockReturnValue(gate.promise);
    render(<Harness />); await ready(); fillBrief(); fireEvent.submit(submit());
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    await act(async () => { gate.reject(new Error("AbortError")); });
    expect(mocks.error).not.toHaveBeenCalled(); expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(generateButton()).toHaveProperty("disabled", false);
  });

  it("does not show or persist another account's late generation result after account switch", async () => {
    const gate = deferred<LocalMusicTrack>(); mocks.generate.mockReturnValue(gate.promise);
    const view = render(<Harness />); await ready(); fillBrief(); fireEvent.submit(submit());
    const signal = mocks.generate.mock.calls[0][3] as AbortSignal;
    mocks.ownerId = "owner-b"; view.rerender(<Harness />); await ready();
    expect(signal.aborted).toBe(true);
    await act(async () => { gate.resolve(output(1, "owner-a")); });
    expect(mocks.save).not.toHaveBeenCalled(); expect(screen.queryByRole("article")).toBeNull();
    expect(mocks.load).toHaveBeenLastCalledWith("owner-b");
  });

  it("shows measured duration without replacing the requested length", async () => {
    mocks.load.mockResolvedValue([output()]); render(<Harness />); await ready();
    const audio = screen.getByLabelText("저장된 음악 1 미리듣기");
    Object.defineProperty(audio, "duration", { configurable: true, value: 31.5 });
    fireEvent.loadedMetadata(audio);
    expect(screen.getByText(/요청 30초 \/ 실제 31.5초/)).toBeTruthy();
    Object.defineProperty(audio, "duration", { configurable: true, value: Infinity });
    fireEvent.loadedMetadata(audio);
    expect(screen.queryByText(/실제 Infinity/)).toBeNull();
  });

  it("preserves existing audio during refresh failure and blocks new paid requests", async () => {
    mocks.load.mockResolvedValueOnce([output()]).mockRejectedValue(new Error("read failed"));
    render(<Harness />); await ready(); fillBrief();
    const card = screen.getByRole("article", { name: "저장된 음악 1 음원" });
    fireEvent.click(screen.getByRole("button", { name: "보관함 다시 확인" }));
    await screen.findByText("read failed");
    expect(screen.getByRole("article", { name: "저장된 음악 1 음원" })).toBe(card);
    expect(generateButton()).toHaveProperty("disabled", true);
    fireEvent.submit(submit()); expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("releases preview URLs when the workspace unmounts", async () => {
    mocks.load.mockResolvedValue([output()]);
    const view = render(<Harness />); await ready();
    await screen.findByLabelText("저장된 음악 1 미리듣기");
    revokeUrl.mockClear(); view.unmount();
    expect(revokeUrl).toHaveBeenCalledWith("blob:music-ui-test");
  });
});
