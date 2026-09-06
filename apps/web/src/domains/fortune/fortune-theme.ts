// 운세 캐릭터별 무드 색상(hue) — WebtoonStrip·ShareCard·FortunePage 공용 단일 출처.
// 선택 캐릭터의 hue를 결과 영역 CSS 변수(--char-accent 등)로 주입해 데이터·게이지·배지
// 강조색까지 캐릭터 아이덴티티(아라=청록·단우=금빛·레오나=보라·가온=강철)를 입힌다.

export const CHAR_HUE: Record<string, number> = {
  ara: 162,
  danwoo: 70,
  leona: 292,
  gaon: 248,
};

const FALLBACK_HUE = 42; // persimmon 계열(기본 accent에 근접)

export function charHue(id: string | null | undefined): number {
  return (id ? CHAR_HUE[id] : undefined) ?? FALLBACK_HUE;
}

export function charAccent(hue: number): string {
  return `oklch(0.74 0.16 ${hue})`;
}
export function charAccentSoft(hue: number): string {
  return `oklch(0.74 0.16 ${hue} / 0.16)`;
}

// 결과 컨테이너에 주입할 CSS 변수 묶음
export function charThemeVars(id: string | null | undefined): React.CSSProperties {
  const hue = charHue(id);
  return {
    ["--char-accent" as string]: charAccent(hue),
    ["--char-accent-soft" as string]: charAccentSoft(hue),
    ["--char-hue" as string]: String(hue),
  } as React.CSSProperties;
}
