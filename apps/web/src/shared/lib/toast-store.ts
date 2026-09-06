import { create } from "zustand";

// 가벼운 토스트(스낵바) — 액션 확인 피드백 전용 클라이언트 UI 상태(비영속).
// 서버 상태(react-query) 와 분리, 외부 의존성 없이 zustand 로만 구현한다.
// 접근성: 호스트가 aria-live="polite" 영역에 렌더하고, 모션은 globals.css 의 전역 reduced-motion 가드를 따른다.

export type ToastTone = "default" | "success" | "info";

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

export interface ToastOptions {
  tone?: ToastTone;
  durationMs?: number;
}

interface ToastState {
  toasts: Toast[];
  show: (message: string, options?: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const DEFAULT_DURATION = 2400;
const MAX_TOASTS = 3; // 동시에 쌓이는 토스트 상한(가장 오래된 것부터 밀어낸다)
let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

export const useToastStore = create<ToastState>()((set, get) => ({
  toasts: [],
  show: (message, options) => {
    const clean = message.trim();
    if (!clean) return 0;
    const id = nextId++;
    const toast: Toast = { id, message: clean, tone: options?.tone ?? "default" };
    set((s) => ({ toasts: [...s.toasts, toast].slice(-MAX_TOASTS) }));

    if (typeof globalThis.setTimeout === "function") {
      const timer = globalThis.setTimeout(() => get().dismiss(id), options?.durationMs ?? DEFAULT_DURATION);
      timers.set(id, timer);
    }
    return id;
  },
  dismiss: (id) => {
    const timer = timers.get(id);
    if (timer) {
      globalThis.clearTimeout(timer);
      timers.delete(id);
    }
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

// 컴포넌트 밖(스토어 액션 등)에서도 부를 수 있는 명령형 헬퍼.
export function toast(message: string, options?: ToastOptions): number {
  return useToastStore.getState().show(message, options);
}
