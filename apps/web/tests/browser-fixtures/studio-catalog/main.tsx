/** Component browser fixture: real production UI and SQLite preferences, observable host callback. */
import { useState } from "react";
import { createRoot } from "react-dom/client";

import { StudioSceneTemplateBrowser } from "../../../src/domains/creator/catalog/StudioSceneTemplateBrowser";
import { SCENE_TEMPLATES, SCENE_TEMPLATE_CATEGORIES } from "../../../src/domains/creator/studio-scene-templates";
import { StudioElementsPanel } from "../../../src/domains/creator/StudioElementsPanel";
import "../../../src/styles/globals.css";

function Fixture() {
  const [surface, setSurface] = useState("scenes");
  const [count, setCount] = useState(0);
  return <main className="min-h-screen bg-canvas p-3 text-fg" data-catalog-fixture="true">
    <header className="mx-auto mb-4 grid max-w-5xl gap-2"><h1 className="text-xl font-semibold">Studio · 에셋 & 장면 라이브러리</h1>
      <p className="text-xs text-fg-3">프로덕션 컴포넌트 검증 화면 · 삽입 콜백 측정용이며 실제 문서 저장 검증은 아닙니다.</p>
      <nav className="flex gap-2"><button type="button" className="min-h-11 rounded-lg border border-line px-3" onClick={() => setSurface("scenes")}>장면</button><button type="button" className="min-h-11 rounded-lg border border-line px-3" onClick={() => setSurface("elements")}>요소</button><button type="button" className="min-h-11 rounded-lg border border-line px-3" onClick={() => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === "light" ? "dark" : "light"; }}>테마</button></nav>
      <output aria-label="삽입 요청 수">{count}</output>
    </header>
    <div className="mx-auto max-w-5xl rounded-2xl border border-line bg-panel p-3 sm:p-5">
      {surface === "scenes" ? <StudioSceneTemplateBrowser templates={SCENE_TEMPLATES} categories={SCENE_TEMPLATE_CATEGORIES} loading={false} error={null} onAdd={async () => { setCount((value) => value + 1); }} /> : <StudioElementsPanel onAdd={() => setCount((value) => value + 1)} />}
    </div>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
