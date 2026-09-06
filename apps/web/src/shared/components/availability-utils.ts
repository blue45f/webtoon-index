import type { Availability } from "@/shared/lib/types";

import { PRICING_LABEL } from "@/shared/lib/platforms";

export const PRICING_TONE: Record<string, string> = {
  free: "text-good",
  "wait-free": "text-cool",
  paid: "text-fg-2",
  subscription: "text-warn",
};

// 가격 요약 한 줄 (최저 진입 비용)
export function bestPricing(availability: Availability[]): { label: string; tone: string } {
  const order: Record<string, number> = { free: 0, "wait-free": 1, subscription: 2, paid: 3 };
  const best = [...availability].sort((a, b) => order[a.pricing] - order[b.pricing])[0];
  if (!best) return { label: "정보 없음", tone: "text-fg-3" };
  return { label: PRICING_LABEL[best.pricing], tone: PRICING_TONE[best.pricing] };
}
