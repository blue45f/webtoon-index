import type { ReactNode } from "react";

import { cn } from "@/shared/lib/utils";

export const adminInputClass =
  "h-10 w-full rounded-lg border border-line bg-canvas px-3 text-sm outline-none focus:border-accent/60";

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 bg-card p-4">
      <dt className="text-xs text-fg-3">{label}</dt>
      <dd className="numeral text-xl text-fg">{value}</dd>
    </div>
  );
}

export function StatGroup({ icon, label, children }: { icon?: ReactNode; label: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-1.5 text-fg-2">
        {icon && <span className="text-accent">{icon}</span>}
        <h2 className="text-sm font-semibold">{label}</h2>
      </div>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-3 lg:grid-cols-5">
        {children}
      </dl>
    </section>
  );
}

export function Field({ label, children, full }: { label: string; children: ReactNode; full?: boolean }) {
  return (
    <label className={cn("flex flex-col gap-1.5", full && "sm:col-span-2")}>
      <span className="text-xs font-medium text-fg-3">{label}</span>
      {children}
    </label>
  );
}

export function AdminNotice({ title, body }: { title: string; body: string }) {
  return (
    <section className="rounded-2xl border border-line bg-card p-6">
      <h2 className="text-lg font-semibold text-fg">{title}</h2>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-fg-3">{body}</p>
    </section>
  );
}

export function AdminSpinner() {
  return (
    <div className="flex min-h-[30vh] items-center justify-center" role="status" aria-label="불러오는 중">
      <span className="size-6 animate-spin rounded-full border-2 border-line border-t-accent" />
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "paid"
      ? "border-good/40 text-good"
      : status === "approved"
        ? "border-cool/40 text-cool"
        : status === "pending"
          ? "border-warn/40 text-warn"
          : status === "rejected" || status === "revoked"
            ? "border-bad/40 text-bad"
            : "border-line text-fg-3";
  return (
    <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[0.7rem] font-medium", tone)}>
      {status}
    </span>
  );
}