import { useEffect, useState } from "react";

import { HEX_COLOR_PATTERN } from "./StudioVrmPoserTypes";

export function VrmColorControl({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (hex: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => setDraft(value), [value]);

  function handleDraftChange(next: string) {
    setDraft(next);
    if (HEX_COLOR_PATTERN.test(next)) onChange(next.toLowerCase());
  }

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <input
        type="color"
        value={HEX_COLOR_PATTERN.test(value) ? value : "#ffffff"}
        disabled={disabled}
        aria-label={`${label} 색상 선택`}
        onChange={(event) => onChange(event.target.value)}
        className="size-11 shrink-0 cursor-pointer rounded-lg border border-line bg-transparent p-0 disabled:cursor-not-allowed"
      />
      <input
        type="text"
        value={draft}
        disabled={disabled}
        aria-label={`${label} HEX 색상`}
        aria-invalid={!HEX_COLOR_PATTERN.test(draft)}
        autoCapitalize="none"
        autoCorrect="off"
        inputMode="text"
        maxLength={7}
        pattern="#[0-9a-fA-F]{6}"
        spellCheck={false}
        onChange={(event) => handleDraftChange(event.target.value)}
        onBlur={() => {
          if (!HEX_COLOR_PATTERN.test(draft)) setDraft(value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDraft(value);
            event.currentTarget.blur();
          }
        }}
        className="min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-card px-2 text-[0.68rem] text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45"
      />
    </div>
  );
}
