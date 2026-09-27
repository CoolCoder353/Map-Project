import { type Href, router } from 'expo-router';

/** Back if there is somewhere to go back to; a screen opened from a link has nothing behind it. */
export function goBack(fallback: Href = '/plan') {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
