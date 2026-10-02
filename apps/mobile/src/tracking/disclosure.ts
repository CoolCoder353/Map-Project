import { Alert } from 'react-native';

/**
 * Google Play's "prominent disclosure" for background location, shown in the app before Android's
 * own location prompts. Play rejects an app without one. It must say what data is collected, that
 * it is collected when the app is closed or not in use, and what for; it can't live only in the
 * privacy policy or a settings description; and only an explicit "Continue" counts as agreeing.
 * Not voice-dependent on purpose: policy wording stays the same in every voice.
 */
export function backgroundLocationDisclosure(appName: string) {
  return {
    title: 'Use your location in the background?',
    message:
      `${appName} collects location data to record the roads you travel and suggest roads you haven’t been on, ` +
      'even when the app is closed or not in use. ' +
      `Your trips are sent only to the ${appName} server your group uses and aren’t shared with anyone else. ` +
      'A notification shows while recording is on, and you can turn it off any time in Settings.\n\n' +
      'On the next screens, allow location, then choose “Allow all the time”.',
    decline: 'Not now',
    accept: 'Continue',
  };
}

/** Shows the disclosure; true only when the person taps Continue. */
export function confirmBackgroundLocation(appName: string): Promise<boolean> {
  const d = backgroundLocationDisclosure(appName);
  return new Promise((resolve) => {
    Alert.alert(
      d.title,
      d.message,
      [
        { text: d.decline, style: 'cancel', onPress: () => resolve(false) },
        { text: d.accept, onPress: () => resolve(true) },
      ],
      // Tapping outside or Back is not agreement.
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
