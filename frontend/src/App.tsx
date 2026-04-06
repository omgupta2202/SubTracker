import { Dashboard } from "@/components/Dashboard";
import { LoginPage, useAuth } from "@/modules/auth";

export default function App() {
  const { user, loading } = useAuth();

  if (loading) return null;
  if (!user) return <LoginPage />;

  return <Dashboard />;
}
