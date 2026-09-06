import type { Title } from "@/shared/lib/types";

export interface RecommendPayload {
  pickedRecs: Title[];
  pickedLabelGenres: string[];
  tasteRecs: { title: Title; reason: string }[];
  popular: Title[];
  seed: Title | null;
  similar: Title[];
  profile: {
    ratedCount: number;
    readCount: number;
    topGenres: { name: string; weight: number }[];
  };
}

export const ONBOARDING_GENRES = ["판타지", "로판", "현판", "무협", "로맨스", "액션", "스릴러", "드라마", "학원", "SF", "코미디", "게임판타지"];
