import { create } from "zustand";

// 클라이언트 전역 UI 상태(서버 상태 아님 — react-query 영역과 분리). 비영속(새로고침 시 닫힘).
// 커맨드 팔레트 열림은 헤더 검색 버튼·OpenSearchButton·⌘K 단축키 등 여러 곳에서 토글하므로
// 기존 window CustomEvent 브리지 대신 zustand 스토어로 단일화한다(상태 동작은 동일).
interface UiState {
  commandPaletteOpen: boolean;
  /**
   * 사이트 공통 크롬을 잠시 비우고 자체 앱 셸을 소유하는 화면.
   *
   * 문서나 사용자 설정이 아니라 마운트 수명에만 묶인 상태다. Studio가 해제될 때
   * 자신이 획득한 surface만 반납해, 향후 다른 몰입 화면과 cleanup이 경합하지 않게 한다.
   */
  immersiveSurface: "studio" | null;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  toggleCommandPalette: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
  acquireImmersiveSurface: (surface: "studio") => void;
  releaseImmersiveSurface: (surface: "studio") => void;
}

export const useUi = create<UiState>()((set) => ({
  commandPaletteOpen: false,
  immersiveSurface: null,
  openCommandPalette: () => set({ commandPaletteOpen: true }),
  closeCommandPalette: () => set({ commandPaletteOpen: false }),
  toggleCommandPalette: () => set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
  acquireImmersiveSurface: (immersiveSurface) => set({ immersiveSurface }),
  releaseImmersiveSurface: (surface) =>
    set((state) =>
      state.immersiveSurface === surface ? { immersiveSurface: null } : state
    ),
}));
