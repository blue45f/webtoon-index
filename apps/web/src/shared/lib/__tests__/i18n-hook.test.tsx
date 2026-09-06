// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useI18n, useT } from "@/shared/lib/i18n";

const initialI18nState = useI18n.getState();

beforeEach(() => {
  useI18n.setState({ lang: "ko", translationBundleRevision: 0 });
});

afterEach(() => {
  useI18n.setState({
    lang: initialI18nState.lang,
    translationBundleRevision: initialI18nState.translationBundleRevision,
  });
});

describe("useT", () => {
  it("keeps its resolver stable for the same locale while observing bundle revisions", () => {
    const { result, rerender } = renderHook(() => useT());
    const initialResolver = result.current;

    rerender();
    expect(result.current).toBe(initialResolver);

    act(() => {
      useI18n.setState((state) => ({
        translationBundleRevision: state.translationBundleRevision + 1,
      }));
    });

    expect(result.current).toBe(initialResolver);
    expect(result.current("common.close")).toBe("닫기");
  });

  it("switches to a locale-specific stable resolver when the language changes", () => {
    const { result, rerender } = renderHook(() => useT());
    const koreanResolver = result.current;

    act(() => {
      useI18n.setState({ lang: "en" });
    });

    const englishResolver = result.current;
    expect(englishResolver).not.toBe(koreanResolver);
    expect(englishResolver("common.close")).toBe("Close");

    rerender();
    expect(result.current).toBe(englishResolver);
  });
});
