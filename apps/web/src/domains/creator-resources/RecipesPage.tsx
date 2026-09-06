import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import { RESOURCE_BUTTON, RESOURCE_INPUT } from "./navigation";
import { exerciseSvg, recipeById, RECIPES } from "./recipes";
import { LocalSaveNotice, ResourceLayout } from "./ResourceLayout";
import { downloadText, useCreatorWorkspace } from "./workspace";

import type { Recipe } from "./recipes";

function RecipePreview({ recipe, amount }: { recipe: Recipe; amount: number }) {
  const captions = ["문이 열렸다.", "그런데…", "이곳에 네가 왜?"];
  return <div className="space-y-3">
    <p className="text-xs text-fg-2">직접 제작한 도형 예시 · 완성 원고가 아닌 연출 실험입니다.</p>
    <div className="rounded-xl border border-line bg-canvas p-4" aria-label="실습 예시">
      {captions.map((caption, index) => <div key={caption} className="relative overflow-hidden rounded-lg border border-line" style={{ marginTop: index ? recipe.id === "scroll" ? amount : 20 : 0, height: index === 2 && recipe.id === "beats" ? amount : 140, background: recipe.id === "values" ? `hsl(0 0% ${amount}%)` : "#eeeeee" }}>
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 320 140" aria-hidden="true">
          {recipe.id === "motion" && Array.from({ length: amount }, (_, line) => <line key={`motion-${line}`} x1="15" x2={95 + line % 3 * 20} y1={12 + line * 7} y2={12 + line * 7} stroke="#606060" strokeWidth="2" />)}
          <g transform={`translate(210 90) scale(${recipe.id === "camera" ? amount / 100 : 1})`}>
            <circle cy="-32" r="15" fill="#555" /><path d="M-20 18 Q-24-19 0-14 Q24-19 20 18Z" fill="#555" /><path d="M-10 18L-13 45M10 18L13 45" fill="none" stroke="#555" strokeWidth="9" />
          </g>
        </svg>
        <p className="relative m-3 inline-block rounded-2xl border border-black bg-white px-3 py-2 text-sm text-black" style={{ maxWidth: recipe.id === "dialogue" ? `${amount}ch` : "24ch" }}>{recipe.id === "dialogue" ? "문이 열렸어. 우리가 기다리던 사람이 돌아온 걸까?" : caption}</p>
      </div>)}
    </div>
  </div>;
}
function RecipeLesson({ recipe }: { recipe: Recipe }) {
  const [amount, setAmount] = useState<number>(recipe.initial);
  const { workspace, update, error, ready, saving, writable } = useCreatorWorkspace();
  const completeCount = recipe.steps.filter((_, index) => workspace.checks.includes(`recipe-${recipe.id}-${index}`)).length;
  return <section className="space-y-5 rounded-2xl border border-line bg-panel p-5 sm:p-7">
    <header><p className="text-sm text-accent">{recipe.tag} · 약 {recipe.minutes}분 실습</p><h2 className="mt-2 text-2xl font-bold">{recipe.title}</h2><p className="mt-3 leading-7 text-fg-2">{recipe.intro}</p></header>
    <div className="grid gap-7 lg:grid-cols-2"><div className="space-y-4">
      <label htmlFor="recipe-amount" className="block font-semibold">{recipe.control}: {amount}</label>
      <input id="recipe-amount" type="range" min={recipe.min} max={recipe.max} value={amount} onChange={(event) => setAmount(Number(event.target.value))} className="min-h-11 w-full accent-current" />
      <RecipePreview recipe={recipe} amount={amount} />
    </div><div className="space-y-4"><p className="font-semibold">실습 체크 · {completeCount}/{recipe.steps.length}</p>
      {recipe.steps.map((step, index) => {
        const id = `recipe-${recipe.id}-${index}`;
        return <label key={id} htmlFor={id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-4 leading-7">
          <input id={id} type="checkbox" className="mt-1.5 size-5 shrink-0" checked={workspace.checks.includes(id)} disabled={!ready || !writable || saving} onChange={(event) => { const checked = event.target.checked; void update((value) => ({ ...value, checks: checked ? [...new Set([...value.checks, id])] : value.checks.filter((key) => key !== id) })); }} />
          <span>{index + 1}. {step}</span>
        </label>;
      })}
      <p className="rounded-xl bg-accent-soft p-4 text-sm leading-7">{recipe.tip}</p>
      <button className={RESOURCE_BUTTON} onClick={() => downloadText(`${recipe.id}-exercise.svg`, exerciseSvg(recipe, amount), "image/svg+xml;charset=utf-8")}>편집 가능한 SVG 실습 시트</button>
      <p className="text-xs leading-6 text-fg-2">SVG는 빈 컷 프레임입니다. 여백·반응 컷 높이만 시트에 반영하며, 다른 슬라이더는 화면 실험용입니다. 스튜디오에 자동으로 프로젝트를 생성하지 않습니다.</p>
    </div></div>
    <LocalSaveNotice error={error} writable={writable} saving={saving} />
  </section>;
}
export function RecipesPage() {
  const [params, setParams] = useSearchParams();
  const recipe = recipeById(params.get("lesson"));
  return <ResourceLayout title="웹툰 제작 레시피" intro="설명을 읽고 끝내지 말고, 값을 바꾸어 차이를 확인하세요. 여섯 개의 자체 제작 실습과 편집 가능한 컷 시트를 제공합니다.">
    <label htmlFor="recipe-select" className="block font-semibold">실습 선택<select id="recipe-select" className={`${RESOURCE_INPUT} mt-2`} value={recipe.id} onChange={(event) => setParams({ lesson: event.target.value })}>{RECIPES.map((item) => <option key={item.id} value={item.id}>{item.tag} · {item.title}</option>)}</select></label>
    <RecipeLesson key={recipe.id} recipe={recipe} />
  </ResourceLayout>;
}
