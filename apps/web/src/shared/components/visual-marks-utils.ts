import {
  BookOpenCheck,
  Clapperboard,
  Flame,
  Flower2,
  HeartCrack,
  Moon,
  Swords,
  Trophy,
  type LucideIcon,
} from "lucide-react";

export const COLLECTION_ICON_OPTIONS: {
  value: string;
  label: string;
  icon: LucideIcon;
  gradient: string;
}[] = [
  {
    value: "\u{1F4DA}",
    label: "읽을거리",
    icon: BookOpenCheck,
    gradient: "linear-gradient(145deg, oklch(0.72 0.185 42), oklch(0.38 0.08 55))",
  },
  {
    value: "\u{1F37F}",
    label: "영상화",
    icon: Clapperboard,
    gradient: "linear-gradient(145deg, oklch(0.8 0.15 80), oklch(0.42 0.08 70))",
  },
  {
    value: "\u{1F525}",
    label: "화제작",
    icon: Flame,
    gradient: "linear-gradient(145deg, oklch(0.74 0.18 32), oklch(0.36 0.09 28))",
  },
  {
    value: "\u{1F494}",
    label: "여운",
    icon: HeartCrack,
    gradient: "linear-gradient(145deg, oklch(0.68 0.16 15), oklch(0.34 0.08 24))",
  },
  {
    value: "\u{1F319}",
    label: "심야",
    icon: Moon,
    gradient: "linear-gradient(145deg, oklch(0.8 0.11 232), oklch(0.3 0.06 240))",
  },
  {
    value: "⚔️",
    label: "전투",
    icon: Swords,
    gradient: "linear-gradient(145deg, oklch(0.7 0.14 285), oklch(0.3 0.06 285))",
  },
  {
    value: "\u{1F338}",
    label: "로맨스",
    icon: Flower2,
    gradient: "linear-gradient(145deg, oklch(0.78 0.15 345), oklch(0.38 0.08 350))",
  },
  {
    value: "\u{1F3C6}",
    label: "명작",
    icon: Trophy,
    gradient: "linear-gradient(145deg, oklch(0.82 0.15 80), oklch(0.42 0.08 78))",
  },
];

export function getCollectionIconOption(value: string) {
  return COLLECTION_ICON_OPTIONS.find((option) => option.value === value) ?? COLLECTION_ICON_OPTIONS[0];
}
