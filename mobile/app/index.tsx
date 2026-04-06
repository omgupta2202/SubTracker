import { Redirect } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { Loader } from '@/components/Loader';

export default function Index() {
  const { token, loading } = useAuth();
  if (loading) return <Loader />;
  return <Redirect href={token ? '/(tabs)' : '/(auth)/login'} />;
}
