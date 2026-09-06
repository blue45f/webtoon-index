import type { BubbleVariant } from "../studio-assets";

interface StudioBubbleVariantGlyphProps {
  variant: BubbleVariant;
  className?: string;
}

const STROKE_PROPS = {
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  strokeWidth: 2.4,
  vectorEffect: "non-scaling-stroke" as const,
};

/**
 * 말풍선 선택 메뉴 전용 자체 SVG 미리보기.
 *
 * 운영체제마다 모양이 달라지는 이모지 대신 실제 캔버스 변형의 실루엣·선 규칙을 축약해 보여준다.
 * 버튼 안의 텍스트가 접근성 이름을 제공하므로 SVG는 장식 요소로 숨긴다.
 */
export function StudioBubbleVariantGlyph({ variant, className }: StudioBubbleVariantGlyphProps) {
  const common = {
    className,
    viewBox: "0 0 96 64",
    role: "presentation",
    "aria-hidden": true,
    focusable: false,
  } as const;

  if (variant === "double") {
    return (
      <svg {...common}>
        <path
          d="M22 4H74Q88 4 88 17V23Q88 29 80 32 88 35 88 42V46Q88 58 74 58H50L38 64 40 58H22Q8 58 8 46V42Q8 35 16 32 8 29 8 23V17Q8 4 22 4Z"
          fill="currentColor"
          opacity="0.08"
        />
        <path
          d="M22 4H74Q88 4 88 17V23Q88 29 80 32 88 35 88 42V46Q88 58 74 58H50L38 64 40 58H22Q8 58 8 46V42Q8 35 16 32 8 29 8 23V17Q8 4 22 4Z"
          {...STROKE_PROPS}
        />
      </svg>
    );
  }

  if (variant === "thought") {
    return (
      <svg {...common}>
        <ellipse cx="47" cy="27" rx="34" ry="20" fill="currentColor" opacity="0.08" />
        <ellipse cx="47" cy="27" rx="34" ry="20" {...STROKE_PROPS} />
        <ellipse cx="29" cy="50" rx="6" ry="4.5" fill="currentColor" opacity="0.08" />
        <ellipse cx="29" cy="50" rx="6" ry="4.5" {...STROKE_PROPS} />
        <circle cx="20" cy="58" r="2.5" fill="currentColor" />
      </svg>
    );
  }

  if (variant === "shout") {
    return (
      <svg {...common}>
        <path
          d="M48 4 55 13 68 7 69 20 84 20 75 31 87 40 72 44 74 58 59 52 48 61 39 51 24 58 24 44 9 41 21 31 12 20 27 20 29 7 41 14Z"
          fill="currentColor"
          opacity="0.08"
        />
        <path
          d="M48 4 55 13 68 7 69 20 84 20 75 31 87 40 72 44 74 58 59 52 48 61 39 51 24 58 24 44 9 41 21 31 12 20 27 20 29 7 41 14Z"
          {...STROKE_PROPS}
        />
      </svg>
    );
  }

  if (variant === "whisper") {
    return (
      <svg {...common}>
        <path d="M16 9H80A9 9 0 0 1 89 18V41A9 9 0 0 1 80 50H45L27 61 31 50H16A9 9 0 0 1 7 41V18A9 9 0 0 1 16 9Z" fill="currentColor" opacity="0.06" />
        <path
          d="M16 9H80A9 9 0 0 1 89 18V41A9 9 0 0 1 80 50H45L27 61 31 50H16A9 9 0 0 1 7 41V18A9 9 0 0 1 16 9Z"
          {...STROKE_PROPS}
          strokeDasharray="4 4"
        />
        <path d="M28 29h40" {...STROKE_PROPS} strokeWidth="1.6" opacity="0.45" />
      </svg>
    );
  }

  if (variant === "scared") {
    return (
      <svg {...common}>
        <path
          d="M15 10Q20 5 25 10T35 10T45 10T55 10T65 10T75 10Q84 10 84 19V40Q84 48 76 48Q72 55 68 48H20Q12 48 12 40V18Q12 12 15 10Z"
          fill="currentColor"
          opacity="0.08"
        />
        <path
          d="M15 10Q20 5 25 10T35 10T45 10T55 10T65 10T75 10Q84 10 84 19V40Q84 48 76 48Q72 55 68 48H20Q12 48 12 40V18Q12 12 15 10Z"
          {...STROKE_PROPS}
        />
        <path d="m25 24 4 5-4 5m46-10-4 5 4 5" {...STROKE_PROPS} strokeWidth="1.7" opacity="0.55" />
      </svg>
    );
  }

  if (variant === "system") {
    return (
      <svg {...common}>
        <rect x="8" y="8" width="80" height="48" rx="5" fill="currentColor" opacity="0.14" />
        <rect x="8" y="8" width="80" height="48" rx="5" {...STROKE_PROPS} />
        <rect x="13" y="13" width="70" height="38" rx="2" {...STROKE_PROPS} strokeWidth="1.2" opacity="0.55" />
        <path d="M21 23h26m-26 8h52M21 39h38" {...STROKE_PROPS} strokeWidth="1.7" opacity="0.7" />
        <circle cx="72" cy="23" r="3" fill="currentColor" />
      </svg>
    );
  }

  if (variant === "heart") {
    return (
      <svg {...common}>
        <path
          d="M48 57 16 31C3 18 11 5 24 6c9 0 16 6 24 15C56 12 63 6 72 6c13-1 21 12 8 25Z"
          fill="currentColor"
          opacity="0.09"
        />
        <path d="M48 57 16 31C3 18 11 5 24 6c9 0 16 6 24 15C56 12 63 6 72 6c13-1 21 12 8 25Z" {...STROKE_PROPS} />
      </svg>
    );
  }

  if (variant === "phone") {
    return (
      <svg {...common}>
        <path d="M13 10H81A8 8 0 0 1 89 18V42A8 8 0 0 1 81 50H27L17 57 20 50H13A8 8 0 0 1 5 42V18A8 8 0 0 1 13 10Z" fill="currentColor" opacity="0.08" />
        <path d="M13 10H81A8 8 0 0 1 89 18V42A8 8 0 0 1 81 50H27L17 57 20 50H13A8 8 0 0 1 5 42V18A8 8 0 0 1 13 10Z" {...STROKE_PROPS} />
        <path d="M20 25h42m-42 9h55" {...STROKE_PROPS} strokeWidth="1.7" opacity="0.5" />
      </svg>
    );
  }

  if (variant === "angry") {
    return (
      <svg {...common}>
        <path
          d="M48 3 54 15 65 7 68 20 82 15 77 29 91 34 77 41 83 55 68 50 64 62 53 53 46 62 38 51 24 59 25 45 9 45 19 33 6 23 23 22 24 8 38 15Z"
          fill="currentColor"
          opacity="0.1"
        />
        <path d="M48 3 54 15 65 7 68 20 82 15 77 29 91 34 77 41 83 55 68 50 64 62 53 53 46 62 38 51 24 59 25 45 9 45 19 33 6 23 23 22 24 8 38 15Z" {...STROKE_PROPS} />
        <path d="m34 27 7 6-7 6m28-12-7 6 7 6" {...STROKE_PROPS} strokeWidth="1.8" />
      </svg>
    );
  }

  if (variant === "box") {
    return (
      <svg {...common}>
        <rect x="8" y="11" width="80" height="42" rx="3" fill="currentColor" opacity="0.08" />
        <rect x="8" y="11" width="80" height="42" rx="3" {...STROKE_PROPS} />
        <path d="M19 25h58M19 34h45M19 43h52" {...STROKE_PROPS} strokeWidth="1.6" opacity="0.45" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <path d="M15 8H81A9 9 0 0 1 90 17V40A9 9 0 0 1 81 49H47Q40 49 33 59L35 49H15A9 9 0 0 1 6 40V17A9 9 0 0 1 15 8Z" fill="currentColor" opacity="0.08" />
      <path d="M15 8H81A9 9 0 0 1 90 17V40A9 9 0 0 1 81 49H47Q40 49 33 59L35 49H15A9 9 0 0 1 6 40V17A9 9 0 0 1 15 8Z" {...STROKE_PROPS} />
    </svg>
  );
}
