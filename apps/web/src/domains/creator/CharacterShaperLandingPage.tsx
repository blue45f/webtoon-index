import { SITE_URL } from "@toonspectrum/core";
import {
  ArrowRight,
  Box,
  Camera,
  ChevronDown,
  Layers,
  ScanFace,
  ShieldCheck,
} from "lucide-react";

import {
  AiAssistArt,
  OutputLayersArt,
  PresetSlotsArt,
  ShaperHeroArt,
  SurfacePaintArt,
} from "./CharacterShaperLandingArt";

import type { ComponentType } from "react";


import { RevealOnScroll } from "@/shared/components/reveal-on-scroll";
import { Container, Section } from "@/shared/components/section";
import { buttonClass } from "@/shared/components/ui/button-utils";
import Link from "@/src/compat/router-link";
import {
  useDocumentTitle,
  useJsonLd,
  useMetaDescription,
  usePageSocialMeta,
} from "@/src/hooks/use-document-title";

// 캐릭터 셰이퍼 공개 랜딩 + 사용 가이드(/shaper). 실제 도구는 /studio/character 에 있고,
// 이 페이지는 무엇을 할 수 있고 무엇이 모델에 따라 달라지는지를 짧고 정직하게 안내한다.
// 수치·후기·검증되지 않은 약속은 쓰지 않는다(PRODUCT.md "주장보다 증거").

const SHAPER_PATH = "/shaper";
const STUDIO_SHAPER_PATH = "/studio/character";
const SHAPER_TITLE = "캐릭터 셰이퍼";
const SHAPER_DESCRIPTION =
  "프리셋으로 3D 웹툰 캐릭터를 만들고, 사진·웹캠으로 포즈를 잡고, 모델 위에 직접 그려 투명 PNG와 레이어 PSD로 컷에 넣는 브라우저 도구입니다. 설치 없이 스튜디오에서 바로 엽니다.";

const SLOT_LABELS = [
  "얼굴형",
  "눈",
  "눈동자",
  "코",
  "입",
  "귀",
  "헤어",
  "체형",
  "상의",
  "하의",
  "신발",
  "액세서리",
  "표정",
  "포즈",
  "손 포즈",
] as const;

const PSD_LAYERS = [
  "피부",
  "얼굴",
  "눈",
  "헤어",
  "상의",
  "하의",
  "신발",
  "액세서리",
  "음영",
  "하이라이트",
  "주선",
] as const;

interface FeatureBlock {
  readonly id: string;
  readonly numeral: string;
  readonly title: string;
  readonly body: string;
  readonly art: ComponentType<{ className?: string }>;
  readonly chips: readonly string[];
}

const FEATURES: readonly FeatureBlock[] = [
  {
    id: "presets",
    numeral: "01",
    title: "15개 슬롯 프리셋",
    body: "얼굴형부터 손 포즈까지 15개 슬롯을 카드로 고릅니다. 카드를 누르면 바로 적용되고 되돌리기 한 단계로 취소됩니다. 슬롯 하나를 바꿔도 다른 슬롯은 그대로입니다.",
    art: PresetSlotsArt,
    chips: SLOT_LABELS,
  },
  {
    id: "paint",
    numeral: "02",
    title: "모델 위에 직접 드로잉",
    body: "표면 드로잉을 켜면 브러시·지우개·스포이드·채우기로 모델의 UV 표면에 직접 칠합니다. 포즈나 카메라를 바꿔도 그린 선은 모델을 따라갑니다.",
    art: SurfacePaintArt,
    chips: ["브러시", "지우개", "스포이드", "채우기", "포즈를 바꿔도 유지"],
  },
  {
    id: "ai",
    numeral: "03",
    title: "AI 보조",
    body: "참고 이미지를 놓으면 프리셋 조합과 팔레트를 추천하고, 사진이나 웹캠에서 포즈를 읽어 모델에 옮깁니다. 모두 기기 안에서 처리하며 이미지를 업로드하지 않습니다.",
    art: AiAssistArt,
    chips: ["참고 이미지 → 프리셋·팔레트", "사진 → 포즈", "웹캠 → 포즈", "기기 내 처리"],
  },
  {
    id: "output",
    numeral: "04",
    title: "제작 편의",
    body: "투명 배경을 켜고 '캔버스에 추가'를 누르면 현재 컷에 PNG로 바로 들어갑니다. PSD는 밑색·음영·하이라이트·주선이 의미 단위 레이어로 나뉘어 나옵니다.",
    art: OutputLayersArt,
    chips: PSD_LAYERS,
  },
];

