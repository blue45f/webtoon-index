import { lazy, Suspense, useEffect } from "react";

import { useUi } from "@/shared/lib/ui-store";

const CommandPalette = lazy(() => import("./command-palette").then((mod) => ({ default: mod.CommandPalette })));

export function CommandPaletteHost() {
  const open = useUi((s) => s.commandPaletteOpen);
  const toggle = useUi((s) => s.toggleCommandPalette);
  const setOpen = useUi((s) => s.setCommandPaletteOpen);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 1. Cmd+K / Ctrl+K: Global palette toggle
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggle();
        return;
      }

      // 2. '/' shortcut outside of editable fields and studio canvas
      if (
        e.key === "/" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        typeof window !== "undefined" &&
        !window.location.pathname.startsWith("/studio")
      ) {
        const target = e.target as HTMLElement | null;
        const tagName = target?.tagName;
        const isEditable =
          Boolean(target?.isContentEditable) ||
          tagName === "INPUT" ||
          tagName === "TEXTAREA" ||
          tagName === "SELECT";

        if (!isEditable) {
          e.preventDefault();
          setOpen(true);
        }
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [toggle, setOpen]);

  if (!open) return null;

  return (
    <Suspense fallback={null}>
      <CommandPalette open={open} onOpenChange={setOpen} />
    </Suspense>
  );
}
