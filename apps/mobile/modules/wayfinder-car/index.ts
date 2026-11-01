import { NativeModule, requireOptionalNativeModule } from 'expo';
import type { LocationObject } from 'expo-location';

export interface CarCall {
  id: string;
  method: string;
  /** JSON */
  params: string;
}

type Events = { onCall: (call: CarCall) => void; onPhoneFix: (loc: LocationObject) => void };

declare class WayfinderCarModule extends NativeModule<Events> {
  ready(): void;
  resolve(id: string, json: string): void;
  reject(id: string, message: string): void;
  setNavigation(json: string | null): void;
  speak(text: string): void;
  stopSpeaking(): void;
  /** Starts onPhoneFix events, which keep coming with the phone locked; false if they can't. */
  watchPhoneLocation(): boolean;
  stopPhoneLocation(): void;
}

export type CarNative = Pick<WayfinderCarModule, 'ready' | 'resolve' | 'reject' | 'setNavigation' | 'speak' | 'stopSpeaking' | 'addListener'>;
/** The phone's own positions, from the same module. */
export type PhoneFixNative = Pick<WayfinderCarModule, 'watchPhoneLocation' | 'stopPhoneLocation' | 'addListener'>;

/** The car app's native side, or null where it isn't built in (Expo Go, Jest). */
export const native: (CarNative & PhoneFixNative) | null = requireOptionalNativeModule<WayfinderCarModule>('WayfinderCar');
