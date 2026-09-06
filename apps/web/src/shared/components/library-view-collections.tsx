import { Plus, Trash2, Pencil, Check, FolderHeart } from "lucide-react";
import { useState } from "react";

import { EmptyTeach } from "./library-view-empty";
import { MiniPoster } from "./rank-row";
import { CollectionIcon } from "./visual-marks";
import { COLLECTION_ICON_OPTIONS } from "./visual-marks-utils";

import type { Title } from "@/shared/lib/types";

import { MAX_COLLECTION_NAME_LENGTH } from "@/shared/lib/collection-contract";
import { useApp } from "@/shared/lib/store";
import { cn } from "@/shared/lib/utils";
import Link from "@/src/compat/router-link";

export function CollectionsTab({
  collections,
  titlesById,
  onCreate,
  onRename,
  onDelete,
}: {
  collections: ReturnType<typeof useApp.getState>["collections"];
  titlesById: Record<string, Title>;
  onCreate: (name: string, emoji: string) => string;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState(COLLECTION_ICON_OPTIONS[0].value);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const commitRename = () => {
    if (editingId && editName.trim()) onRename(editingId, editName);
    setEditingId(null);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-card p-3">
        <div className="flex gap-1">
          {COLLECTION_ICON_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => setEmoji(option.value)}
              title={option.label}
              aria-label={`${option.label} 아이콘`}
              className={cn(
                "grid size-10 place-items-center rounded-xl transition-colors",
                emoji === option.value ? "bg-accent-soft ring-1 ring-accent/45" : "hover:bg-raised"
              )}
            >
              <CollectionIcon value={option.value} active={emoji === option.value} />
            </button>
          ))}
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="새 컬렉션 이름"
          placeholder="새 컬렉션 이름"
          maxLength={MAX_COLLECTION_NAME_LENGTH}
          className="h-10 min-w-40 flex-1 rounded-lg border border-line bg-canvas px-3 text-sm outline-none focus:border-accent/50"
        />
        <button
          onClick={() => {
            if (name.trim()) {
              onCreate(name.trim(), emoji);
              setName("");
            }
          }}
          className="flex h-10 items-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-medium text-on-accent disabled:opacity-50"
          disabled={!name.trim()}
        >
          <Plus size={16} /> 만들기
        </button>
      </div>

      {collections.length === 0 ? (
        <EmptyTeach
          icon={FolderHeart}
          title="컬렉션이 없어요"
          desc="나만의 테마로 작품을 묶어보세요. 작품 상세에서 컬렉션에 담을 수 있어요."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {collections.map((c) => {
            const titles = c.titleIds.map((id) => titlesById[id]).filter(Boolean).slice(0, 5);
            return (
              <div key={c.id} className="rounded-2xl border border-line bg-card p-5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <CollectionIcon value={c.emoji} size="lg" />
                    <div className="min-w-0">
                      {editingId === c.id ? (
                        <input
                          // 이름 변경(rename) 모드 진입이라는 명시적 사용자 액션으로만 마운트되는
                          // 인라인 편집 입력이라 열릴 때 포커스 이동이 적절하다(페이지 로드 시 포커스 탈취 아님).
                          // eslint-disable-next-line jsx-a11y/no-autofocus
                          autoFocus
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onBlur={commitRename}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitRename();
                            else if (e.key === "Escape") setEditingId(null);
                          }}
                          aria-label="컬렉션 이름 변경"
                          maxLength={MAX_COLLECTION_NAME_LENGTH}
                          className="h-7 w-full rounded-md border border-accent/50 bg-canvas px-2 text-sm font-semibold text-fg outline-none"
                        />
                      ) : (
                        <p className="truncate font-semibold text-fg">{c.name}</p>
                      )}
                      <p className="text-xs text-fg-3">{c.titleIds.length}편</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {editingId === c.id ? (
                      <button onClick={commitRename} aria-label="이름 저장" className="text-fg-3 transition-colors hover:text-good">
                        <Check size={15} />
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          setEditingId(c.id);
                          setEditName(c.name);
                        }}
                        aria-label="이름 변경"
                        title="이름 변경"
                        className="text-fg-3 transition-colors hover:text-fg"
                      >
                        <Pencil size={14} />
                      </button>
                    )}
                    <button onClick={() => onDelete(c.id)} aria-label="컬렉션 삭제" title="삭제" className="text-fg-3 transition-colors hover:text-bad">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
                {titles.length > 0 ? (
                  <div className="mt-4 flex gap-2">
                    {titles.map((t) => (
                      <Link key={t!.id} href={`/title/${t!.slug}`} className="w-12">
                        <MiniPoster title={t!} className="w-full" />
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p className="mt-4 text-xs text-fg-3">
                    아직 비어 있어요. 작품 상세에서 {`'`}컬렉션에 담기{`'`}를 눌러보세요.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
