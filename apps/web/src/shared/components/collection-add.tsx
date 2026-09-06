import { FolderHeart, Check, Plus } from "lucide-react";
import { useState } from "react";

import { CollectionIcon } from "./visual-marks";
import { COLLECTION_ICON_OPTIONS } from "./visual-marks-utils";

import { MAX_COLLECTION_NAME_LENGTH } from "@/shared/lib/collection-contract";
import { useApp, useHydrated } from "@/shared/lib/store";
import { cn } from "@/shared/lib/utils";

const DEFAULT_COLLECTION_ICON = COLLECTION_ICON_OPTIONS[0].value;

export function CollectionAdd({ titleId }: { titleId: string }) {
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const collections = useApp((s) => s.collections);
  const toggle = useApp((s) => s.toggleInCollection);
  const create = useApp((s) => s.createCollection);

  const inCount = hydrated
    ? collections.filter((c) => c.titleIds.includes(titleId)).length
    : 0;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex w-full items-center justify-center gap-2 rounded-xl border py-2.5 text-sm font-medium transition-colors",
          inCount > 0
            ? "border-accent/40 bg-accent-soft text-accent"
            : "border-line bg-card text-fg-2 hover:border-line-strong hover:text-fg"
        )}
      >
        <FolderHeart size={16} />
        컬렉션에 담기{inCount > 0 ? ` (${inCount})` : ""}
      </button>

      {open && (
        <>
          <button className="fixed inset-0 z-10" aria-label="닫기" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-full z-20 mt-2 rounded-xl border border-line-strong bg-panel p-2 shadow-xl shadow-[oklch(0.1_0.02_70/0.42)]">
            <div className="max-h-52 overflow-y-auto">
              {collections.map((c) => {
                const has = c.titleIds.includes(titleId);
                return (
                  <button
                    key={c.id}
                    onClick={() => toggle(c.id, titleId)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors hover:bg-raised"
                  >
                    <CollectionIcon value={c.emoji} size="sm" />
                    <span className="flex-1 truncate text-left text-fg-2">{c.name}</span>
                    {has && <Check size={15} className="text-accent" />}
                  </button>
                );
              })}
            </div>
            <div className="mt-1 flex items-center gap-1.5 border-t border-line pt-2">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                aria-label="새 컬렉션 이름"
                placeholder="새 컬렉션"
                maxLength={MAX_COLLECTION_NAME_LENGTH}
                className="h-8 flex-1 rounded-lg border border-line bg-canvas px-2.5 text-sm outline-none focus:border-accent/50"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newName.trim()) {
                    const id = create(newName.trim(), DEFAULT_COLLECTION_ICON);
                    toggle(id, titleId);
                    setNewName("");
                  }
                }}
              />
              <button
                onClick={() => {
                  if (newName.trim()) {
                    const id = create(newName.trim(), DEFAULT_COLLECTION_ICON);
                    toggle(id, titleId);
                    setNewName("");
                  }
                }}
                className="grid size-8 place-items-center rounded-lg bg-accent text-on-accent disabled:opacity-50"
                disabled={!newName.trim()}
              >
                <Plus size={16} />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
