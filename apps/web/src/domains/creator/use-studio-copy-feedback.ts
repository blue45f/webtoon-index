/**
 * useStudioCopyFeedback — "복사됨" 뱃지가 진실만 말하게 하는 훅.
 *
 * 스튜디오 곳곳의 복사 버튼이 같은 세 가지 실수를 복제하고 있었다:
 *  1. `navigator.clipboard.writeText(...)` 를 await 하지 않는다 → 클립보드가 막혀도 "복사됨"이 뜨고
 *     rejection 은 unhandled 로 샌다.
 *  2. `setTimeout(..., 1500)` 을 정리하지 않는다 → 언마운트 뒤 setState 가 터진다.
 *  3. 실패 상태가 없다 → 사용자는 복사가 안 됐다는 사실을 영영 모른다.
 *
 * 이 훅은 `copyStudioText`(실제 성공 여부를 boolean 으로 돌려줌) 위에 세 가지를 다 얹는다.
 * 연타 시에는 마지막 요청만 살아남는다 — 먼저 시작한 복사가 늦게 끝나도 최신 뱃지를 덮지 않는다.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { copyStudioText } from "./studio-workbench-clipboard";

export type StudioCopyFeedbackStatus = "copied" | "failed";

export interface StudioCopyFeedbackState {
  readonly id: string;
  readonly status: StudioCopyFeedbackStatus;
}

export interface StudioCopyFeedback {
  /** 현재 뱃지를 띄우고 있는 대상. 없으면 null. */
  readonly current: StudioCopyFeedbackState | null;
  /** 특정 항목의 상태. 목록 렌더에서 항목마다 호출한다. */
  readonly statusFor: (id: string) => StudioCopyFeedbackStatus | null;
  /** 복사 시도. 절대 throw 하지 않으며, 결과가 확정된 뒤에만 상태를 바꾼다. */
  readonly copy: (id: string, text: string) => void;
}

export function useStudioCopyFeedback(resetMs = 1500): StudioCopyFeedback {
  const [current, setCurrent] = useState<StudioCopyFeedbackState | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  // 연타/경합 방지. 증가한 뒤 자기 번호가 최신일 때만 상태를 건드린다.
  const requestRef = useRef(0);

  useEffect(() => {
    // StrictMode 의 mount→unmount→mount 리허설에서 false 로 굳지 않게 매 마운트마다 되돌린다.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);

  const copy = useCallback(
    (id: string, text: string) => {
      requestRef.current += 1;
      const request = requestRef.current;

      void (async () => {
        let ok: boolean;
        try {
          ok = await copyStudioText(text);
        } catch {
          // copyStudioText 는 throw 하지 않기로 되어 있지만, 계약이 깨져도 뱃지가 거짓말하진 않게.
          ok = false;
        }
        if (!mountedRef.current || request !== requestRef.current) return;

        setCurrent({ id, status: ok ? "copied" : "failed" });
        if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => {
          timeoutRef.current = null;
          if (!mountedRef.current || request !== requestRef.current) return;
          setCurrent(null);
        }, resetMs);
      })();
    },
    [resetMs]
  );

  const statusFor = useCallback(
    (id: string): StudioCopyFeedbackStatus | null => (current?.id === id ? current.status : null),
    [current]
  );

  return { current, statusFor, copy };
}
