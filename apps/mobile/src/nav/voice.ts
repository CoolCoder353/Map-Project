import * as Speech from 'expo-speech';
import { native } from '../../modules/wayfinder-car';

/** Spoken directions. The app's own voice dips music while it speaks; Expo's is the fallback. */
export function speak(text: string) {
  if (native) native.speak(text);
  else Speech.speak(text, { language: 'en-AU', rate: 1.0 });
}

export function stopSpeaking() {
  if (native) native.stopSpeaking();
  else Speech.stop();
}
