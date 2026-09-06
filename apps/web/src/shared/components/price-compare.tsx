import { Coins, Crown, Eye } from "lucide-react";

import { Card3D } from "./ui/card-3d";

import type { Availability } from "@/shared/lib/types";

import { comparePlatformCosts, formatWon, type PlatformCost } from "@/shared/lib/pricing";
import { cn } from "@/shared/lib/utils";
import { useAppConfig } from "@/src/hooks/use-app-config";


// 플랫폼간 가격 비교 — 같은 작품의 보기/소장 비용을 플랫폼별로 비교(추정·예시).
//
// 반응형은 구조적(DESIGN.md): 좁은 폭(<sm)에선 다열 표가 글자단위로 붕괴하므로 표를 버리고
// "플랫폼당 한 카드"(브랜드 도트+이름 한 줄 + 보기/소장 칩)로 재구성한다. sm+ 에선 표 레이아웃.
export function PriceCompare({ availability }: { availability: Availability[] }) {
  // 가격 추정은 크롤 유통 데이터 기반이라 법적 리스크가 있어 관리자 킬스위치로 끌 수 있다.
  const { showPricing } = useAppConfig();
  if (!showPricing) return null;
  if (!availability || availability.length < 1) return null;
  const rows = comparePlatformCosts(availability);
  const multi = rows.length > 1;

  return (
    <section className="rounded-2xl border border-line bg-panel/40 p-4">
      <div className="mb-1 flex items-center gap-1.5">
        <Coins size={15} className="text-accent" />
        <h3 className="text-sm font-semibold text-fg">플랫폼별 가격 비교</h3>
      </div>
      <p className="mb-3 text-[0.72rem] leading-relaxed text-fg-2">
        {multi ? "같은 작품도 플랫폼마다 보는·소장 비용이 다릅니다. " : ""}
        회차당 <b className="font-semibold text-fg">보기(대여)</b>·
        <b className="font-semibold text-fg">소장(영구)</b> 추정가 — 모델은 실데이터, 금액은 추정·예시입니다.
      </p>

      {/* 모바일(<sm): 카드 리스트 — 표가 무너지는 좁은 폭에서 플랫폼당 한 카드. */}
      <ul className="flex flex-col gap-2 sm:hidden">
        {rows.map((r) => (
          <PriceCard key={r.platformId} row={r} multi={multi} />
        ))}
      </ul>

      {/* sm+: 표 레이아웃 — 폭이 충분해 4열이 깔끔히 들어간다. */}
      <div className="hidden overflow-hidden rounded-xl border border-line sm:block">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-line bg-card/60 text-[0.68rem] text-fg-2">
              <th className="px-3 py-2 font-medium">플랫폼</th>
              <th className="px-2 py-2 font-medium">모델</th>
              <th className="whitespace-nowrap px-2 py-2 text-right font-medium">
                <span className="inline-flex items-center gap-1"><Eye size={11} /> 보기</span>
              </th>
              <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                <span className="inline-flex items-center gap-1"><Crown size={11} /> 소장</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.platformId} className="border-b border-line/60 last:border-0">
                <td className="px-3 py-2">
                  <a
                    href={`/api/go/${r.platformId}?to=${encodeURIComponent(r.url ?? "")}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 font-medium text-fg hover:text-accent"
                  >
                    <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: r.color }} />
                    <span className="whitespace-nowrap">{r.name}</span>
                  </a>
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-fg-2">{r.modelLabel}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right">
                  <span className={cn("numeral", r.cheapestRead ? "font-semibold text-good" : "text-fg-2")}>
                    {r.monthlyWon > 0 ? "구독" : formatWon(r.readPerEpWon)}
                  </span>
                  {r.cheapestRead && multi && <span className="ml-1 text-[0.6rem] text-good">최저</span>}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <span className={cn("numeral", r.cheapestOwn ? "font-semibold text-good" : "text-fg-2")}>
                    {r.ownPerEpWon > 0 ? formatWon(r.ownPerEpWon) : "—"}
                  </span>
                  {r.cheapestOwn && multi && <span className="ml-1 text-[0.6rem] text-good">최저</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-2.5 text-[0.66rem] leading-relaxed text-fg-3">
        ※ 회차당 추정 단가입니다. 실제 비용은 작품 길이·프로모션·미리보기 정책에 따라 달라집니다.
        무료/기다무는 기다리면 0원, 빨리보기 시 과금됩니다.
      </p>
    </section>
  );
}

// 모바일 카드 한 장 — 플랫폼 이름은 한 줄(줄바꿈 금지), 보기·소장은 명시 라벨이 붙은 칩.
function PriceCard({ row: r, multi }: { row: PlatformCost; multi: boolean }) {
  const readLabel = r.monthlyWon > 0 ? "구독" : formatWon(r.readPerEpWon);
  const ownLabel = r.ownPerEpWon > 0 ? formatWon(r.ownPerEpWon) : "—";
  return (
    <li>
      <Card3D maxTilt={6} scale={1.02} className="rounded-xl">
        <div className="rounded-xl border border-line bg-card/60 p-3 shadow-sm">
          <a
            href={`/api/go/${r.platformId}?to=${encodeURIComponent(r.url ?? "")}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between gap-2 text-fg hover:text-accent"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: r.color }} />
              <span className="truncate text-sm font-semibold">{r.name}</span>
            </span>
            <span className="shrink-0 rounded-full border border-line bg-raised px-2 py-0.5 text-[0.68rem] font-medium text-fg-2">
              {r.modelLabel}
            </span>
          </a>
          <div className="mt-2.5 grid grid-cols-2 gap-2">
            <PriceCell icon={<Eye size={11} />} label="보기" value={readLabel} cheapest={!!r.cheapestRead && multi} />
            <PriceCell icon={<Crown size={11} />} label="소장" value={ownLabel} cheapest={!!r.cheapestOwn && multi} />
          </div>
        </div>
      </Card3D>
    </li>
  );
}

function PriceCell({
  icon,
  label,
  value,
  cheapest,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  cheapest: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-1 rounded-lg border px-2.5 py-1.5",
        cheapest ? "border-good/40 bg-good/10" : "border-line bg-canvas/40"
      )}
    >
      <span className="inline-flex items-center gap-1 text-[0.66rem] text-fg-3">
        {icon}
        {label}
      </span>
      <span className="inline-flex items-center gap-1">
        <span className={cn("numeral text-sm", cheapest ? "font-semibold text-good" : "text-fg-2")}>{value}</span>
        {cheapest && <span className="text-[0.58rem] font-medium text-good">최저</span>}
      </span>
    </div>
  );
}
