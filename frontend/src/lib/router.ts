/**
 * Tiny URL router. We avoid react-router for the handful of routes
 * SubTracker actually has:
 *   /                     → Dashboard
 *   /trips                → TripsApp list view
 *   /trips/<id>           → TripsApp trip detail
 *   /trips/guest/<token>  → TripGuestRoute (public, no auth)
 *
 * Why not react-router: ~10KB and a provider tree for what's basically
 * 3 conditional branches. This module is ~30 lines and does the same job.
 */
import { useEffect, useState } from "react";

/**
 * React hook that returns the current pathname and re-renders on
 * back/forward navigation or programmatic `navigate()` calls.
 */
export function useRoute(): string {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return path;
}

/**
 * Push a new path to the history stack and notify subscribers. No-op if
 * the path is unchanged. Use `replace` for redirects (e.g. login→home)
 * so the user can't "back" into the redirect source.
 */
export function navigate(path: string, opts: { replace?: boolean } = {}): void {
  if (window.location.pathname === path) return;
  if (opts.replace) {
    window.history.replaceState({}, "", path);
  } else {
    window.history.pushState({}, "", path);
  }
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/* ── Route matchers — keep them collocated so it's obvious what URLs the
     app responds to. App.tsx imports these and switches on them. ──────── */

export function matchGuestTripToken(path: string): string | null {
  const m = path.match(/^\/trips\/guest\/([^/?#]+)/);
  return m ? m[1] : null;
}

export interface TripsRouteMatch {
  /** Trip detail id, or null for the list view. */
  tripId: string | null;
}

export function matchTripsRoute(path: string): TripsRouteMatch | null {
  if (path === "/trips" || path === "/trips/") return { tripId: null };
  const m = path.match(/^\/trips\/([^/?#]+)\/?$/);
  if (!m) return null;
  if (m[1] === "guest") return null;     // /trips/guest is its own route
  return { tripId: m[1] };
}
