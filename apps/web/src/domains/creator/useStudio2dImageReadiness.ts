import { useEffect, useRef, useState } from "react";

import { observeStudio2dImage, STUDIO_2D_IMAGE_LOADING } from "./studio-2d-image-readiness";

import type { Studio2dImageState } from "./studio-2d-image-readiness";

/** Keyed readiness: no old success/error can authorize a replacement image or retry. */
export function useStudio2dImageReadiness(source: string, expected?: { readonly width: number; readonly height: number }) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [attempt, setAttempt] = useState(0);
  const width = expected?.width;
  const height = expected?.height;
  const key = JSON.stringify([source, width, height, attempt]);
  const [snapshot, setSnapshot] = useState<{ key: string; state: Studio2dImageState } | null>(null);
  useEffect(() => {
    const image = imageRef.current;
    if (!image) return;
    return observeStudio2dImage(image, width !== undefined && height !== undefined ? { width, height } : undefined,
      (state) => setSnapshot({ key, state }));
  }, [key, width, height]);
  return {
    imageRef,
    imageKey: key,
    state: snapshot?.key === key ? snapshot.state : STUDIO_2D_IMAGE_LOADING,
    retry: () => setAttempt((value) => value + 1),
  };
}
