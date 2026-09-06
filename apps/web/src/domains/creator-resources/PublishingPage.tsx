import { RESOURCE_BUTTON } from "./navigation";
import { LocalSaveNotice, ResourceLayout } from "./ResourceLayout";
import { downloadText, useCreatorWorkspace } from "./workspace";

const CHECKLIST = [
  { id: "pitch", group: "작품 소개", title: "한 문장 소개와 장르를 정리했습니다.", detail: "누가 무엇을 원하고 어떤 갈등을 겪는지 전달하는 소개를 작성하세요." },
  { id: "synopsis", group: "작품 소개", title: "시놉시스와 주요 인물 설정을 준비했습니다.", detail: "제출처가 요구하는 분량과 결말 공개 여부를 원문에서 확인하세요." },
  { id: "audience", group: "작품 소개", title: "예상 독자와 작품의 강점을 설명할 수 있습니다.", detail: "조회수나 시장 성과를 근거 없이 단정하지 말고 작품의 특징을 구체화하세요." },
  { id: "format", group: "원고 점검", title: "제출처의 최신 원고 규격을 확인했습니다.", detail: "가로·세로 크기, 파일 형식, 용량, 색상 공간을 공식 안내에서 확인하세요. 플랫폼마다 다릅니다." },
  { id: "reading", group: "원고 점검", title: "휴대폰에서 대사와 스크롤 흐름을 확인했습니다.", detail: "말풍선 순서, 작은 글자, 컷 간 여백과 중요한 장면의 잘림을 확인하세요." },
  { id: "proof", group: "원고 점검", title: "오탈자와 누락된 컷을 검수했습니다.", detail: "편집 파일뿐 아니라 실제 제출용으로 내보낸 파일을 다시 열어보세요." },
  { id: "sources", group: "출처와 협업", title: "폰트·브러시·배경·음악의 이용조건을 기록했습니다.", detail: "상업 이용, 수정, 재배포, 크레딧 조건을 각각 확인하세요." },
  { id: "partners", group: "출처와 협업", title: "공동 작업자의 크레딧과 공개 동의를 확인했습니다.", detail: "원고·홍보 영상에 포함된 공동 작업물의 사용 범위를 정리하세요." },
  { id: "rights", group: "출처와 협업", title: "계약·공모전 조건을 검토했습니다.", detail: "독점, 2차적 이용, 수익 배분 등 이해하지 못한 조항은 전문가에게 확인하세요." },
  { id: "deadline", group: "제출 준비", title: "접수 마감 날짜와 정확한 시간을 확인했습니다.", detail: "기회센터 일정 파일은 날짜 참고용입니다. 원문 변경과 접수 시스템 점검을 확인하세요." },
  { id: "backup", group: "제출 준비", title: "편집 원본과 제출본을 별도로 백업했습니다.", detail: "브라우저 저장 데이터만 믿지 말고 다른 저장 위치에 복사본을 보관하세요." },
  { id: "receipt", group: "제출 준비", title: "접수 후 제출 파일과 접수 확인을 보관했습니다.", detail: "접수 번호, 확인 메일과 최종 파일 버전을 남기세요." },
];
export function PublishingPage() {
  const { workspace, update, error, ready, saving, writable } = useCreatorWorkspace();
  const completed = CHECKLIST.filter((item) => workspace.checks.includes(`publish-${item.id}`)).length;
  return <ResourceLayout title="연재·출판 준비실" intro="제출 전에 놓치기 쉬운 항목을 확인하세요. 이 체크리스트는 일반적인 준비 도구이며, 특정 플랫폼의 접수 기준이나 법률 자문이 아닙니다.">
    <section className="space-y-4 rounded-2xl border border-line bg-panel p-6">
      <h2 className="text-xl font-bold">준비 상태 · {completed}/{CHECKLIST.length}</h2>
      <progress max={CHECKLIST.length} value={completed} aria-label="출판 준비 완료 항목" className="h-3 w-full" />
      <button className={RESOURCE_BUTTON} onClick={() => downloadText("publishing-checklist.md", "# 연재·출판 준비 체크리스트\n\n특정 제출처의 공식 기준이 아닙니다. 최신 안내를 별도로 확인하세요.\n\n" + CHECKLIST.map((item) => `- [${workspace.checks.includes(`publish-${item.id}`) ? "x" : " "}] ${item.title}\n  ${item.detail}`).join("\n"))}>체크리스트 내보내기</button>
    </section>
    <div className="grid gap-4 md:grid-cols-2">{CHECKLIST.map((item) => {
      const id = `publish-${item.id}`;
      return <label aria-label={item.title} htmlFor={id} key={id} className="flex cursor-pointer gap-4 rounded-2xl border border-line bg-panel p-5">
        <input id={id} type="checkbox" className="mt-1 size-5 shrink-0" checked={workspace.checks.includes(id)} disabled={!ready || !writable || saving} onChange={(event) => { const checked = event.target.checked; void update((value) => ({ ...value, checks: checked ? [...new Set([...value.checks, id])] : value.checks.filter((key) => key !== id) })); }} />
        <span><span className="mb-2 block text-xs font-semibold text-accent">{item.group}</span><span className="block font-semibold leading-7">{item.title}</span><span className="mt-2 block text-sm leading-7 text-fg-2">{item.detail}</span></span>
      </label>;
    })}</div>
    <LocalSaveNotice error={error} writable={writable} saving={saving} />
  </ResourceLayout>;
}
