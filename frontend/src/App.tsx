import { useEffect } from "react";
import { Dashboard } from "@/components/Dashboard";
import { LoginPage, useAuth } from "@/modules/auth";
import { GlobalProgress } from "@/components/GlobalProgress";
import { InertWhenBusy } from "@/components/InertWhenBusy";
import { PWAInstallPrompt } from "@/components/PWAInstallPrompt";
import { ExpenseTrackerGuestRoute } from "@/components/ExpenseTrackerGuestRoute";
import { ExpenseTrackerApp } from "@/components/ExpenseTrackerApp";
import { useRoute, matchGuestTripToken, matchTripsRoute, navigate } from "@/lib/router";

/**
 * Top-level URL routing.
 *
 *   /                     → Dashboard (or last-used app if user previously
 *                           switched to /trips and is returning fresh)
 *   /trips, /trips/<id>   → ExpenseTrackerApp standalone (auth required)
 *   /trips/guest/<token>  → ExpenseTrackerGuestRoute (public, token IS auth)
 */
const LAST_APP_KEY = "subtracker:last-app";

export default function App() {
  const path = useRoute();
  const guestToken = matchGuestTripToken(path);
  const tripsMatch = matchTripsRoute(path);
  const { user, loading } = useAuth();

  // Track which "app" the user is in so a bare `/` revisit lands them
  // back where they were. We only stamp "trips" here — "dashboard" is
  // written explicitly by the cross-app switcher and the trips Close
  // button. Stamping "dashboard" on every `/` visit would race with the
  // redirect below and clobber the user's last preference.
  useEffect(() => {
    if (guestToken) return;
    if (tripsMatch) localStorage.setItem(LAST_APP_KEY, "trips");
  }, [path, guestToken, tripsMatch]);

  // On a fresh visit to "/", redirect to /trips if that's where they were
  // last. Done in an effect so we don't fight the auth gate.
  useEffect(() => {
    if (loading || !user) return;
    if (path !== "/") return;
    if (localStorage.getItem(LAST_APP_KEY) === "trips") {
      navigate("/trips", { replace: true });
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
        {tripsMatch
          ? <ExpenseTrackerApp
              standalone
              initialTripId={tripsMatch.tripId}
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
