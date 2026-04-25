import { Dashboard } from "@/components/Dashboard";
import { LoginPage, useAuth } from "@/modules/auth";
import { GlobalProgress } from "@/components/GlobalProgress";
import { InertWhenBusy } from "@/components/InertWhenBusy";
import { PWAInstallPrompt } from "@/components/PWAInstallPrompt";

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return null;
  return (
    <>
      <GlobalProgress />
      <InertWhenBusy>
        {!user ? <LoginPage /> : <Dashboard />}
      </InertWhenBusy>
      <PWAInstallPrompt />
    </>
  );
}
