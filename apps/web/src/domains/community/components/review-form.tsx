import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Trash2, AlertTriangle } from "lucide-react";
import { useRef, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod";

import { RatingInput, ScaleSwitcher } from "@/shared/components/rating-input";
import { Button } from "@/shared/components/ui/button";
import { useApp, useHydrated } from "@/shared/lib/store";
import { cn } from "@/shared/lib/utils";
import { useCelebrate } from "@/src/hooks/use-celebrate";


const SUGGESTED = [
  "몰입감",
  "그림체甲",
  "사이다",
  "정주행각",
  "강추",
  "킬링타임",
  "후반부아쉬움",
  "호불호",
  "캐릭터매력",
  "스토리탄탄",
];

const reviewSchema = z.object({
  rating: z.number().min(0.5, "별점을 매겨주세요."),
  text: z.string().max(500),
  tags: z.array(z.string()).max(5),
  spoiler: z.boolean(),
});

type ReviewFormValues = z.infer<typeof reviewSchema>;

const toValues = (review: { rating: number; text: string; tags: string[]; spoiler: boolean } | undefined): ReviewFormValues => ({
  rating: review?.rating ?? 0,
  text: review?.text ?? "",
  tags: review?.tags ?? [],
  spoiler: review?.spoiler ?? false,
});

export function ReviewForm({ titleId }: { titleId: string }) {
  const hydrated = useHydrated();
  const existing = useApp((s) => s.reviews[titleId]);
  const upsert = useApp((s) => s.upsertReview);
  const remove = useApp((s) => s.deleteReview);
  const loggedIn = useApp((s) => Boolean(s.userId));

  const [saved, setSaved] = useState(false);

  const {
    control,
    register,
    handleSubmit,
    reset,
    watch,
    formState: { isSubmitting },
  } = useForm<ReviewFormValues>({
    resolver: zodResolver(reviewSchema),
    defaultValues: toValues(existing),
  });

  const rating = watch("rating");

  // 하이드레이션 후 기존 리뷰 동기화 (최초 1회)
  const [synced, setSynced] = useState(false);
  if (hydrated && !synced && existing) {
    reset(toValues(existing));
    setSynced(true);
  }

  const formRef = useRef<HTMLFormElement>(null);
  const celebrate = useCelebrate();

  const submit = handleSubmit((values) => {
    const isNew = !existing;
    upsert({
      titleId,
      rating: values.rating,
      text: values.text.trim(),
      tags: values.tags,
      spoiler: values.spoiler,
      createdAt: new Date().toISOString(),
    });
    // 저장 성공 축하 — 신규 등록은 크게, 수정 저장은 절제해서(파티클 + success 효과음 + 햅틱).
    celebrate(formRef.current, {
      chars: ["⭐", "✨", "💬"],
      count: isNew ? 18 : 10,
      spread: isNew ? 1.05 : 0.8,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  });

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      className="flex flex-col gap-5 rounded-2xl border border-line bg-card p-5 surface-hl"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold text-fg">
          {existing ? "내 리뷰 수정" : "이 작품 평가하기"}
        </h3>
        <ScaleSwitcher />
      </div>

      <Controller
        control={control}
        name="rating"
        render={({ field }) => <RatingInput value={field.value} onChange={field.onChange} />}
      />

      <label htmlFor="review-text" className="sr-only">
        리뷰 내용
      </label>
      <textarea
        id="review-text"
        {...register("text")}
        rows={3}
        maxLength={500}
        placeholder="이 작품, 한 줄로 어땠나요? 스포일러는 아래 토글을 켜주세요."
        className="w-full resize-none rounded-xl border border-line bg-canvas px-3.5 py-3 text-sm leading-relaxed text-fg outline-none transition-colors placeholder:text-fg-3 focus:border-accent/60"
      />

      <Controller
        control={control}
        name="tags"
        render={({ field }) => {
          const toggleTag = (t: string) =>
            field.onChange(
              field.value.includes(t) ? field.value.filter((x) => x !== t) : [...field.value, t].slice(0, 5)
            );
          return (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="태그 선택">
              {SUGGESTED.map((t) => {
                const on = field.value.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleTag(t)}
                    aria-pressed={on}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                      on
                        ? "border-accent/60 bg-accent-soft text-accent"
                        : "border-line bg-raised/50 text-fg-3 hover:text-fg"
                    )}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          );
        }}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Controller
          control={control}
          name="spoiler"
          render={({ field }) => (
            <button
              type="button"
              onClick={() => field.onChange(!field.value)}
              aria-pressed={field.value}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                field.value ? "border-warn/50 bg-[oklch(0.82_0.15_80/0.12)] text-warn" : "border-line text-fg-3 hover:text-fg-2"
              )}
            >
              <AlertTriangle size={14} />
              스포일러 포함 {field.value ? "ON" : "OFF"}
            </button>
          )}
        />

        <div className="flex items-center gap-2">
          {existing && (
            <Button type="button" variant="quiet" size="sm" onClick={() => remove(titleId)}>
              <Trash2 size={15} /> 삭제
            </Button>
          )}
          <Button type="submit" size="sm" disabled={rating === 0 || isSubmitting}>
            {saved ? (
              <>
                <Check size={15} /> 저장됨
              </>
            ) : existing ? (
              "수정 저장"
            ) : (
              "리뷰 등록"
            )}
          </Button>
        </div>
      </div>
      <p className="text-[0.7rem] text-fg-3">
        {loggedIn
          ? "평가는 계정에 저장되어 어느 기기에서나 이어집니다."
          : "평가는 이 브라우저에만 저장됩니다 (localStorage). 로그인하면 계정에 동기화돼요."}{" "}
        별점은 {`'`}내 서재{`'`}의 취향 분석에 반영돼요.
      </p>
    </form>
  );
}
