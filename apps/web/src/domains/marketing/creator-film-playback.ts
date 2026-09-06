/** A small native-media controller. No renderer or editor engine belongs on the homepage. */
export interface CreatorFilmMedia {
  readonly readyState: number;
  readonly duration: number;
  currentTime: number;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

export function clampCreatorFilmTime(seconds: number, duration: number): number {
  if (!Number.isFinite(seconds) || !Number.isFinite(duration) || duration <= 0) return 0;
  return Math.min(Math.max(0, seconds), Math.max(0, duration - 0.01));
}

export function creatorFilmChapterAt(seconds: number, chapters: readonly number[]): number {
  const time = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  let chapter = 0;
  for (let index = 0; index < chapters.length; index += 1) {
    if (time >= chapters[index]) chapter = index;
  }
  return chapter;
}

export function createCreatorFilmPlayback(
  media: CreatorFilmMedia,
  options: { duration: number; onFailure: () => void },
) {
  let disposed = false;
  let pending = false;
  let requestedTime = 0;
  let requestVersion = 0;

  const reportFailure = (error: unknown, version: number) => {
    if (disposed || version !== requestVersion) return;
    const name = error && typeof error === "object" && "name" in error ? error.name : "";
    // A denied automatic play keeps native controls usable. An intentional pause can
    // reject an earlier play promise; neither is a broken or missing video asset.
    if (name !== "AbortError" && name !== "NotAllowedError") options.onFailure();
  };

  const flush = () => {
    if (disposed || !pending || media.readyState < 1) return;
    pending = false;
    const version = requestVersion;
    const duration = Number.isFinite(media.duration) && media.duration > 0
      ? media.duration
      : options.duration;
    try {
      media.currentTime = clampCreatorFilmTime(requestedTime, duration);
      void Promise.resolve(media.play()).catch((error: unknown) => reportFailure(error, version));
    } catch (error) {
      reportFailure(error, version);
    }
  };
  const cancelPending = () => {
    pending = false;
    requestVersion += 1;
  };
  const onMetadata: EventListener = () => flush();
  const onPause: EventListener = () => cancelPending();
  media.addEventListener("loadedmetadata", onMetadata);
  media.addEventListener("pause", onPause);

  return {
    seekAndPlay(seconds: number) {
      if (disposed) return;
      requestedTime = seconds;
      requestVersion += 1;
      pending = true;
      flush();
    },
    pause() {
      if (disposed) return;
      cancelPending();
      media.pause();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelPending();
      media.removeEventListener("loadedmetadata", onMetadata);
      media.removeEventListener("pause", onPause);
      media.pause();
    },
  };
}

export const CREATOR_FILM_DOWNLOADS = [
  { id: "landscape", src: "/brand/toonstudio-intro.mp4", size: "1280 × 720", ratio: "16:9" },
  { id: "portrait", src: "/brand/toonstudio-intro-portrait.mp4", size: "720 × 1280", ratio: "9:16" },
  { id: "square", src: "/brand/toonstudio-intro-square.mp4", size: "1080 × 1080", ratio: "1:1" },
] as const;

export const CREATOR_FILM_UI = {
  ko: {
    loading: "소개 영상을 불러오고 있습니다. 기본 재생 버튼으로도 조작할 수 있습니다.",
    downloads: "홍보 영상 내려받기 · 3가지 비율",
    downloadNote: "24초 무음 브랜드 필름입니다. 한국어 문구와 창작 과정 예시가 포함되어 있습니다.",
    landscape: "가로형 MP4", portrait: "세로형 MP4", square: "정사각형 MP4",
  },
  en: {
    loading: "Loading the introduction. Native playback controls remain available.",
    downloads: "Download the brand film · 3 formats",
    downloadNote: "A silent 24-second brand film with Korean titles and an illustrated creative workflow.",
    landscape: "Landscape MP4", portrait: "Portrait MP4", square: "Square MP4",
  },
} as const;
