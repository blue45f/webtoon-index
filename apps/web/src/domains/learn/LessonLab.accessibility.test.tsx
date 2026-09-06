// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { LessonLab } from "./LessonLab";

const KINDS = ["pacing", "perspective", "strokes", "layers", "lettering", "values"] as const;

afterEach(cleanup);

describe("learning diagram keyboard access", () => {
  it.each(KINDS)("keeps the named %s scroll viewport focusable without autoplay", (kind) => {
    render(<MemoryRouter initialEntries={["/learn/lessons/camera-perspective"]}><LessonLab kind={kind} /></MemoryRouter>);

    // JSDOM verifies the DOM/focus contract, not native scrolling or rendered pixels.
    const viewport = screen.getByRole("region", { name: /^개념 (비교|설명) 도식/u });
    expect(viewport.getAttribute("tabindex")).toBe("0");
    viewport.focus();
    expect(document.activeElement).toBe(viewport);
    expect(within(viewport).getByRole("img").getAttribute("aria-labelledby")).toBeTruthy();
    expect(screen.getByRole("button", { name: "설명 재생" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "일시정지" })).toBeNull();
  });
});
