/// <reference types="jest" />
import { Alert, PermissionsAndroid, Platform } from 'react-native';
import { askForNotifications } from '../src/lib/notifications';
import { backgroundLocationDisclosure, confirmBackgroundLocation } from '../src/tracking/disclosure';

type Buttons = Array<{ text: string; onPress?: () => void }>;

afterEach(() => jest.restoreAllMocks());

describe('the background location disclosure (Google Play)', () => {
  it('names the data, says it is collected with the app closed, says what for and who gets it', () => {
    const { title, message } = backgroundLocationDisclosure('Roamer');
    expect(title).toMatch(/location in the background/);
    expect(message).toMatch(/^Roamer collects location data/);
    expect(message).toMatch(/even when the app is closed or not in use/);
    expect(message).toMatch(/to record the roads you travel and suggest roads you haven’t been on/);
    expect(message).toMatch(/aren’t shared with anyone else/);
    expect(message).toMatch(/turn it off any time in Settings/);
  });

  it('agrees only on Continue; Not now and dismissing are a no', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    const answer = async (pick: (buttons: Buttons, options: { onDismiss?: () => void }) => void) => {
      const result = confirmBackgroundLocation('Roamer');
      const [title, message, buttons, options] = alert.mock.lastCall!;
      expect(title).toBe(backgroundLocationDisclosure('Roamer').title);
      expect(message).toBe(backgroundLocationDisclosure('Roamer').message);
      pick(buttons as Buttons, options as { onDismiss?: () => void });
      return result;
    };
    alert.mockImplementation(() => undefined);
    expect(await answer((b) => b.find((x) => x.text === 'Continue')!.onPress!())).toBe(true);
    expect(await answer((b) => b.find((x) => x.text === 'Not now')!.onPress!())).toBe(false);
    expect(await answer((_b, o) => o.onDismiss!())).toBe(false);
  });
});

describe('asking for notifications', () => {
  const on = (os: 'android' | 'ios', version: number) => {
    jest.replaceProperty(Platform, 'OS', os);
    jest.spyOn(Platform, 'Version', 'get').mockReturnValue(version);
  };

  it('needs no asking before Android 13, or off Android', async () => {
    const request = jest.spyOn(PermissionsAndroid, 'request');
    on('android', 32);
    expect(await askForNotifications()).toBe(true);
    on('ios', 17);
    expect(await askForNotifications()).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });

  it('asks on Android 13 and up unless already allowed', async () => {
    on('android', 34);
    const check = jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(true);
    const request = jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);
    expect(await askForNotifications()).toBe(true);
    expect(request).not.toHaveBeenCalled();
    check.mockResolvedValue(false);
    expect(await askForNotifications()).toBe(true);
    expect(request).toHaveBeenCalledWith(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    request.mockResolvedValue(PermissionsAndroid.RESULTS.DENIED);
    expect(await askForNotifications()).toBe(false);
    request.mockRejectedValue(new Error('not attached to an Activity'));
    expect(await askForNotifications()).toBe(false);
  });
});
