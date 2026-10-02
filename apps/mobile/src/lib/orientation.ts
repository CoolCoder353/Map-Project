import * as ScreenOrientation from 'expo-screen-orientation';
import { useEffect } from 'react';
import { useLayout } from './layout';

/**
 * Phones stay upright; large screens turn freely. Android 16 ignores an orientation lock on
 * windows 600 dp and wider anyway, so the lock is not in the manifest (which would also lock
 * tablets on older Android): it is applied here, only while the window's short side is under
 * 600 dp, and lifted otherwise (a window resized in multi-window, or an unfolded phone).
 */
export function useOrientationPolicy() {
  const { phone } = useLayout();
  useEffect(() => {
    const apply = phone ? ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP) : ScreenOrientation.unlockAsync();
    // A device that refuses the lock still works, just turning.
    void Promise.resolve(apply).catch(() => undefined);
  }, [phone]);
}
