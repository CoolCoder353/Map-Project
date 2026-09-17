import { Redirect } from 'expo-router';
import { Loading } from '../src/ui/kit';
import { useSession } from '../src/lib/session';

export default function Index() {
  const { status } = useSession();
  if (status === 'loading') return <Loading />;
  return <Redirect href={status === 'authenticated' ? '/plan' : '/sign-in'} />;
}
