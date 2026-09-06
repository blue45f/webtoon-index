import { Star } from "lucide-react";

import Link from "@/src/compat/router-link";

export function EmptyTeach({
  icon: Icon,
  title,
  desc,
  cta,
}: {
  icon: typeof Star;
  title: string;
  desc: string;
  cta?: { label: string; href: string };
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line bg-card/40 px-6 py-16 text-center">
      <div className="grid size-12 place-items-center rounded-2xl bg-raised text-fg-3">
        <Icon size={22} />
      </div>
      <div>
        <p className="font-semibold text-fg">{title}</p>
        <p className="mt-1 max-w-xs text-sm leading-relaxed text-fg-2">{desc}</p>
      </div>
      {cta && (
        <Link
          href={cta.href}
          className="mt-1 inline-flex min-h-11 items-center rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90"
        >
          {cta.label}
        </Link>
      )}
    </div>
  );
}
