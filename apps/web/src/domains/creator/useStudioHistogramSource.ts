/**
 * useStudioHistogramSource — 선택 이미지 src → 히스토그램용 디코드 픽셀 훅.
 * src 키 LRU 캐시(최근 4개)로 같은 이미지를 다시 디코드하지 않고, src가 바뀔 때만 비동기
 * 디코드한다 — 슬라이더/곡선 드래그 중에는 어떤 상태 변화도 만들지 않는다(핫패스 렌더 계약:
 * 디코드는 선택/소스 변경마다 한 번). 진행 중 로드는 src 교체/언마운트 시 abort 되고,
 * 실패(CORS taint 등)는 조용히 null 유지 — 히스토그램은 부가 정보라 패널 동작을 막지 않는다.
 */
import { useEffect, useState } from "react";

import { loadStudioHistogramImageData } from "./studio-histogram";

import type { StudioImageDataLike } from "./studio-filters";

const sourceCache = new Map<string, StudioImageDataLike>();
const MAX_CACHED_SOURCES = 4;

function rememberHistogramSource(src: string, data: StudioImageDataLike): void {
  sourceCache.delete(src);
  sourceCache.set(src, data);
  while (sourceCache.size > MAX_CACHED_SOURCES) {
    const oldest = sourceCache.keys().next().value;
    if (oldest === undefined) break;
    sourceCache.delete(oldest);
  }
}

export function useStudioHistogramSource(src: string | null | undefined): StudioImageDataLike | null {
  const [source, setSource] = useState<StudioImageDataLike | null>(() =>
    src ? sourceCache.get(src) ?? null : null
  );

  useEffect(() => {
    if (!src) {
      setSource(null);
      return;
    }
    const cached = sourceCache.get(src);
    if (cached) {
      rememberHistogramSource(src, cached); // LRU 갱신
      setSource(cached);
      return;
    }
    setSource(null);
    const controller = new AbortController();
    let alive = true;
    loadStudioHistogramImageData(src, { signal: controller.signal })
      .then((data) => {
        rememberHistogramSource(src, data);
        if (alive) setSource(data);
      })
      .catch(() => {
        // 부가 정보 — 로드 실패/취소 시 히스토그램만 생략한다(패널은 그대로 동작).
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [src]);

  return source;
}