interface HowToStep {
  readonly title: string;
  readonly body: string;
  readonly tip: string;
}

const HOW_TO_STEPS: readonly HowToStep[] = [
  {
    title: "모델 고르기",
    body: "내장 라이브러리의 VRM을 고르거나 내 VRM 파일을 올립니다. 모델이 뷰포트에 뜨면 준비는 끝입니다.",
    tip: "VRM 0.x와 1.0을 모두 읽습니다. 처음이라면 내장 샘플로 시작하세요.",
  },
  {
    title: "슬롯 카드 고르기",
    body: "왼쪽 슬롯 레일을 얼굴형부터 손 포즈까지 차례로 훑으며 카드를 눌러 적용합니다. 요약 바에서 무엇이 바뀌었는지 확인합니다.",
    tip: "1–0 키로 슬롯을 바로 옮기고, 마음에 안 들면 ⌘Z로 한 단계씩 되돌립니다.",
  },
  {
    title: "참고 이미지·사진·웹캠",
    body: "참고 이미지를 놓으면 프리셋 조합과 팔레트를 추천받아 한 번에 적용합니다. 사진이나 웹캠에서 포즈를 읽어 모델에 옮기고, 남길 신체 부위를 고릅니다.",
    tip: "웹캠은 권한에 동의한 뒤에만 켜집니다. 원하는 포즈가 잡히면 고정해 두세요.",
  },
  {
    title: "표면 드로잉",
    body: "B 키나 도크의 표면 드로잉을 켜고 브러시로 모델 위에 직접 그립니다. 스포이드로 모델 색을 집어 쓰고 지우개로 정리합니다.",
    tip: "포즈를 먼저 잡고 그리면 확인이 편합니다. 그린 선은 포즈를 바꿔도 따라갑니다.",
  },
  {
    title: "투명 PNG·PSD 출력",
    body: "투명 배경을 켜고 '캔버스에 추가'로 현재 컷에 바로 넣거나 PNG·PSD로 내려받습니다. PSD는 피부·얼굴·눈·헤어·의상·음영·하이라이트·주선 레이어로 나뉩니다.",
    tip: "카메라 프리셋(정면·사선·상반신)을 컷 구도에 맞춘 뒤 출력하면 다시 자를 일이 줄어듭니다.",
  },
];

interface ShortcutRow {
  readonly keys: readonly string[];
  readonly action: string;
  readonly note: string;
}

const SHORTCUTS: readonly ShortcutRow[] = [
  { keys: ["1", "0"], action: "슬롯 이동", note: "슬롯 레일에 포커스가 있을 때, 앞에서부터 열 번째 슬롯까지" },
  { keys: ["⌘Z"], action: "되돌리기", note: "대화상자 안에서만 동작하고 페이지 실행 취소와 섞이지 않습니다" },
  { keys: ["⇧⌘Z"], action: "다시 실행", note: "" },
  { keys: ["T"], action: "턴테이블", note: "모델을 천천히 돌려 확인합니다. 모션 감소 설정에서는 자동으로 돌지 않습니다" },
  { keys: ["B"], action: "표면 드로잉", note: "켜기·끄기" },
  { keys: ["Esc"], action: "닫기", note: "서랍 → 시트 → 대화상자 순서로 하나씩 닫힙니다" },
];

interface CapabilityNote {
  readonly icon: ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean }>;
  readonly title: string;
  readonly body: string;
}

const CAPABILITY_NOTES: readonly CapabilityNote[] = [
  {
    icon: Box,
    title: "VRM 0.x · 1.0 모델",
    body: "내장 라이브러리에서 고르거나 내 VRM 파일을 올릴 수 있습니다. 두 규격의 모델을 읽습니다.",
  },
  {
    icon: ScanFace,
    title: "얼굴 프리셋은 모델에 따라",
    body: "눈·코·입·귀 프리셋은 모델에 해당 shape key 또는 적응형 얼굴 메시가 있을 때 적용됩니다. 없으면 카드에 이유를 표시하고 몰래 다른 값으로 바꾸지 않습니다.",
  },
  {
    icon: ShieldCheck,
    title: "AI 추천은 기기 안에서",
    body: "참고 이미지 추천은 MediaPipe 이미지 임베더를 브라우저에서 실행합니다. 이미지를 서버로 업로드하지 않습니다.",
  },
  {
    icon: Camera,
    title: "웹캠은 동의한 뒤에만",
    body: "웹캠 포즈 인식은 브라우저 권한에 동의한 뒤에만 켜지며 언제든 끌 수 있습니다.",
  },
  {
    icon: Layers,
    title: "PSD 표면 드로잉 레이어",
    body: "표면 드로잉 레이어는 드로잉 텍스처를 따로 뽑을 수 있을 때만 PSD에 들어갑니다. 빠지면 내보내기 결과에 이유가 함께 표시됩니다.",
  },
  {
    icon: Box,
    title: "저장은 이 기기에",
    body: "작업은 스튜디오 문서와 함께 SQLite/OPFS 로컬 저장소에 저장됩니다. 클라우드 백업을 뜻하지는 않습니다.",
  },
];

