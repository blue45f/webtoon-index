// 드래그 미리보기 rAF 코얼레싱 훅 — StudioPage 의 픽셀 도구들(픽셀 선택 이동,
// 힐/클론, 히스토리 브러시, 레이어/필터 마스크, 퀵 마스크)이 각자 복사하던
// pendingRef + rafRef + schedule/clear 스캐폴드의 단일 구현.
// 포인터 move 마다 setState 하는 대신 프레임당 한 번만 커밋한다.
import { useCallback, useEffect, useRef, useState } from "react";

export interface StudioRafPreview<T> {
  preview: T | null;
  /** 다음 프레임에 preview 로 커밋한다. 이미 예약된 프레임이 있으면 값만 갈아끼운다. */
  schedule: (next: T | null) => void;
  /** 예약을 취소하고 preview 를 즉시 비운다. */
  clear: () => void;
  /** rAF 를 거치지 않는 즉시 커밋 — 기존 raw setState 소비처와의 호환용. */
  set: (next: T | null) => void;
}

export function useStudioRafPreview<T>(): StudioRafPreview<T> {
  const [preview, setPreview] = useState<T | null>(null);
  const pendingRef = useRef<T | null>(null);
  const rafRef = useRef<number | null>(null);

  const schedule = useCallback((next: T | null) => {
    pendingRef.current = next;
    if (rafRef.current !== null) return;
    rafRef.current = globalThis.requestAnimationFrame(() => {
      rafRef.current = null;
      setPreview(pendingRef.current);
    });
  }, []);
  const clear = useCallback(() => {
    pendingRef.current = null;
    if (rafRef.current !== null) {
      globalThis.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setPreview(null);
  }, []);
  useEffect(() => () => {
    if (rafRef.current !== null) globalThis.cancelAnimationFrame(rafRef.current);
  }, []);

  return { preview, schedule, clear, set: setPreview };
}
