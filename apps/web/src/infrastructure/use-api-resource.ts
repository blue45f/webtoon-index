import { useEffect, useState } from "react";

import { api, apiPath } from "@/src/infrastructure/api";

// 404 를 흐름 제어(notFound)로 다루기 위한 센티넬 에러. 일반 에러와 구분한다.
export class NotFoundError extends Error {
  constructor() {
    super("not-found");
    this.name = "NotFoundError";
  }
}

type ResourceState<T> = {
  url: string | null;
  data: T | null;
  loading: boolean;
  error: string | null;
  notFound: boolean;
};

function initialState<T>(url: string | null): ResourceState<T> {
  return {
    url,
    data: null,
    loading: Boolean(url),
    error: null,
    notFound: false,
  };
}

export async function fetchApiResource<T>(url: string, errorMessage: string, signal?: AbortSignal): Promise<T> {
  const requestUrl = apiPath(url);
  const response = await api.raw(requestUrl, {
    cache: "no-store",
    signal,
    throwHttpErrors: false,
  });
  if (response.status === 404) throw new NotFoundError();
  if (!response.ok) {
    let resolvedMessage = errorMessage;
    try {
      const parsed = await response.json();
      if (
        parsed
        && typeof parsed === "object"
        && "message" in parsed
        && typeof (parsed as { message: unknown }).message === "string"
      ) {
        resolvedMessage = (parsed as { message: string }).message;
      }
    } catch {
      // JSON 본문이 아니면 기존 errorMessage 폴백 유지
    }
    throw new Error(resolvedMessage);
  }
  return (await response.json()) as T;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * 클라이언트 데이터 페칭 훅. 호출부 계약({ data, loading, error, notFound, reload })은
 * 기존 수동 fetch 구현과 동일하게 유지한다.
 *
 * 동작 보존:
 * - url 이 null 이면 쿼리를 비활성화(enabled:false)하고 data:null, loading:false 를 돌려준다(기존과 동일).
 * - loading 은 "요청 진행 중" — 기존 useApiResource 가 매 fetch 마다 setLoading(true) 한 것과 동일.
 *   탐색/캘린더/프로필/리뷰의 갱신 버튼 스피너가 reload 중에도 도는 동작을 보존한다.
 * - 404 는 notFound:true + data:null(기존: 404 응답을 null 로 처리하고 notFound 플래그 설정).
 * - 그 외 비-OK 응답/네트워크 오류는 error(문자열 메시지)로 처리. 메시지는 errorMessage 로 통일(기존과 동일).
 * - reload() 는 강제 refetch(기존: reloadKey 증가로 effect 재실행).
 * - 자동 refetch(창 포커스/재연결/주기)는 없다.
 */
export function useApiResource<T>(url: string | null, errorMessage: string) {
  const [reloadToken, setReloadToken] = useState(0);
  const [state, setState] = useState<ResourceState<T>>(() => initialState<T>(url));

  useEffect(() => {
    if (!url) {
      setState(initialState<T>(null));
      return;
    }

    const requestUrl = url;
    const controller = new AbortController();

    setState((previous) => ({
      url: requestUrl,
      data: previous.url === requestUrl ? previous.data : null,
      loading: true,
      error: null,
      notFound: false,
    }));

    fetchApiResource<T>(requestUrl, errorMessage, controller.signal)
      .then((data) => {
        setState({
          url: requestUrl,
          data,
          loading: false,
          error: null,
          notFound: false,
        });
      })
      .catch((error: unknown) => {
        if (isAbortError(error)) return;
        if (error instanceof NotFoundError) {
          setState({
            url: requestUrl,
            data: null,
            loading: false,
            error: null,
            notFound: true,
          });
          return;
        }
        const errMessage = error instanceof Error && error.message ? error.message : errorMessage;
        setState((previous) => ({
          url: requestUrl,
          data: previous.url === requestUrl ? previous.data : null,
          loading: false,
          error: errMessage,
          notFound: false,
        }));
      });

    return () => {
      controller.abort();
    };
  }, [errorMessage, reloadToken, url]);

  return {
    data: state.data,
    loading: state.loading,
    error: state.error,
    notFound: state.notFound,
    reload: () => {
      setReloadToken((value) => value + 1);
    },
  };
}
