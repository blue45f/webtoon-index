import { useUi } from "@/shared/lib/ui-store";

export function OpenSearchButton({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const openCommandPalette = useUi((s) => s.openCommandPalette);
  return (
    <button type="button" className={className} onClick={openCommandPalette}>
      {children}
    </button>
  );
}