interface FaqItem {
  readonly question: string;
  readonly answer: string;
}

const FAQ: readonly FaqItem[] = [
  {
    question: "설치가 필요한가요?",
    answer:
      "아니요. 스튜디오는 브라우저에서 동작합니다. 최초 한 번 온라인으로 로드한 뒤에는 캐시된 앱 자산으로 제한적인 오프라인 사용이 가능하지만, 네트워크가 필요한 기능은 온라인에서만 동작합니다.",
  },
  {
    question: "내 VRM 모델을 쓸 수 있나요?",
    answer:
      "네. VRM 0.x와 1.0 파일을 올릴 수 있습니다. 눈·코·입·귀 같은 얼굴 프리셋은 모델에 shape key나 적응형 얼굴 메시가 있어야 적용되고, 없으면 카드에 이유가 표시됩니다.",
  },
  {
    question: "참고 이미지와 웹캠 영상은 어디로 가나요?",
    answer:
      "기기 밖으로 나가지 않습니다. AI 추천은 MediaPipe 이미지 임베더를 브라우저에서 실행하고, 사진·웹캠 포즈 인식도 기기 안에서 처리합니다. 웹캠은 권한에 동의한 뒤에만 켜집니다.",
  },
  {
    question: "결과물은 어떤 형식으로 나오나요?",
    answer:
      "투명 배경 PNG로 현재 컷에 바로 넣거나 내려받을 수 있습니다. PSD는 밑색(피부·얼굴·눈·헤어·상의·하의·신발·액세서리)·음영·하이라이트·주선 레이어로 나뉘어 나옵니다.",
  },
];

const HERO_FACTS = [
  "설치 없음 · 브라우저에서 실행",
  "VRM 0.x · 1.0",
  "AI 추천·포즈 인식은 기기 내 처리",
  "투명 PNG · 레이어 PSD",
] as const;

const SHAPER_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  name: `${SHAPER_TITLE} · 툰스펙트럼`,
  url: `${SITE_URL}${SHAPER_PATH}`,
  description: SHAPER_DESCRIPTION,
  inLanguage: "ko",
  isPartOf: { "@type": "WebSite", name: "툰스펙트럼", url: SITE_URL },
  mainEntity: {
    "@type": "SoftwareApplication",
    name: SHAPER_TITLE,
    applicationCategory: "DesignApplication",
    operatingSystem: "Web",
    browserRequirements: "WebGL을 지원하는 최신 브라우저",
    url: `${SITE_URL}${STUDIO_SHAPER_PATH}`,
  },
};

const HERO_GLOW_STYLE = {
  background: "linear-gradient(to bottom, oklch(0.72 0.185 42 / 0.12), oklch(0.155 0.008 70 / 0))",
} as const;

const HERO_BLOOM_STYLE = {
  background:
    "radial-gradient(closest-side, oklch(0.66 0.2 38 / 0.14), oklch(0.62 0.16 60 / 0.05) 58%, transparent 72%)",
} as const;

function StepNumber({ value }: { value: number }) {
  return (
    <span aria-hidden className="numeral text-2xl leading-none text-accent sm:text-3xl">
      {String(value).padStart(2, "0")}
    </span>
  );
}

