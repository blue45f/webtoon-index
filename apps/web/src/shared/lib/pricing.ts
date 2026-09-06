// 플랫폼간 가격 비교 — 같은 작품도 플랫폼별 과금 구조가 달라 보기/소장 비용이 다르다.
// ⚠️ 작품별 실제 회차 단가는 크롤하지 않는다(로그인·작품별 상이). 대신 각 플랫폼의 '공개 과금 정책'을
// 조사해 회차당 대표 단가(추정·모델 기준)를 둔다. 모델(free/wait-free/paid/subscription)은 실데이터다.
// 가격 근거(2024~2025 공개 정책, 변동 가능):
//  - 네이버 웹툰/시리즈: 쿠키 1개=100원(웹). 웹툰 대여 2~3쿠키·소장 4~5쿠키 → ~250/~450원.
//  - 리디: 웹툰 대여 300원·소장 500원~ (공식 기준).
//  - 레진: 1화 소장 기본 3코인(코인≈100원대) → ~300원.
//  - 카카오페이지/웹툰: 캐시 1:1.2(10,000캐시=12,000원), 기다리면 무료 + 빨리보기 캐시.
//  - 문피아/조아라/노벨피아 등 웹소설: 회차 100원대.
//  - 교보/예스24: 전자책 단행본(권당 구매) — 회차 모델과 달라 별도 표기.
import { PLATFORMS } from "./platforms";

import type { Availability, Pricing, PlatformId } from "./types";

export interface PlatformCost {
  platformId: PlatformId;
  name: string;
  color: string;
  model: Pricing;
  modelLabel: string;
  readPerEpWon: number; // 회차당 보기(대여/스트리밍) 추정. 0 = 무료/구독/기다무
  ownPerEpWon: number; // 회차당 소장(영구 구매) 추정
  monthlyWon: number; // 구독 모델 월정액 추정(없으면 0)
  note: string;
  url?: string;
  cheapestRead?: boolean;
  cheapestOwn?: boolean;
}

const MODEL_LABEL: Record<Pricing, string> = {
  free: "무료",
  "wait-free": "기다리면 무료",
  paid: "건별 유료",
  subscription: "구독",
};

// 플랫폼별 회차당 대표 단가(원, 조사 기반 추정). currency = 과금 재화(표기용).
interface PlatformPrice {
  read: number; // 대여/보기
  own: number; // 소장
  currency: string;
  ebook?: boolean; // 전자책 단행본(권당) 플랫폼
}
const PLATFORM_PRICE: Partial<Record<PlatformId, PlatformPrice>> = {
  "naver-webtoon": { read: 250, own: 450, currency: "쿠키(100원)" },
  "naver-series": { read: 150, own: 300, currency: "쿠키(100원)" },
  "kakao-webtoon": { read: 300, own: 500, currency: "캐시" },
  "kakao-page": { read: 300, own: 500, currency: "캐시" },
  ridi: { read: 300, own: 500, currency: "리디캐시" },
  lezhin: { read: 200, own: 300, currency: "코인" },
  toptoon: { read: 400, own: 600, currency: "코인" },
  toomics: { read: 400, own: 600, currency: "코인" },
  bomtoon: { read: 300, own: 500, currency: "캐시" },
  mrblue: { read: 300, own: 500, currency: "캐시" },
  munpia: { read: 100, own: 100, currency: "원" },
  joara: { read: 100, own: 100, currency: "원" },
  novelpia: { read: 100, own: 120, currency: "코인" },
  onestory: { read: 100, own: 120, currency: "캐시" },
  bookcube: { read: 100, own: 120, currency: "캐시" },
  postype: { read: 0, own: 0, currency: "멤버십" },
  kyobo: { read: 0, own: 4500, currency: "원", ebook: true },
  yes24: { read: 0, own: 4500, currency: "원", ebook: true },
};
const DEFAULT_PRICE: PlatformPrice = { read: 200, own: 400, currency: "원" };

function priceFor(id: PlatformId): PlatformPrice {
  return PLATFORM_PRICE[id] ?? DEFAULT_PRICE;
}

function costFor(a: Availability): { read: number; own: number; monthly: number; note: string } {
  const p = priceFor(a.platformId);
  if (p.ebook) {
    return {
      read: 0,
      own: p.own,
      monthly: 0,
      note: `전자책 단행본 · 권당 ~${p.own.toLocaleString("ko-KR")}원(${p.currency})`,
    };
  }
  switch (a.pricing) {
    case "free":
      return { read: 0, own: 0, monthly: 0, note: "전회차 무료(일부 미리보기 유료 가능)" };
    case "wait-free":
      return {
        read: 0,
        own: p.own,
        monthly: 0,
        note: `기다리면 무료 · 빨리보기 회차당 ~${p.read.toLocaleString("ko-KR")}원(${p.currency})`,
      };
    case "subscription":
      return { read: 0, own: 0, monthly: 9900, note: "월정액 구독에 포함" };
    case "paid":
    default:
      return {
        read: p.read,
        own: p.own,
        monthly: 0,
        note: `대여 ~${p.read.toLocaleString("ko-KR")}원 · 소장 ~${p.own.toLocaleString("ko-KR")}원(${p.currency}, 모델 기준)`,
      };
  }
}

export function comparePlatformCosts(availability: Availability[]): PlatformCost[] {
  const rows: PlatformCost[] = availability.map((a) => {
    const meta = PLATFORMS[a.platformId];
    const c = costFor(a);
    return {
      platformId: a.platformId,
      name: meta?.name ?? a.platformId,
      color: meta?.color ?? "#888",
      model: a.pricing,
      modelLabel: MODEL_LABEL[a.pricing],
      readPerEpWon: c.read,
      ownPerEpWon: c.own,
      monthlyWon: c.monthly,
      note: c.note,
      url: a.url,
    };
  });

  // 최저 보기/소장 단가 표시(무료/구독/기다무는 보기 0원으로 최저).
  const minRead = Math.min(...rows.map((r) => r.readPerEpWon));
  const minOwn = Math.min(...rows.filter((r) => r.ownPerEpWon > 0).map((r) => r.ownPerEpWon), Infinity);
  for (const r of rows) {
    if (r.readPerEpWon === minRead) r.cheapestRead = true;
    if (r.ownPerEpWon > 0 && r.ownPerEpWon === minOwn) r.cheapestOwn = true;
  }
  // 보기 비용 오름차순(무료/기다무 우선), 동률이면 소장 단가.
  rows.sort((a, b) => a.readPerEpWon - b.readPerEpWon || a.ownPerEpWon - b.ownPerEpWon);
  return rows;
}

export function formatWon(won: number): string {
  if (won <= 0) return "무료";
  return `${won.toLocaleString("ko-KR")}원`;
}
