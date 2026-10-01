import { NativeModule, requireOptionalNativeModule } from 'expo';

export interface CarCall {
  id: string;
  method: string;
  /** JSON */
  params: string;
}

type Events = { onCall: (call: CarCall) => void };

declare class WayfinderCarModule extends NativeModule<Events> {
  ready(): void;
  resolve(id: string, json: string): void;
  reject(id: string, message: string): void;
  setNavigation(json: string | null): void;
  speak(text: string): void;
  stopSpeaking(): void;
}

export type CarNative = Pick<WayfinderCarModule, 'ready' | 'resolve' | 'reject' | 'setNavigation' | 'speak' | 'stopSpeaking' | 'addListener'>;

/** The car app's native side, or null where it isn't built in (Expo Go, Jest). */
export const native: CarNative | null = requireOptionalNativeModule<WayfinderCarModule>('WayfinderCar');
