import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./api";

export interface LoadState<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  refreshing: boolean;
  reload: () => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * Loads on screen focus and whenever `deps` change, with pull-to-refresh.
 * Keeps the last good data visible when a refresh fails.
 */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []): LoadState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const seq = useRef(0);
  const fnRef = useRef(fn);
  const key = JSON.stringify(deps);

  useEffect(() => {
    fnRef.current = fn;
  });

  const run = useCallback(
    async (mode: "load" | "refresh") => {
      const id = ++seq.current;
      if (mode === "refresh") setRefreshing(true);
      else setLoading(true);
      try {
        const result = await fnRef.current();
        if (id === seq.current) {
          setData(result);
          setError(null);
        }
      } catch (e) {
        if (id === seq.current) {
          setError(e instanceof ApiError ? e : new ApiError("network", 0, "UNKNOWN", "Something went wrong. Try again."));
        }
      } finally {
        if (id === seq.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    // `key` stands in for the caller's deps so a change re-runs the load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );

  useFocusEffect(
    useCallback(() => {
      void run("load");
    }, [run]),
  );

  return {
    data,
    error,
    loading: loading && data === null,
    refreshing,
    reload: () => run("load"),
    refresh: () => run("refresh"),
  };
}
