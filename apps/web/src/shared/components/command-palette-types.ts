import type { Title } from "@/shared/lib/types";
import type { LucideIcon } from "lucide-react";

export type PaletteMode = "all" | "titles" | "commands" | "studio" | "pages" | "shortcuts";

export interface CommandContext {
  router: { push: (href: string) => void };
  closePalette: () => void;
  showToast: (msg: string, opts?: { tone?: "default" | "success" | "info" }) => void;
  playSfx: (name: "tick" | "pop" | "success" | "error" | "open" | "close") => void;
  currentPath: string;
}

export interface PaletteCommand {
  id: string;
  title: string;
  subtitle: string;
  category: "audio" | "system" | "navigation" | "studio" | "history";
  icon: LucideIcon;
  shortcut?: string[];
  keywords: string[];
  description?: string;
  badge?: string;
  action: (ctx: CommandContext) => void | Promise<void>;
  getState?: () => { active: boolean; label: string };
}

export interface PaletteStudioTool {
  id: string;
  name: string;
  shortcutKey: string;
  category: "draw" | "edit" | "canvas" | "panel";
  icon: LucideIcon;
  tip: string;
  keywords: string[];
  actionPath?: string;
}

export interface PalettePage {
  id: string;
  href: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  category: "main" | "discover" | "creator" | "community";
  shortcut?: string[];
  keywords: string[];
}

export type PaletteSelectedItem =
  | { type: "title"; title: Title }
  | { type: "command"; command: PaletteCommand }
  | { type: "studio-tool"; tool: PaletteStudioTool }
  | { type: "page"; page: PalettePage }
  | { type: "recent-query"; query: string }
  | null;
