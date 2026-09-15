"use client";

/** 화면(클라이언트)에서 API를 호출할 때 쓰는 공통 도우미 */

import { useCallback, useEffect, useState } from "react";
import type { Database } from "./types";

export type AppData = Database & { editor: boolean };

/**
 * 서버에 요청을 보내고, 실패하면 서버가 내려준 한국어 메시지를 그대로 에러로 던진다.
 */
export async function apiSend<T>(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const json = (await response.json().catch(() => ({}))) as { error?: string };

  if (!response.ok) {
    throw new Error(json.error ?? "요청을 처리하지 못했습니다.");
  }

  return json as T;
}

/** 서버에서 전체 데이터를 받아온다. */
async function fetchAppData(): Promise<AppData> {
  const response = await fetch("/api/data", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("데이터를 불러오지 못했습니다.");
  }
  return (await response.json()) as AppData;
}

function toMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : "데이터를 불러오지 못했습니다.";
}

/** 전체 데이터를 불러오고, 저장 후 다시 불러올 수 있게 해주는 훅 */
export function useAppData() {
  const [data, setData] = useState<AppData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** 저장 후 화면을 새로 고칠 때 쓴다. */
  const reload = useCallback(async () => {
    try {
      setData(await fetchAppData());
      setError(null);
    } catch (caught) {
      setError(toMessage(caught));
    }
  }, []);

  // 첫 화면 진입 시 한 번 불러온다.
  useEffect(() => {
    let cancelled = false;

    fetchAppData()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(toMessage(caught));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { data, loading, error, reload };
}
