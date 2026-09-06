import { MANUAL_ARTICLES, type ManualArticle } from "./studio-manual-data";

export const MANUAL_QUERY_LIMIT = 160;
export const MANUAL_BASE_PATH = "/studio/manual";

export function manualArticleHref(id: string): string {
  return `${MANUAL_BASE_PATH}/${encodeURIComponent(id)}`;
}

export function findManualArticle(id: string | undefined): ManualArticle | undefined {
  return MANUAL_ARTICLES.find((article) => article.id === id);
}

export function normalizeManualSearch(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/\s+/gu, " ").trim();
}

const SEARCH_INDEX = MANUAL_ARTICLES.map((article) => ({
  article,
  title: normalizeManualSearch(article.title),
  keywords: normalizeManualSearch(article.keywords.join(" ")),
  text: normalizeManualSearch([
    article.title, article.summary, ...article.keywords,
    ...article.sections.flatMap((section) => [
      section.title, ...section.paragraphs, ...(section.steps ?? []), section.note ?? "",
    ]),
  ].join(" ")),
}));

/** Literal token matching only: user input is never compiled into a regular expression. */
export function searchManual(query: string, category = "all"): readonly ManualArticle[] {
  const tokens = normalizeManualSearch(query.slice(0, MANUAL_QUERY_LIMIT)).split(" ").filter(Boolean);
  return SEARCH_INDEX
    .filter(({ article, text }) => (category === "all" || article.category === category)
      && tokens.every((token) => text.includes(token)))
    .map((entry) => ({
      article: entry.article,
      score: tokens.reduce((sum, token) => sum + (entry.title.includes(token) ? 10 : 0)
        + (entry.keywords.includes(token) ? 5 : 0), 0),
    }))
    .sort((left, right) => right.score - left.score)
    .map(({ article }) => article);
}
