import { Dashboard } from "@/components/Dashboard";
import { LoginPage, useAuth } from "@/modules/auth";
import { GlobalProgress } from "@/components/GlobalProgress";
import { InertWhenBusy } from "@/components/InertWhenBusy";
import { PWAInstallPrompt } from "@/components/PWAInstallPrompt";
import { TripGuestRoute } from "@/components/TripGuestRoute";
import { TripsApp } from "@/components/TripsApp";
import { useRoute, matchGuestTripToken, matchTripsRoute, navigate } from "@/lib/router";

/**
 * Top-level URL routing.
 *
 *   /                     → Dashboard (auth required)
 *   /trips, /trips/<id>   → TripsApp standalone (auth required)
 *   /trips/guest/<token>  → TripGuestRoute (public, token IS auth)
 *   anything else         → falls through to Dashboard
 */
export default function App() {
  const path = useRoute();
  const guestToken = matchGuestTripToken(path);
  const tripsMatch = matchTripsRoute(path);
  const { user, loading } = useAuth();

  // Public guest route — render before the auth gate.
  if (guestToken) {
    return (
      <>
        <GlobalProgress />
        <TripGuestRoute token={guestToken} />
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
          ? <TripsApp
              standalone
              initialTripId={tripsMatch.tripId}
              onClose={() => navigate("/")}
            />
          : <Dashboard />}
      </InertWhenBusy>
      <PWAInstallPrompt />
    </>
  );
}
