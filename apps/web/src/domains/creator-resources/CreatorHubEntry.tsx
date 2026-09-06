import { Link } from "react-router-dom";

export function CreatorHubEntry() {
  return <section aria-label="창작 허브 바로가기" className="mx-auto my-10 max-w-6xl rounded-2xl border border-line bg-panel p-6 text-fg">
    <p className="text-sm font-semibold text-accent">CREATOR WORKSPACE</p>
    <h2 className="mt-2 font-display text-2xl font-bold">다음 장면을 시작할 준비</h2>
    <p className="mt-2 leading-7 text-fg-2">지원사업 찾기, 출처 있는 레퍼런스, 직접 해보는 제작 레시피를 한곳에서.</p>
    <div className="mt-5 flex flex-wrap gap-3">
      {[["/creator-hub", "창작 허브 열기"], ["/opportunities", "작가 기회센터"], ["/creator-hub/references", "창작 자료"], ["/learn/recipes", "제작 레시피"]].map(([path, title]) =>
        <Link key={path} to={path} className="inline-flex min-h-11 items-center rounded-xl border border-line px-4 py-2 text-sm font-semibold hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">{title} →</Link>)}
    </div>
  </section>;
}
