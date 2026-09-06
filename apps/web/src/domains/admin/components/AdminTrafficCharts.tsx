import { Radio, TrendingUp } from "lucide-react";

import { formatNum } from "./admin-client";
import {
  formatTrafficDateTime,
  type AdminTrafficTranslator,
  type TrafficSeriesPoint,
} from "./admin-traffic-model";

function linePath(
  points: TrafficSeriesPoint[],
  accessor: (point: TrafficSeriesPoint) => number,
  width: number,
  height: number,
  maximum: number,
): string {
  if (!points.length) return "";
  return points
    .map((point, index) => {
      const x =
        points.length === 1 ? width / 2 : (index / (points.length - 1)) * width;
      const y = height - (accessor(point) / maximum) * height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

export function TrafficTrendChart({
  points,
  locale,
  t,
}: {
  points: TrafficSeriesPoint[];
  locale: string;
  t: AdminTrafficTranslator;
}) {
  const width = 760;
  const height = 220;
  const maximum = Math.max(
    1,
    ...points.flatMap((point) => [point.pageViews, point.visitors]),
  );
  const pageViewPath = linePath(
    points,
    (point) => point.pageViews,
    width,
    height,
    maximum,
  );
  const visitorPath = linePath(
    points,
    (point) => point.visitors,
    width,
    height,
    maximum,
  );

  return (
    <section className="rounded-2xl border border-line bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <TrendingUp className="size-4 text-accent" />
            <h3 className="text-sm font-semibold text-fg">
              {t("admin.traffic.trend")}
            </h3>
          </div>
          <div className="mt-2 flex items-center gap-4 text-[0.7rem] text-fg-3">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-accent" />
              {t("admin.traffic.pageViewsLegend")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-cool" />
              {t("admin.traffic.visitorsLegend")}
            </span>
          </div>
        </div>
        {points.length ? (
          <p className="text-[0.7rem] text-fg-3">
            {formatTrafficDateTime(points[0]?.bucket, locale)} —{" "}
            {formatTrafficDateTime(points.at(-1)?.bucket, locale)}
          </p>
        ) : null}
      </div>

      <div className="mt-4 overflow-x-auto">
        <svg
          viewBox={`-12 -12 ${width + 24} ${height + 24}`}
          className="h-56 min-w-[620px] w-full"
          role="img"
          aria-label={`${t("admin.traffic.trend")}: ${formatNum(
            points.reduce((sum, point) => sum + point.pageViews, 0),
          )} ${t("admin.traffic.pageViews")}`}
        >
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
            <line
              key={ratio}
              x1={0}
              x2={width}
              y1={height * ratio}
              y2={height * ratio}
              className="stroke-line"
              strokeWidth={1}
            />
          ))}
          <path
            d={pageViewPath}
            fill="none"
            className="stroke-accent"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d={visitorPath}
            fill="none"
            className="stroke-cool"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {points.map((point, index) => {
            const x =
              points.length === 1
                ? width / 2
                : (index / (points.length - 1)) * width;
            const y = height - (point.pageViews / maximum) * height;
            return (
              <circle
                key={`${point.bucket}-${index}`}
                cx={x}
                cy={y}
                r={points.length < 40 ? 3 : 1.5}
                className="fill-accent"
              >
                <title>
                  {formatTrafficDateTime(point.bucket, locale)} ·{" "}
                  {point.pageViews} {t("admin.traffic.pageViews")}
                </title>
              </circle>
            );
          })}
        </svg>
      </div>

      <details className="mt-2 text-xs text-fg-3">
        <summary className="cursor-pointer select-none py-1">
          {t("admin.traffic.trend")} data
        </summary>
        <div className="mt-2 max-h-56 overflow-auto rounded-xl border border-line">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-card text-[0.7rem]">
              <tr>
                <th className="px-3 py-2">{t("admin.traffic.time")}</th>
                <th className="px-3 py-2">{t("admin.traffic.pageViews")}</th>
                <th className="px-3 py-2">{t("admin.traffic.visitors")}</th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.bucket} className="border-t border-line">
                  <td className="px-3 py-2">
                    {formatTrafficDateTime(point.bucket, locale)}
                  </td>
                  <td className="px-3 py-2">{formatNum(point.pageViews)}</td>
                  <td className="px-3 py-2">{formatNum(point.visitors)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

export function TrafficRealtimeBars({
  points,
  locale,
  t,
}: {
  points: TrafficSeriesPoint[];
  locale: string;
  t: AdminTrafficTranslator;
}) {
  const maximum = Math.max(1, ...points.map((point) => point.pageViews));
  return (
    <section className="rounded-2xl border border-line bg-card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Radio className="size-4 text-good" />
          <h3 className="text-sm font-semibold text-fg">
            {t("admin.traffic.realtime30m")}
          </h3>
        </div>
        <span className="inline-flex items-center gap-1 text-[0.7rem] font-medium text-good">
          <span className="size-1.5 animate-pulse rounded-full bg-good" />
          {t("admin.traffic.live")}
        </span>
      </div>
      <div
        className="mt-5 flex h-28 items-end gap-1"
        role="img"
        aria-label={t("admin.traffic.realtime30m")}
      >
        {points.length ? (
          points.map((point) => (
            <div
              key={point.bucket}
              className="group relative min-w-0 flex-1 rounded-t bg-accent/65 transition-colors hover:bg-accent"
              style={{
                height: `${Math.max(4, (point.pageViews / maximum) * 100)}%`,
              }}
            >
              <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-lg border border-line bg-canvas px-2 py-1 text-[0.65rem] text-fg shadow-lg group-hover:block">
                {formatTrafficDateTime(point.bucket, locale)} ·{" "}
                {point.pageViews}
              </span>
            </div>
          ))
        ) : (
          <div className="flex h-full w-full items-center justify-center rounded-xl border border-dashed border-line text-xs text-fg-3">
            {t("admin.traffic.noData")}
          </div>
        )}
      </div>
      {points.length ? (
        <ul className="sr-only">
          {points.map((point) => (
            <li key={point.bucket}>
              {formatTrafficDateTime(point.bucket, locale)}: {point.pageViews}{" "}
              {t("admin.traffic.pageViews")}, {point.visitors}{" "}
              {t("admin.traffic.visitors")}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
