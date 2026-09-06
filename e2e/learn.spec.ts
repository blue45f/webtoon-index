import { expect, test } from "@playwright/test";

import { LESSONS, TERMS } from "../apps/web/src/domains/learn/learning-content";
import { STORAGE_KEY } from "../apps/web/src/domains/learn/learning-model";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("toonspectrum-compat-dismissed", "true"));
});

test("curriculum, all lessons, glossary and invalid addresses render", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/learn");
  await expect(page.locator(".learn-card")).toHaveCount(LESSONS.length);
  for (const lesson of LESSONS) {
    await page.goto(`/learn/lessons/${lesson.id}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(lesson.title);
    await expect(page.getByRole("slider")).toHaveCount(2);
    await expect(page.getByRole("button", { name: "이 강좌 학습 완료", exact: true })).toBeDisabled();
  }
  await page.goto("/learn/glossary");
  await expect(page.locator(".learn-term-card")).toHaveCount(TERMS.length);
  await page.goto("/learn/lessons/does-not-exist");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("학습 페이지를 찾을 수 없습니다.");
  expect(errors).toEqual([]);
});

test("Korean and English search, bookmarks, deep links and back navigation", async ({ page }) => {
  await page.goto("/learn/glossary");
  await page.getByLabel("용어 검색", { exact: true }).fill("CLIPPING");
  await expect(page.locator(".learn-term-card")).toHaveCount(1);
  await page.getByRole("button", { name: "클리핑 저장", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "클리핑 저장", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.locator(".learn-term-card h2 a").click();
  await expect(page).toHaveURL(/term=clipping/u);
  await expect(page.locator(".learn-term-card details")).toHaveAttribute("open", "");
  await page.goBack();
  await expect(page.getByLabel("용어 검색", { exact: true })).toHaveValue("CLIPPING");
  await page.getByLabel("용어 검색", { exact: true }).fill("소 실 점");
  await expect(page.locator(".learn-term-card h2")).toHaveText("소실점");
});

test("completion requires the assignment and correct quiz, survives reload, and revokes on uncheck", async ({ page }) => {
  const lesson = LESSONS[0];
  await page.goto(`/learn/lessons/${lesson.id}`);
  const finish = page.getByRole("button", { name: "이 강좌 학습 완료", exact: true });
  await page.getByRole("radio").nth(lesson.quiz.answer).check();
  await expect(finish).toBeDisabled();
  for (const checkbox of await page.getByRole("checkbox").all()) await checkbox.check();
  await page.getByLabel("나의 실습 메모", { exact: true }).fill("컷의 역할을 구분했다.");
  await expect(finish).toBeEnabled();
  await finish.click();
  await page.reload();
  await expect(page.getByRole("button", { name: "학습 완료됨", exact: true })).toBeDisabled();
  await expect(page.getByLabel("나의 실습 메모", { exact: true })).toHaveValue("컷의 역할을 구분했다.");
  await page.getByRole("checkbox").first().uncheck();
  await expect(finish).toBeDisabled();
});

test("reduced motion remains step-readable and mobile has no document overflow", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/learn/lessons/camera-perspective");
  await expect(page.getByRole("button", { name: "설명 재생", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "3단계", exact: true }).click();
  await expect(page.locator(".learn-caption").first()).toContainText("눈높이");
  await page.getByRole("slider").first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("slider").first()).toHaveValue("131");
  for (const path of ["/learn", "/learn/glossary", "/learn/studio", "/learn/lessons/lettering"]) {
    await page.goto(path);
    await expect(page.locator(".learn-page")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test("malformed storage and unavailable persistent writes do not crash learning", async ({ page }) => {
  await page.goto("/learn");
  await page.evaluate((key) => localStorage.setItem(key, "{invalid-json"), STORAGE_KEY);
  await page.reload();
  await expect(page.locator(".learn-card")).toHaveCount(LESSONS.length);
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === "toonstudio:learning:v1") throw new DOMException("full", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await page.goto("/learn/lessons/story-board");
  await page.getByLabel("나의 실습 메모", { exact: true }).fill("저장 실패 중에도 유지할 메모");
  await page.getByRole("checkbox").first().check();
  await expect(page.getByLabel("나의 실습 메모", { exact: true })).toHaveValue("저장 실패 중에도 유지할 메모");
  await expect(page.getByRole("status").filter({ hasText: "기록을 기기에 저장하지 못했습니다" })).toBeVisible();
});

test("reset is explicit and does not erase records on cancel", async ({ page }) => {
  await page.goto("/learn/lessons/story-board");
  await page.getByLabel("나의 실습 메모", { exact: true }).fill("보존할 메모");
  await page.getByRole("button", { name: "학습 기록 초기화…", exact: true }).click();
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await expect(page.getByLabel("나의 실습 메모", { exact: true })).toHaveValue("보존할 메모");
  await page.getByRole("button", { name: "학습 기록 초기화…", exact: true }).click();
  await page.getByRole("button", { name: "모두 지우기", exact: true }).click();
  await expect(page.getByLabel("나의 실습 메모", { exact: true })).toHaveValue("");
});
