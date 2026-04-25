import { useEffect, useState } from "react";
import { subscribe, getState } from "@/lib/loadingBus";

/** Re-renders when in-flight HTTP counts change. */
export function useLoading() {
  const [state, setState] = useState(getState);
  useEffect(() => subscribe(setState), []);
  return {
    reads:        state.reads,
    writes:       state.writes,
    anyInFlight:  state.reads + state.writes > 0,
    /** Writes block clicks; reads do not. */
    blocking:     state.writes > 0,
  };
}