export function CharacterShaperLandingPage() {
  useDocumentTitle(SHAPER_TITLE);
  useMetaDescription(SHAPER_DESCRIPTION);
  usePageSocialMeta({
    canonicalPath: SHAPER_PATH,
    title: `${SHAPER_TITLE} · 툰스펙트럼`,
    description: SHAPER_DESCRIPTION,
  });
  useJsonLd(SHAPER_JSON_LD);

  return (
    <div>
      {/* 히어로 */}
      <section className="relative overflow-hidden border-b border-line bg-ledger">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-56 opacity-70" style={HERO_GLOW_STYLE} />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 top-6 size-[30rem] rounded-full opacity-60 blur-3xl"
          style={HERO_BLOOM_STYLE}
        />
        <Container
          size="wide"
          className="relative grid gap-8 py-10 sm:py-14 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-center lg:gap-12 lg:py-20"
        >
          <div className="max-w-2xl">
            <p className="eyebrow text-accent">CHARACTER SHAPER</p>
            <h1 className="mt-3 text-balance [word-break:keep-all] text-[clamp(1.9rem,5vw,3rem)] font-bold leading-[1.12] tracking-tight text-fg">
              프리셋으로 시작하는 3D 웹툰 캐릭터
            </h1>
            <p className="lede mt-4 max-w-xl text-pretty text-base leading-relaxed text-fg-2 sm:text-lg">
              프리셋으로 캐릭터를 고르고, 사진·웹캠으로 포즈를 잡고, 모델 위에 직접 그린 뒤 투명 PNG·레이어
              PSD로 내보내기까지 — 설치 없이 브라우저 안에서 끝납니다.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link href={STUDIO_SHAPER_PATH} className={buttonClass({ variant: "solid", size: "lg" })}>
                스튜디오에서 열기
                <ArrowRight size={18} aria-hidden="true" />
              </Link>
              <a href="#how-to" className={buttonClass({ variant: "outline", size: "lg" })}>
                사용 가이드
              </a>
            </div>
            <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-xs text-fg-3">
              {HERO_FACTS.map((fact) => (
                <li key={fact} className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="size-1.5 rounded-full bg-accent/80" />
                  {fact}
                </li>
              ))}
            </ul>
          </div>
          <div className="mx-auto w-full max-w-[24rem] lg:max-w-none">
            <ShaperHeroArt className="h-auto w-full" />
          </div>
        </Container>
      </section>

      {/* 핵심 기능 */}
      <Container size="wide" className="py-12 sm:py-16">
        <Section eyebrow="FEATURES" title="핵심 기능" desc="고르고, 그리고, 옮기고, 내보내는 데 필요한 네 가지.">
          <div className="grid gap-4 md:grid-cols-2">
            {FEATURES.map((feature, index) => {
              const Art = feature.art;
              return (
                <RevealOnScroll
                  key={feature.id}
                  delayMs={index * 60}
                  className="flex flex-col rounded-2xl border border-line bg-card/40 p-5 sm:p-6"
                >
                  <div className="rounded-xl border border-line/70 bg-canvas/60 p-3">
                    <Art className="h-auto w-full" />
                  </div>
                  <div className="mt-4 flex items-baseline gap-2.5">
                    <span className="numeral text-sm text-accent">{feature.numeral}</span>
                    <h3 className="text-lg font-bold text-fg">{feature.title}</h3>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-fg-2">{feature.body}</p>
                  <ul className="mt-3 flex flex-wrap gap-1.5">
                    {feature.chips.map((chip) => (
                      <li
                        key={chip}
                        className="rounded-full border border-line bg-raised/60 px-2 py-0.5 text-[0.7rem] text-fg-2"
                      >
                        {chip}
                      </li>
                    ))}
                  </ul>
                </RevealOnScroll>
              );
            })}
          </div>
        </Section>
      </Container>

      {/* HOW TO */}
      <section id="how-to" className="scroll-mt-24 border-y border-line bg-panel/30">
        <Container size="wide" className="py-12 sm:py-16">
          <Section
            eyebrow="HOW TO"
            title="다섯 단계로 첫 캐릭터 만들기"
            desc="위에서 아래로 한 번만 따라가면 컷에 넣을 수 있는 캐릭터가 나옵니다."
          >
            <ol className="flex flex-col gap-3.5">
              {HOW_TO_STEPS.map((step, index) => (
                <RevealOnScroll
                  key={step.title}
                  as="li"
                  delayMs={index * 50}
                  className="flex gap-4 rounded-2xl border border-line bg-card/40 p-5 sm:gap-6 sm:p-6"
                >
                  <StepNumber value={index + 1} />
                  <div className="min-w-0 flex-1">
                    <h3 className="text-base font-bold text-fg sm:text-lg">{step.title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-fg-2">{step.body}</p>
                    <p className="mt-3 flex gap-2 rounded-lg border border-accent/20 bg-accent-soft px-3 py-2 text-[0.8rem] leading-relaxed text-fg-2">
                      <span className="shrink-0 font-semibold text-accent">팁</span>
                      <span>{step.tip}</span>
                    </p>
                  </div>
                </RevealOnScroll>
              ))}
            </ol>
          </Section>
        </Container>
      </section>

      {/* 단축키 */}
      <Container size="wide" className="py-12 sm:py-16">
        <Section eyebrow="SHORTCUTS" title="단축키" desc="마우스 없이도 슬롯을 오가고 되돌릴 수 있습니다. ⌘ 표기는 macOS 기준입니다.">
          <div className="overflow-x-auto rounded-2xl border border-line">
            <table className="w-full min-w-[34rem] text-sm">
              <thead className="bg-card/50 text-left text-xs font-semibold text-fg-3">
                <tr>
                  <th scope="col" className="px-4 py-2.5">키</th>
                  <th scope="col" className="px-4 py-2.5">동작</th>
                  <th scope="col" className="px-4 py-2.5">비고</th>
                </tr>
              </thead>
              <tbody>
                {SHORTCUTS.map((row, index) => (
                  <tr key={row.action} className={index % 2 ? "bg-card/20" : "bg-transparent"}>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <span className="inline-flex items-center gap-1.5">
                        {row.keys.map((key, keyIndex) => (
                          <span key={key} className="inline-flex items-center gap-1.5">
                            {keyIndex > 0 && <span className="text-fg-3">–</span>}
                            <kbd className="inline-flex min-w-7 items-center justify-center rounded-md border border-line bg-card px-1.5 py-0.5 font-display text-[0.72rem] text-fg">
                              {key}
                            </kbd>
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 font-medium text-fg">{row.action}</td>
                    <td className="px-4 py-2.5 text-fg-3 [word-break:keep-all]">{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </Container>

      {/* 지원 범위와 한계 */}
      <section className="border-y border-line bg-panel/30">
        <Container size="wide" className="py-12 sm:py-16">
          <Section eyebrow="SCOPE" title="지원 범위와 한계" desc="되는 것과 모델에 따라 달라지는 것을 미리 적어 둡니다.">
            <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {CAPABILITY_NOTES.map((note) => {
                const Icon = note.icon;
                return (
                  <li key={note.title} className="rounded-2xl border border-line bg-card/30 p-4 sm:p-5">
                    <h3 className="flex items-center gap-2 text-sm font-bold text-fg">
                      <Icon size={16} className="shrink-0 text-accent" aria-hidden />
                      {note.title}
                    </h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-fg-2">{note.body}</p>
                  </li>
                );
              })}
            </ul>
          </Section>
        </Container>
      </section>

      {/* FAQ */}
      <Container size="wide" className="py-12 sm:py-16">
        <Section eyebrow="FAQ" title="자주 묻는 질문">
          <div className="grid gap-2.5 md:grid-cols-2">
            {FAQ.map((item) => (
              <details
                key={item.question}
                className="group rounded-xl border border-line bg-card/40 open:border-line-strong open:bg-card/70"
              >
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm font-semibold text-fg [&::-webkit-details-marker]:hidden">
                  {item.question}
                  <ChevronDown
                    size={16}
                    aria-hidden="true"
                    className="shrink-0 text-fg-3 transition-transform duration-200 ease-out-expo group-open:rotate-180"
                  />
                </summary>
                <p className="border-t border-line/70 px-4 pb-4 pt-3 text-sm leading-relaxed text-fg-2">{item.answer}</p>
              </details>
            ))}
          </div>
        </Section>
      </Container>

      {/* 마무리 CTA */}
      <Container size="wide" className="pb-16 sm:pb-20">
        <div className="relative overflow-hidden rounded-3xl border border-line bg-panel/50 px-6 py-10 text-center sm:px-10 sm:py-14">
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-40 opacity-80" style={HERO_GLOW_STYLE} />
          <div className="relative">
            <p className="eyebrow text-accent">START</p>
            <h2 className="mt-2 text-balance [word-break:keep-all] text-2xl font-bold tracking-tight text-fg sm:text-3xl">
              지금 첫 캐릭터를 만들어 보세요
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-fg-2 sm:text-base">
              내장 샘플 모델로 시작하면 파일을 따로 준비하지 않아도 됩니다. 만든 캐릭터는 투명 PNG로 바로 컷에
              들어갑니다.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link href={STUDIO_SHAPER_PATH} className={buttonClass({ variant: "solid", size: "lg" })}>
                스튜디오에서 열기
                <ArrowRight size={18} aria-hidden="true" />
              </Link>
              <Link href="/market/browse?kind=3d-asset" className={buttonClass({ variant: "outline", size: "lg" })}>
                3D 소재 둘러보기
              </Link>
            </div>
          </div>
        </div>
      </Container>
    </div>
  );
}
