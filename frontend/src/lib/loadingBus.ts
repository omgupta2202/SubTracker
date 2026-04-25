/**
 * Tiny pub-sub for in-flight HTTP request counts.
 *
 * Why not a React context: the API client (services/api.ts) is plain
 * TypeScript and has no React imports. We need a non-React way to
 * `track('write')` from inside `request()`, plus a React hook to drive
 * the top progress bar and the click-blocker.
 */

type Kind = "reads" | "writes";

interface State {
  reads:  number;
  writes: number;
}

let state: State = { reads: 0, writes: 0 };
const listeners = new Set<(s: State) => void>();

function emit() {
  for (const l of listeners) l(state);
}

export function subscribe(fn: (s: State) => void): () => void {
  listeners.add(fn);
  fn(state);
  return () => { listeners.delete(fn); };
}

export function getState(): State {
  return state;
}

/** Increment the counter for the given kind; returns a `done()` to decrement. */
export function track(kind: Kind): () => void {
  state = { ...state, [kind]: state[kind] + 1 };
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state = { ...state, [kind]: Math.max(0, state[kind] - 1) };
    emit();
  };
}

/** Map an HTTP method → counter kind. */
export function kindForMethod(method: string | undefined): Kind {
  const m = (method || "GET").toUpperCase();
  return m === "GET" || m === "HEAD" ? "reads" : "writes";
}
