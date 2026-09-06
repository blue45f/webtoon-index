// 접근성 셀렉트 — Radix 헤드리스 위에 기존 OKLCH 토큰으로만 스타일링한 공용 래퍼.
// 네이티브 <select> 를 대체해 키보드 타입어헤드·리스트박스 ARIA·테마 가능한 드롭다운을 제공한다.
// 시각 언어는 그대로(라인/카드/persimmon 악센트) — 새 디자인 시스템을 도입하지 않는다.
import * as RadixSelect from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

import type { ReactNode } from "react";

import { cn } from "@/shared/lib/utils";

export interface SelectOption<T extends string> {
  value: T;
  label: ReactNode;
  /** 옵션 행에 곁들일 장식(예: 플랫폼 색 점) */
  adornment?: ReactNode;
  /** 타입어헤드/접근성 텍스트(label 이 노드일 때) */
  textValue?: string;
}

export function Select<T extends string>({
  value,
  onValueChange,
  options,
  ariaLabel,
  placeholder,
  triggerClassName,
  contentClassName,
  /** 닫힌 트리거에 곁들일 장식(선택값의 색 점 등) */
  triggerAdornment,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: SelectOption<T>[];
  ariaLabel?: string;
  placeholder?: string;
  triggerClassName?: string;
  contentClassName?: string;
  triggerAdornment?: ReactNode;
}) {
  return (
    <RadixSelect.Root value={value} onValueChange={(v) => onValueChange(v as T)}>
      <RadixSelect.Trigger
        aria-label={ariaLabel}
        className={cn(
          "inline-flex items-center justify-between gap-1.5 outline-none transition-colors",
          "data-[placeholder]:text-fg-3 focus-visible:border-accent/60 data-[state=open]:border-accent/50",
          triggerClassName
        )}
      >
        <span className="inline-flex min-w-0 items-center gap-1.5">
          {triggerAdornment}
          <RadixSelect.Value placeholder={placeholder} />
        </span>
        <RadixSelect.Icon className="shrink-0 text-fg-3">
          <ChevronDown size={14} />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>

      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={6}
          className={cn(
            "z-50 max-h-[min(20rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)]",
            "overflow-hidden rounded-xl border border-line bg-panel p-1 shadow-[0_18px_40px_-18px_oklch(0.12_0.01_70/0.8)] surface-hl",
            "data-[state=open]:animate-[fade-up_0.16s_var(--ease-out-expo)_both]",
            contentClassName
          )}
        >
          <RadixSelect.ScrollUpButton className="flex h-5 items-center justify-center text-fg-3">
            <ChevronUp size={14} />
          </RadixSelect.ScrollUpButton>

          <RadixSelect.Viewport className="p-0.5">
            {options.map((option) => (
              <RadixSelect.Item
                key={option.value}
                value={option.value}
                textValue={option.textValue}
                className={cn(
                  "relative flex cursor-pointer select-none items-center gap-2 rounded-lg py-1.5 pl-2.5 pr-8 text-sm text-fg-2 outline-none",
                  "transition-colors data-[highlighted]:bg-raised data-[highlighted]:text-fg",
                  "data-[state=checked]:bg-accent-soft data-[state=checked]:text-accent data-[state=checked]:font-medium",
                  "data-[disabled]:pointer-events-none data-[disabled]:opacity-45"
                )}
              >
                {option.adornment}
                <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                <RadixSelect.ItemIndicator className="absolute right-2.5 inline-flex items-center text-accent">
                  <Check size={14} strokeWidth={2.5} />
                </RadixSelect.ItemIndicator>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>

          <RadixSelect.ScrollDownButton className="flex h-5 items-center justify-center text-fg-3">
            <ChevronDown size={14} />
          </RadixSelect.ScrollDownButton>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
