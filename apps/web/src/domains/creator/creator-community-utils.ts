import type { SeriesStatus, WorkSummary } from "@/src/infrastructure/creator-client";

export const FORMAT_LABEL: Record<WorkSummary["format"], string> = {
  cuttoon: "컷툰",
  upload: "업로드",
};

export const SERIES_STATUS_LABEL: Record<SeriesStatus, string> = {
  ongoing: "연재중",
  completed: "완결",
};
