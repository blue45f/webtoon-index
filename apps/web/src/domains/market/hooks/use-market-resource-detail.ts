import { useCallback, useEffect, useState } from "react";

import { findMergedMarketResourceById } from "../models/market-custom-registry";
import {
  readCachedMarketResource,
  removeCachedMarketResource,
  writeCachedMarketResource,
} from "../models/market-resource-cache";
import { getCreatorMarketplaceResource } from "../remotes/market-resource-remote";

import type { CreatorMarketplaceResourceRecord } from "@/shared/lib/creator-marketplace-resource-contract";

import { findStarterMarketplaceResourceById } from "@/shared/lib/creator-marketplace-starter-catalog";
import { NotFoundError } from "@/src/infrastructure/use-api-resource";

export interface MarketResourceDetail {
  readonly record: CreatorMarketplaceResourceRecord | null;
  readonly loading: boolean;
  readonly notFound: boolean;
  readonly error: string | null;
  /** 네트워크 실패로 저장된 사본을 보여주는 저하 상태의 저장 시각. */
  readonly staleSavedAt: string | null;
  readonly reload: () => void;
}

/**
 * creator-marketplace 단건 조회를 use-market-resources와 같은 규약으로 래핑한다.
 * id가 없으면 비활성화하고, 네트워크 실패 시 localStorage의 마지막 성공 사본을
 * 보여주는 저하 모드로 전환한다(404는 저하 없이 notFound).
 */
export function useMarketResourceDetail(id: string | undefined): MarketResourceDetail {
  const initialStarter = id
    ? (findMergedMarketResourceById(id) ?? findStarterMarketplaceResourceById(id))
    : null;
  const [record, setRecord] = useState<CreatorMarketplaceResourceRecord | null>(
    initialStarter
  );
  const [loading, setLoading] = useState(!initialStarter);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staleSavedAt, setStaleSavedAt] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    const starter = findMergedMarketResourceById(id) ?? findStarterMarketplaceResourceById(id);

    if (starter) {
      setRecord(starter);
      setLoading(false);
      setNotFound(false);
      setError(null);
      setStaleSavedAt(null);
    } else {
      setRecord(null);
      setLoading(true);
      setNotFound(false);
      setError(null);
      setStaleSavedAt(null);
    }

    getCreatorMarketplaceResource(id, controller.signal)
      .then((parsed) => {
        if (controller.signal.aborted) return;
        setRecord(parsed);
        setLoading(false);
        setNotFound(false);
        setError(null);
        setStaleSavedAt(null);
        writeCachedMarketResource(parsed);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        if (starter) {
          setRecord(starter);
          setLoading(false);
          setNotFound(false);
          setError(null);
          return;
        }
        if (cause instanceof NotFoundError) {
          removeCachedMarketResource(id);
          setRecord(null);
          setNotFound(true);
          setLoading(false);
          return;
        }
        const cached = readCachedMarketResource(id);
        if (cached) {
          setRecord(cached.record);
          setStaleSavedAt(cached.savedAt);
          setLoading(false);
          return;
        }
        setError(cause instanceof Error && cause.message ? cause.message : "공유 리소스를 불러오지 못했습니다.");
        setLoading(false);
      });

    return () => controller.abort();
  }, [id, reloadToken]);

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  return { record, loading, notFound, error, staleSavedAt, reload };
}
