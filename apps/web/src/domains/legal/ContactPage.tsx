import { Bug, Megaphone, Handshake, Database, MessagesSquare, ExternalLink } from "lucide-react";

import { InquiryForm } from "@/shared/components/inquiry-form";
import { Container } from "@/shared/components/section";

const SUPPORT_URL = "https://termsdesk.vercel.app/support/toonspectrum";

const SUPPORT_LINKS = [
  {
    icon: MessagesSquare,
    title: "사이트 문의",
    body: "서비스 이용, 계정, 데이터 표시처럼 일반 문의를 남깁니다.",
    href: `${SUPPORT_URL}?category=site-inquiry`,
  },
  {
    icon: Handshake,
    title: "제휴 문의",
    body: "광고, 플랫폼 연동, 콘텐츠 제휴 같은 비즈니스 제안을 접수합니다.",
    href: `${SUPPORT_URL}?category=partnership`,
  },
  {
    icon: Bug,
    title: "버그 제보",
    body: "오류 화면, 재현 경로, 기대 동작을 공개 보드에 남깁니다.",
    href: `${SUPPORT_URL}?category=bug`,
  },
];

// 광고·제휴/문의(/contact) — 광고 슬롯·업무제휴·데이터 문의 등 비즈니스 연락 창구.
const TYPES = [
  { icon: Megaphone, title: "광고 문의", body: "배너·스폰서 슬롯·추천 영역 등 광고 집행 및 단가 문의." },
  { icon: Handshake, title: "업무 제휴", body: "플랫폼 연동, 콘텐츠 제휴, 공동 기획·프로모션 등 비즈니스 제안." },
  { icon: Database, title: "데이터 문의", body: "랭킹·통계·카탈로그 데이터 활용, API/리포트 관련 문의." },
  { icon: MessagesSquare, title: "기타 문의", body: "서비스 제휴/투자, 채용, 권리 관련 등 그 밖의 모든 문의." },
];

export function ContactPage() {
  return (
    <Container size="default" className="py-8 sm:py-12 lg:py-16">
      <p className="eyebrow text-accent">CONTACT</p>
      <h1 className="mt-3 text-pretty text-[clamp(1.6rem,7vw,1.875rem)] font-bold leading-tight sm:text-4xl">광고·제휴 문의</h1>
      <p className="mt-4 max-w-2xl text-pretty text-base leading-relaxed text-fg-2">
        툰스펙트럼은 웹툰·웹소설 독자가 매일 찾는 통합 발견 서비스입니다. 아래 폼으로 보내시면 운영팀
        공개 문의 게시판으로 접수돼요. 제목과 내용은 다른 사용자도 볼 수 있으므로 개인정보와 비공개 제안서는 입력하지 마세요.
      </p>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div>
          <h2 className="mb-3 text-lg font-bold text-fg">이런 문의를 받습니다</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {TYPES.map((t) => (
              <div key={t.title} className="rounded-2xl border border-line bg-card/60 p-5">
                <t.icon className="mb-2 text-accent" size={20} />
                <p className="font-semibold text-fg">{t.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-fg-2">{t.body}</p>
              </div>
            ))}
          </div>

          <h2 className="mt-8 mb-3 text-lg font-bold text-fg">공개 지원 보드</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {SUPPORT_LINKS.map((link) => (
              <a
                key={link.title}
                href={link.href}
                target="_blank"
                rel="noreferrer"
                className="flex min-h-full flex-col gap-2 rounded-2xl border border-line bg-card p-5 transition-colors hover:border-accent/50 hover:bg-accent-soft"
              >
                <link.icon className="text-accent" size={22} />
                <span className="inline-flex items-center gap-1 text-base font-bold text-fg">
                  {link.title}
                  <ExternalLink size={13} className="text-fg-3" />
                </span>
                <span className="text-sm leading-relaxed text-fg-2">{link.body}</span>
              </a>
            ))}
          </div>
        </div>

        <aside>
          <div className="sticky top-20 rounded-2xl border border-line bg-panel/40 p-5">
            <h2 className="mb-1 text-sm font-semibold text-fg">바로 문의하기</h2>
            <p className="mb-4 text-xs leading-relaxed text-fg-3">
              로그인 없이 공개 문의를 보낼 수 있어요. 개인정보는 본문에 남기지 마세요.
            </p>
            <InquiryForm defaultCategory="partnership" />
          </div>
        </aside>
      </div>
    </Container>
  );
}
