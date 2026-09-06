import {
  ArrowUpRight,
  Edit,
  Eye,
  EyeOff,
  PackagePlus,
  Palette,
  Plus,
  RefreshCw,
  Trash2,
  UserCheck,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { MarketEditResourceModal } from "../components/MarketEditResourceModal";
import { MarketNavHeader } from "../components/MarketNavHeader";
import {
  deleteCustomPublishedResource,
  getCustomPublishedResources,
  updateCustomPublishedResource,
  MARKET_CUSTOM_REGISTRY_EVENT,
} from "../models/market-custom-registry";
import {
  formatMarketByteSize,
  marketKindMeta,
  marketLicenseMeta,
} from "../models/market-kind";

import type { CreatorMarketplaceResourceRecord } from "@/shared/lib/creator-marketplace-resource-contract";

import { Container } from "@/shared/components/section";
import { buttonClass } from "@/shared/components/ui/button-utils";
import { cn } from "@/shared/lib/utils";
import { useSession } from "@/src/compat/auth-session-store";
import Link from "@/src/compat/router-link";
import {
  useDocumentTitle,
  useMetaDescription,
} from "@/src/hooks/use-document-title";
import {
  deleteCreatorMarketplaceResource,
  listCreatorMarketplaceOwnedHeads,
  relistCreatorMarketplaceResource,
} from "@/src/infrastructure/creator-marketplace-client";

export function MarketManagePage() {
  useDocumentTitle("내 등록 에셋 관리 · 창작 마켓");
  useMetaDescription(
    "내가 등록한 창작 마켓 리소스를 관리하고, 버전을 판올림하며, 공개 및 통계를 확인하세요.",
  );

  const session = useSession();
  const [items, setItems] = useState<CreatorMarketplaceResourceRecord[]>(() =>
    getCustomPublishedResources(),
  );
  const [loading, setLoading] = useState(false);
  const [selectedRecordForEdit, setSelectedRecordForEdit] =
    useState<CreatorMarketplaceResourceRecord | null>(null);

  const refreshItems = useCallback(async () => {
    const local = getCustomPublishedResources();
    setItems(local);

    // Also attempt remote owned heads sync if user session is active
    if (session.status === "authenticated") {
      try {
        setLoading(true);
        const remoteHeads = await listCreatorMarketplaceOwnedHeads({ limit: 48 });
        if (remoteHeads.items.length > 0) {
          const map = new Map<string, CreatorMarketplaceResourceRecord>();
          for (const item of local) map.set(item.id, item);
          for (const head of remoteHeads.items) map.set(head.resource.id, head.resource);
          setItems([...map.values()]);
        }
      } catch {
        // keep local
      } finally {
        setLoading(false);
      }
    }
  }, [session.status]);

  useEffect(() => {
    void refreshItems();
    window.addEventListener(MARKET_CUSTOM_REGISTRY_EVENT, refreshItems);
    return () => window.removeEventListener(MARKET_CUSTOM_REGISTRY_EVENT, refreshItems);
  }, [refreshItems]);

  const handleDelete = async (record: CreatorMarketplaceResourceRecord) => {
    if (!window.confirm(`'${record.name}' 에셋을 정말로 삭제하시겠습니까?`)) return;
    try {
      await deleteCreatorMarketplaceResource(record.id);
    } catch {
      // safe fallback
    }
    deleteCustomPublishedResource(record.id);
    setItems(getCustomPublishedResources());
  };

  const handleToggleListing = async (record: CreatorMarketplaceResourceRecord) => {
    const isCurrentlyDelisted = Boolean((record as { delisted?: boolean }).delisted);
    try {
      if (isCurrentlyDelisted) {
        await relistCreatorMarketplaceResource(record.id);
      } else {
        await deleteCreatorMarketplaceResource(record.id);
      }
    } catch {
      // safe fallback
    }

    updateCustomPublishedResource(record.id, {
      ...(record as object),
      delisted: !isCurrentlyDelisted,
    } as Partial<CreatorMarketplaceResourceRecord>);
    setItems(getCustomPublishedResources());
  };

  return (
    <Container size="wide" className="py-7 sm:py-10">
      <MarketNavHeader />

      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-6">
        <div>
          <div className="flex items-center gap-2">
            <UserCheck className="size-5 text-accent" />
            <h1 className="text-xl font-bold text-fg sm:text-2xl">내 등록 에셋 관리</h1>
            <span className="numeral tnum rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-bold text-accent">
              {items.length}개
            </span>
          </div>
          <p className="mt-1 text-xs text-fg-3">
            내가 배포한 에셋의 실시간 수정, 버전 릴리즈, 공개/비공개 전환 및 스튜디오 테스트
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refreshItems()}
            disabled={loading}
            className={buttonClass({ variant: "outline", size: "sm", className: "gap-1.5" })}
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            <span>새로고침</span>
          </button>
          <Link
            href="/market/publish"
            className={buttonClass({
              variant: "solid",
              size: "sm",
              className: "gap-1.5 bg-gradient-to-r from-accent to-accent-2 text-on-accent",
            })}
          >
            <Plus className="size-4" />
            <span>새 에셋 등록하기</span>
          </Link>
        </div>
      </div>

      {/* Assets List */}
      {items.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-line bg-panel/50 p-12 text-center space-y-3">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-raised text-fg-3">
            <PackagePlus className="size-6" />
          </div>
          <h2 className="text-sm font-bold text-fg">아직 등록한 에셋이 없어요</h2>
          <p className="mx-auto max-w-sm text-xs text-fg-3 leading-relaxed">
            스튜디오에서 작업한 브러시나 3D 모델, 연출 프리셋을 등록하고 다른 작가들과 공유해보세요.
          </p>
          <Link
            href="/market/publish"
            className={buttonClass({ variant: "solid", size: "md", className: "mt-2" })}
          >
            지금 첫 에셋 등록하기
          </Link>
        </div>
      ) : (
        <div className="mt-6 divide-y divide-line rounded-xl border border-line bg-card overflow-hidden">
          {items.map((record) => {
            const kind = marketKindMeta(record.kind);
            const license = marketLicenseMeta(record.license);
            const isDelisted = Boolean((record as { delisted?: boolean }).delisted);

            return (
              <div
                key={record.id}
                className="flex flex-col gap-4 p-4 transition-colors hover:bg-panel/30 sm:flex-row sm:items-center sm:justify-between"
              >
                {/* Left info */}
                <div className="flex items-start gap-3.5 min-w-0 flex-1">
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-raised text-accent font-bold">
                    <kind.icon className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-sm font-bold text-fg">
                        {record.name}
                      </h2>
                      <span className="rounded bg-accent/20 px-1.5 py-0.2 text-[0.62rem] font-bold text-accent">
                        v{record.resourceVersion}
                      </span>
                      {isDelisted ? (
                        <span className="rounded bg-warn/20 px-1.5 py-0.2 text-[0.62rem] font-bold text-warn">
                          비공개
                        </span>
                      ) : (
                        <span className="rounded bg-good/20 px-1.5 py-0.2 text-[0.62rem] font-bold text-good">
                          공개 중
                        </span>
                      )}
                    </div>

                    <p className="mt-1 line-clamp-1 text-xs text-fg-3">
                      {record.description || "설명 없음"}
                    </p>

                    <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[0.68rem] text-fg-3">
                      <span>종류: {kind.label}</span>
                      <span>라이선스: {license.label}</span>
                      <span>항목: {record.entries.length}개</span>
                      <span>manifest: {formatMarketByteSize(record.manifestByteSize)}</span>
                      <time dateTime={record.updatedAt}>
                        최근 수정: {record.updatedAt.slice(0, 10)}
                      </time>
                    </div>
                  </div>
                </div>

                {/* Right actions */}
                <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:self-center">
                  <button
                    type="button"
                    onClick={() => setSelectedRecordForEdit(record)}
                    className={buttonClass({
                      variant: "outline",
                      size: "sm",
                      className: "gap-1 text-xs",
                    })}
                  >
                    <Edit className="size-3.5" />
                    <span>수정 / 판올림</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleToggleListing(record)}
                    title={isDelisted ? "마켓에 재공개" : "비공개 전환"}
                    className={buttonClass({
                      variant: "ghost",
                      size: "sm",
                      className: "gap-1 text-xs",
                    })}
                  >
                    {isDelisted ? (
                      <>
                        <Eye className="size-3.5 text-good" />
                        <span className="text-good">재공개</span>
                      </>
                    ) : (
                      <>
                        <EyeOff className="size-3.5 text-warn" />
                        <span>비공개</span>
                      </>
                    )}
                  </button>

                  <Link
                    href={`/studio?installMarketResource=${record.id}&assetMarket=community`}
                    className={buttonClass({
                      variant: "outline",
                      size: "sm",
                      className: "gap-1 text-xs",
                    })}
                  >
                    <Palette className="size-3.5" />
                    <span>스튜디오</span>
                  </Link>

                  <Link
                    href={`/market/resource/${record.id}`}
                    className={buttonClass({
                      variant: "ghost",
                      size: "sm",
                      className: "gap-1 text-xs",
                    })}
                  >
                    <span>상세</span>
                    <ArrowUpRight className="size-3" />
                  </Link>

                  <button
                    type="button"
                    onClick={() => void handleDelete(record)}
                    title="에셋 영구 삭제"
                    className="rounded-lg p-1.5 text-fg-3 opacity-60 hover:text-warn hover:opacity-100 transition-opacity"
                  >
                    <Trash2 className="size-4" />
                    <span className="sr-only">삭제</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Edit Modal */}
      {selectedRecordForEdit ? (
        <MarketEditResourceModal
          open={true}
          onClose={() => setSelectedRecordForEdit(null)}
          record={selectedRecordForEdit}
          onSaved={(updated) => {
            setSelectedRecordForEdit(null);
            setItems((prev) =>
              prev.map((item) => (item.id === updated.id ? updated : item)),
            );
          }}
        />
      ) : null}
    </Container>
  );
}
