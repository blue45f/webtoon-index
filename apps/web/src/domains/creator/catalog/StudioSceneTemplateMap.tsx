import type { StudioSceneTemplateSummary } from "./studio-scene-template-summary";

/** Intentionally schematic: reads the native seed bounds, does not claim final font/effect parity. */
export function StudioSceneTemplateMap({ summary, label }: { summary: StudioSceneTemplateSummary; label: string }) {
  return <svg role="img" aria-label={`${label} 구성도. 실제 작화 렌더가 아닙니다.`} viewBox={`0 0 ${summary.width} ${summary.height}`}
    className="h-full max-h-full w-full object-contain" preserveAspectRatio="xMidYMid meet" data-studio-scene-map="true">
    {summary.seeds.map((seed, index) => {
      if (seed.type === "frame") return <rect key={index} x={seed.x} y={seed.y} width={seed.width} height={seed.height}
        fill={seed.bgColor ?? "#ffffff"} stroke={seed.stroke ?? "#282828"} strokeWidth={Math.max(2, seed.strokeWidth ?? 2)} />;
      if (seed.type === "bubble") return <g key={index}>
        <rect x={seed.x} y={seed.y} width={seed.width} height={seed.height} rx={seed.variant === "box" || seed.variant === "system" ? 5 : 28}
          fill={seed.fill} stroke={seed.textFill} strokeWidth={2} />
        <text x={seed.x + 14} y={seed.y + seed.height / 2 + 6} fill={seed.textFill} fontSize={18} fontFamily="sans-serif">{seed.text.slice(0, 16)}{seed.text.length > 16 ? "…" : ""}</text>
      </g>;
      if (seed.type === "text") return <text key={index} x={seed.x + 8} y={seed.y + seed.fontSize} fill={seed.fill} fontFamily="sans-serif"
        fontSize={Math.min(seed.fontSize, 54)} fontWeight="bold">{seed.text.slice(0, 18)}{seed.text.length > 18 ? "…" : ""}</text>;
      return <g key={index} opacity={0.32}>
        <rect x={seed.x} y={seed.y} width={seed.width} height={seed.height} fill="none" stroke={seed.stroke} strokeWidth={3} strokeDasharray="8 8" />
        <text x={seed.x + 12} y={seed.y + 28} fill={seed.stroke} fontSize={18}>{seed.type === "focusLines" ? "집중선 영역" : "속도선 영역"}</text>
      </g>;
    })}
  </svg>;
}
