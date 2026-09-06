import type { MusicBrief } from "@toonspectrum/core/studio-music";

/** The current route, including an explicitly unbound /music route, owns new requests. */
export function readMusicWorkId(value: string | null | undefined): string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value) ? value : "";
}

/** Keep the creative draft while changing its target; previous consent must not carry over. */
export function scopeMusicBrief(brief: MusicBrief, workId: string): MusicBrief {
  return {
    ...brief,
    instruments: [...brief.instruments],
    workId: readMusicWorkId(workId),
    rightsConfirmed: false,
  };
}
