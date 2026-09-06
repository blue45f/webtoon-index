import { create } from "zustand";
import { persist } from "zustand/middleware";

// 다크(기본)/주간(light) 테마. i18n 과 같은 패턴 — zustand persist + <html data-theme> 적용.
// 토큰 오버라이드는 src/styles/globals.css 의 :root[data-theme="light"] 블록. CSP를 유지하는
// `/bootstrap-theme.js`가 리액트 마운트 전에 data-theme을 먼저 설정해 FOUC를 막는다.
export type Theme = "dark" | "light";

function applyTheme(theme: Theme) {
  if (typeof document !== "undefined") document.documentElement.setAttribute("data-theme", theme);
}

interface ThemeState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

export const useTheme = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: "dark",
      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },
      toggle: () => {
        const next: Theme = get().theme === "dark" ? "light" : "dark";
        applyTheme(next);
        set({ theme: next });
      },
    }),
    {
      name: "toonspectrum-theme",
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.theme);
      },
    }
  )
);
