import { cx } from "@/shared/lib/cx";

// 페이지 컨테이너. Section과 분리해 첫 화면 skeleton/error 경로가 섹션 UI 청크를 끌고 오지 않게 한다.
export function Container({
  children,
  className,
  size = "default",
  style,
}: {
  children: React.ReactNode;
  className?: string;
  size?: "default" | "wide" | "prose";
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={style}
      className={cx(
        "mx-auto w-full px-4 sm:px-6",
        size === "wide" && "max-w-[1320px]",
        size === "default" && "max-w-[1180px]",
        size === "prose" && "max-w-3xl",
        className
      )}
    >
      {children}
    </div>
  );
}
