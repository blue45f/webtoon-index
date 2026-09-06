// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HOME_COPY } from "./creator-home-content";
import { CreatorBrandFilm } from "./CreatorHomePage";

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(1);
  vi.spyOn(HTMLMediaElement.prototype, "duration", "get").mockReturnValue(24);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("creator brand film interaction", () => {
  it("keeps the video unmounted before activation and offers all three downloads", () => {
    const { container } = render(<CreatorBrandFilm copy={HOME_COPY.ko} locale="ko" />);
    expect(container.querySelector("video")).toBeNull();
    const links = container.querySelectorAll("a[download]");
    expect(links.length).toBe(3);
    expect(Array.from(links).every((link) => link.getAttribute("href")?.startsWith("/brand/"))).toBe(true);
  });
  it("moves focus to native controls then restores it to the poster on close", () => {
    const { container } = render(<CreatorBrandFilm copy={HOME_COPY.ko} locale="ko" />);
    fireEvent.click(screen.getByTestId("creator-film-play"));
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(document.activeElement).toBe(video);
    expect(video?.controls).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: HOME_COPY.ko.filmReset }));
    expect(container.querySelector("video")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("creator-film-play"));
  });
  it("updates the current chapter from real media time and recovers from an error", () => {
    const { container } = render(<CreatorBrandFilm copy={HOME_COPY.en} locale="en" />);
    fireEvent.click(screen.getByTestId("creator-film-play"));
    const video = container.querySelector("video")!;
    video.currentTime = 13;
    fireEvent.timeUpdate(video);
    expect(screen.getByRole("button", { name: /Stories and spaces/ }).getAttribute("aria-current")).toBe("step");
    fireEvent.error(video);
    expect(container.querySelector("video")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain(HOME_COPY.en.filmError);
    expect(document.activeElement).toBe(screen.getByTestId("creator-film-play"));
    fireEvent.click(screen.getByRole("button", { name: HOME_COPY.en.retry }));
    expect(container.querySelector("video")).not.toBeNull();
  });
});
