/**
 * Tiny URL router. We avoid react-router for the handful of routes
 * SubTracker actually has:
 *   /                     → Dashboard
 *   /trackers                → TrackersApp list view
 *   /trackers/<id>           → TrackersApp tracker detail
 *   /trackers/guest/<token>  → TrackerGuestRoute (public, no auth)
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

export function matchGuestTrackerToken(path: string): string | null {
  const m = path.match(/^\/trackers\/guest\/([^/?#]+)/);
  return m ? m[1] : null;
}

export interface TrackersRouteMatch {
  /** Tracker detail id, or null for the list view. */
  trackerId: string | null;
}

export function matchTrackersRoute(path: string): TrackersRouteMatch | null {
  if (path === "/trackers" || path === "/trackers/") return { trackerId: null };
  const m = path.match(/^\/trackers\/([^/?#]+)\/?$/);
  if (!m) return null;
  if (m[1] === "guest") return null;     // /trackers/guest is its own route
  return { trackerId: m[1] };
}
