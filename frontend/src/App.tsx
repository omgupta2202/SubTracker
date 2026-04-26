import { useEffect } from "react";
import { Dashboard } from "@/components/Dashboard";
import { LoginPage, useAuth } from "@/modules/auth";
import { GlobalProgress } from "@/components/GlobalProgress";
import { InertWhenBusy } from "@/components/InertWhenBusy";
import { PWAInstallPrompt } from "@/components/PWAInstallPrompt";
import { ExpenseTrackerGuestRoute } from "@/components/ExpenseTrackerGuestRoute";
import { ExpenseTrackerApp } from "@/components/ExpenseTrackerApp";
import { useRoute, matchGuestTrackerToken, matchTrackersRoute, navigate } from "@/lib/router";

/**
 * Top-level URL routing.
 *
 *   /                     → Dashboard (or last-used app if user previously
 *                           switched to /trackers and is returning fresh)
 *   /trackers, /trackers/<id>   → ExpenseTrackerApp standalone (auth required)
 *   /trackers/guest/<token>  → ExpenseTrackerGuestRoute (public, token IS auth)
 */
const LAST_APP_KEY = "subtracker:last-app";

export default function App() {
  const path = useRoute();
  const guestToken = matchGuestTrackerToken(path);
  const trackersMatch = matchTrackersRoute(path);
  const { user, loading } = useAuth();

  // Track which "app" the user is in so a bare `/` revisit lands them
  // back where they were. We only stamp "trackers" here — "dashboard" is
  // written explicitly by the cross-app switcher and the trackers Close
  // button. Stamping "dashboard" on every `/` visit would race with the
  // redirect below and clobber the user's last preference.
  useEffect(() => {
    if (guestToken) return;
    if (trackersMatch) localStorage.setItem(LAST_APP_KEY, "trackers");
  }, [path, guestToken, trackersMatch]);

  // On a fresh visit to "/", redirect to /trackers if that's where they were
  // last. Done in an effect so we don't fight the auth gate.
  useEffect(() => {
    if (loading || !user) return;
    if (path !== "/") return;
    if (localStorage.getItem(LAST_APP_KEY) === "trackers") {
      navigate("/trackers", { replace: true });
    }
  }, [path, loading, user]);

  // Public guest route — render before the auth gate.
  if (guestToken) {
    return (
      <>
        <GlobalProgress />
        <ExpenseTrackerGuestRoute token={guestToken} />
      </>
    );
  }

  if (loading) return null;
  if (!user) {
    return (
      <>
        <GlobalProgress />
        <LoginPage />
      </>
    );
  }

  return (
    <>
      <GlobalProgress />
      <InertWhenBusy>
        {trackersMatch
          ? <ExpenseTrackerApp
              standalone
              initialTrackerId={trackersMatch.trackerId}
              onClose={() => {
                localStorage.setItem(LAST_APP_KEY, "dashboard");
                navigate("/");
              }}
            />
          : <Dashboard />}
      </InertWhenBusy>
      <PWAInstallPrompt />
    </>
  );
}
