import { Container } from "@/shared/components/section";
import { useT } from "@/shared/lib/i18n";
import Link from "@/src/compat/router-link";

// 저작권·콘텐츠 안내(/copyright).
export function CopyrightPage() {
  const t = useT();
  return (
    <Container size="prose" className="py-8 sm:py-12 lg:py-16">
      <p className="eyebrow text-accent">COPYRIGHT</p>
      <h1 className="mt-3 text-pretty text-[clamp(1.6rem,7vw,1.875rem)] font-bold leading-tight sm:text-4xl">
        {t("copyright.title")}
      </h1>

      <div className="mt-8 space-y-7 text-sm leading-relaxed text-fg-2">
        <section>
          <h2 className="mb-2 text-base font-bold text-fg">{t("copyright.section1.title")}</h2>
          <p>{t("copyright.section1.body")}</p>
        </section>
        <section>
          <h2 className="mb-2 text-base font-bold text-fg">{t("copyright.section2.title")}</h2>
          <p>{t("copyright.section2.body")}</p>
        </section>
        <section>
          <h2 className="mb-2 text-base font-bold text-fg">{t("copyright.section3.title")}</h2>
          <p>
            네이버 웹툰의 별점은 실수집값이며, 조회·관심수는 공개 집계가 비공개로 전환되어 추정값(≈)으로
            표기합니다. 그 외 플랫폼의 평점·조회·완독률 등 일부 지표도 추정값(≈)으로 표기하며, 추정은
            명확히 구분 표시합니다.
          </p>
        </section>
        <section>
          <h2 className="mb-2 text-base font-bold text-fg">{t("copyright.section4.title")}</h2>
          <p>
            각 작품의 메타데이터·표지에 대한 권리는 해당 플랫폼 및 권리자에게 있습니다. 서비스는 이를
            정보 제공·인용 목적으로 사용하며 출처(플랫폼) 링크를 함께 제공합니다.
          </p>
        </section>
        <section>
          <h2 className="mb-2 text-base font-bold text-fg">{t("copyright.section5.title")}</h2>
          <p>{t("copyright.section5.body")}</p>
          <p className="mt-2">
            <Link href="/support" className="text-accent underline underline-offset-2">
              {t("copyright.leaveInquiry")}
            </Link>
          </p>
        </section>
      </div>
    </Container>
  );
}
