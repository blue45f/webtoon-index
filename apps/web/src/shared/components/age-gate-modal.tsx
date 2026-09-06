import * as Dialog from "@radix-ui/react-dialog";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";

import { useT } from "@/shared/lib/i18n";
import { useApp, useHydrated } from "@/shared/lib/store";

// 스팀식 자가 연령 확인 — 생년월일 1회 입력 → 만 19세 이상이면 19금 표지 블러 해제(브라우저 저장).
// 생년월일은 네이티브 date picker 대신 년/월/일 드롭다운으로 받는다(과거 연도 선택이 훨씬 쉬움).
// 신원 확인이 아닌 자가 확인. 19+ 표지 배지(시각 표시)는 인증과 무관하게 유지된다.
// 모달 셸은 Radix Dialog(포커스 트랩·Escape·백드롭 클릭·aria-modal)로 제공 — 시각은 기존 OKLCH 토큰 그대로.
const SELECT_CLASS =
  "w-full rounded-lg border border-line bg-raised px-2.5 py-2 text-sm text-fg focus:border-accent/60 focus:outline-none";

export function AgeGateModal() {
  const hydrated = useHydrated();
  const open = useApp((s) => s.ageGateOpen);
  const verify = useApp((s) => s.verifyAdultBirthdate);
  const close = useApp((s) => s.closeAgeGate);
  const t = useT();
  const [year, setYear] = useState("");
  const [month, setMonth] = useState("");
  const [day, setDay] = useState("");
  const [denied, setDenied] = useState(false);

  if (!hydrated) return null;

  const now = new Date();
  const curYear = now.getFullYear();
  const years = Array.from({ length: 101 }, (_, i) => curYear - i); // 올해 ~ 100년 전
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const daysInMonth = year && month ? new Date(Number(year), Number(month), 0).getDate() : 31;
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const complete = Boolean(year && month && day);

  const submit = () => {
    if (!complete) return;
    const iso = `${year}-${String(month).padStart(2, "0")}-${String(Math.min(Number(day), daysInMonth)).padStart(2, "0")}`;
    if (!verify(iso)) setDenied(true);
  };
  const clearDenied = () => setDenied(false);

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-[oklch(0.12_0.012_70/0.72)] backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-[60] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line bg-panel p-6 text-left shadow-2xl focus:outline-none"
        >
          <ShieldCheck className="text-accent" size={26} />
          <Dialog.Title className="mt-3 font-display text-lg font-bold text-fg">{t("ageGate.title")}</Dialog.Title>
          <p className="mt-1.5 text-sm leading-relaxed text-fg-3">
            {t("ageGate.description")}
          </p>
          <span className="mt-4 block text-xs font-medium text-fg-2">{t("ageGate.birthDateLabel")}</span>
          <div className="mt-1.5 grid grid-cols-[1.3fr_1fr_1fr] gap-2">
            <select
              aria-label={t("ageGate.birthYearLabel")}
              value={year}
              onChange={(e) => {
                setYear(e.target.value);
                clearDenied();
              }}
              className={SELECT_CLASS}
            >
              <option value="">{t("ageGate.birthYearPlaceholder")}</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                  {t("ageGate.yearSuffix")}
                </option>
              ))}
            </select>
            <select
              aria-label={t("ageGate.birthMonthLabel")}
              value={month}
              onChange={(e) => {
                setMonth(e.target.value);
                clearDenied();
              }}
              className={SELECT_CLASS}
            >
              <option value="">{t("ageGate.birthMonthPlaceholder")}</option>
              {months.map((m) => (
                <option key={m} value={m}>
                  {m}
                  {t("ageGate.monthSuffix")}
                </option>
              ))}
            </select>
            <select
              aria-label={t("ageGate.birthDayLabel")}
              value={day}
              onChange={(e) => {
                setDay(e.target.value);
                clearDenied();
              }}
              className={SELECT_CLASS}
            >
              <option value="">{t("ageGate.birthDayPlaceholder")}</option>
              {days.map((d) => (
                <option key={d} value={d}>
                  {d}
                  {t("ageGate.daySuffix")}
                </option>
              ))}
            </select>
          </div>
          {denied && (
            <p className="mt-2 text-xs font-medium text-bad">{t("ageGate.deniedMessage")}</p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-lg border border-line px-3.5 py-2 text-sm font-medium text-fg-2 transition-colors hover:bg-raised"
              >
                {t("ageGate.cancel")}
              </button>
            </Dialog.Close>
            <button
              type="button"
              onClick={submit}
              disabled={!complete}
              className="rounded-lg bg-accent px-3.5 py-2 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {t("ageGate.confirm")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
