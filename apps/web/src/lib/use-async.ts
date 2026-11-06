"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "./format";

export type AsyncState<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
};

/** Runs `fn` on mount (and when `key` changes); exposes loading / error / data. */
export function useAsync<T>(fn: () => Promise<T>, key: string = ""): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });

  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(() => {
        if (cancelled) return;
        setLoading(true);
        setError(null);
        return fnRef.current();
      })
      .then(
        (d) => {
          if (!cancelled && d !== undefined) {
            setData(d);
            setLoading(false);
          }
        },
        (e) => {
          if (!cancelled) {
            setError(errorMessage(e));
            setLoading(false);
          }
        },
      );
    return () => {
      cancelled = true;
    };
  }, [key, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

/** Wall-clock timer that runs while `running` is true. Returns elapsed ms. */
export function useElapsed(running: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running) return;
    const start = performance.now();
    const id = setInterval(() => setElapsed(performance.now() - start), 100);
    return () => clearInterval(id);
  }, [running]);
  return elapsed;
}
