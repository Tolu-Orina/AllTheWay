import { useCallback, useEffect, useState } from "react";

export type AsyncState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

/**
 * One async pattern for the whole app.
 *
 * Every data-backed screen gets loading, error and ready for free, so the
 * failure path cannot be the thing nobody remembered to build.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<AsyncState<T>>({ status: "loading" });
  const [nonce, setNonce] = useState(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);

  useEffect(() => {
    let live = true;
    setState({ status: "loading" });

    run()
      .then((data) => {
        if (live) setState({ status: "ready", data });
      })
      .catch((e: unknown) => {
        if (live)
          setState({
            status: "error",
            message: e instanceof Error ? e.message : "Something went wrong.",
          });
      });

    return () => {
      live = false;
    };
  }, [run, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { state, reload };
}
