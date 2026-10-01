/**
 * Whether a navigated trip is recording right now. Navigation records its own fixes (more often,
 * and tagged with the trip), so background recording leaves that time to it: otherwise the same
 * drive arrives twice and shows as two trips. Kept apart from the navigation service so the
 * background task, which Android can wake with nothing else loaded, stays light.
 */
let recording = false;

export function setNavigationRecording(on: boolean) {
  recording = on;
}

export function isNavigationRecording() {
  return recording;
}
