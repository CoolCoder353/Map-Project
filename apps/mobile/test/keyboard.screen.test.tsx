/**
 * Touch targets (48 dp), focus and hover states, and keyboard use: Esc in search, Enter sending
 * feedback, autofill hints. What React Native can simulate here; the rest is on the manual
 * checklist in docs/verification.md.
 */
/// <reference types="jest" />
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import Discover from '../app/(tabs)/discover';
import Plan from '../app/(tabs)/plan';
import Trips from '../app/(tabs)/trips';
import FeedbackScreen from '../app/feedback';
import Register from '../app/register';
import SignIn from '../app/sign-in';
import { MIN_TARGET, Button, Card, Field, Press, Segmented } from '../src/ui/kit';
import { NavigatingBanner } from '../src/ui/NavigatingBanner';
import { WINDOWS, fake, place, trip, renderScreen, resetFakes, resizeWindow, windowSize } from './fakes';

jest.mock('expo-router', () => require('./fakes').routerModule);
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('../src/lib/api', () => require('./fakes').apiModule);
jest.mock('../src/lib/session', () => require('./fakes').sessionModule);
jest.mock('../src/lib/appConfig', () => require('./fakes').appConfigModule);
jest.mock('../src/map/MapCanvas', () => require('./fakes').mapCanvasModule);
jest.mock('../src/lib/contacts', () => ({ findContacts: async () => [] }));
jest.mock('../src/lib/useApproxLocation', () => ({ useApproxLocation: () => undefined }));
jest.mock('expo-location', () => ({ requestForegroundPermissionsAsync: jest.fn(), getCurrentPositionAsync: jest.fn(), Accuracy: { Balanced: 3 } }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '0.1.0' }, deviceName: 'Pixel 8' } }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('../src/lib/server', () => ({ getServerUrl: async () => 'https://maps.example.com', setServerUrl: async (u: string) => u }));
jest.mock('../src/lib/mapView', () => ({ lastMapView: () => null }));
jest.mock('../src/nav/navigationService', () => {
  const snapshot = { active: true, destinationName: 'Home' };
  return { navigation: { subscribe: () => () => undefined, getSnapshot: () => snapshot } };
});

beforeEach(() => {
  resetFakes();
  fake.status = 'anonymous';
  fake.api.on({ 'GET api/search': () => ({ results: [place()] }), 'POST api/feedback': () => ({ id: 'f1' }) });
});
afterEach(() => expect(fake.api.unhandled).toEqual([]));

const styleOf = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never) as Record<string, unknown>;

describe('touch targets are at least 48 dp', () => {
  it('on buttons, compact ones too', async () => {
    await renderScreen(
      <>
        <Button label="Plain" onPress={() => undefined} />
        <Button label="Compact" compact onPress={() => undefined} />
      </>,
    );
    expect(styleOf(screen.getByRole('button', { name: 'Plain' })).minHeight).toBeGreaterThanOrEqual(48);
    expect(styleOf(screen.getByRole('button', { name: 'Compact' })).minHeight).toBeGreaterThanOrEqual(48);
    expect(MIN_TARGET).toBe(48);
  });

  it('on each choice of a segmented control', async () => {
    await renderScreen(<Segmented label="Mode" value="a" onChange={() => undefined} options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} />);
    for (const r of screen.getAllByRole('radio')) expect(styleOf(r)).toMatchObject({ minHeight: 48, minWidth: 48 });
  });

  it('on the search field, its clear button and the banner back to a running trip', async () => {
    await renderScreen(
      <>
        <Plan />
        <NavigatingBanner />
      </>,
    );
    await fireEvent.changeText(screen.getByLabelText('Destination'), 'gum');
    expect(styleOf(screen.getByRole('button', { name: 'Clear destination' }))).toMatchObject({ minHeight: 48, minWidth: 48 });
    expect(styleOf(screen.getByRole('button', { name: 'Back to directions' })).minHeight).toBeGreaterThanOrEqual(48);
    const stepper = screen.getByRole('button', { name: '+' });
    expect(styleOf(stepper)).toMatchObject({ minHeight: 48, minWidth: 48 });
  });
});

describe('focus and hover are visible', () => {
  it('draws an outline on the control the keyboard is on, and takes it away again', async () => {
    await renderScreen(<Button label="Go" onPress={() => undefined} />);
    const button = () => screen.getByRole('button', { name: 'Go' });
    expect(styleOf(button()).outlineWidth).toBeUndefined();
    await fireEvent(button(), 'focus');
    expect(styleOf(button())).toMatchObject({ outlineColor: '#1765cc', outlineWidth: 2 });
    await fireEvent(button(), 'blur');
    expect(styleOf(button()).outlineWidth).toBeUndefined();
  });

  it('calls the caller’s focus handlers too', async () => {
    const onFocus = jest.fn();
    await renderScreen(<Press accessibilityRole="button" accessibilityLabel="Raw" onFocus={onFocus} />);
    await fireEvent(screen.getByRole('button', { name: 'Raw' }), 'focus');
    expect(onFocus).toHaveBeenCalled();
  });

  it('shades a button, a segment and a card under the mouse', async () => {
    await renderScreen(
      <>
        <Button label="Go" kind="secondary" onPress={() => undefined} />
        <Segmented label="Mode" value="a" onChange={() => undefined} options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} />
        <Card onPress={() => undefined}>{null}</Card>
      </>,
    );
    const go = screen.getByRole('button', { name: 'Go' });
    expect(styleOf(go).backgroundColor).toBe('#ffffff');
    await fireEvent(go, 'hoverIn');
    expect(styleOf(go).backgroundColor).toBe('#eceef1');
    await fireEvent(go, 'hoverOut');
    expect(styleOf(go).backgroundColor).toBe('#ffffff');
    const b = screen.getByRole('radio', { name: 'B' });
    await fireEvent(b, 'hoverIn');
    expect(styleOf(b).backgroundColor).toBe('#f5f6f8');
    const card = screen.getAllByRole('button').find((x) => x !== go)!;
    await fireEvent(card, 'hoverIn');
    expect(styleOf(card).backgroundColor).toBe('#f5f6f8');
  });

  it('marks a text field the keyboard is in', async () => {
    await renderScreen(<Field label="Email" value="" onChangeText={() => undefined} />);
    const input = screen.getByLabelText('Email');
    expect(styleOf(input).borderWidth).toBe(1);
    await fireEvent(input, 'focus');
    expect(styleOf(input)).toMatchObject({ borderWidth: 2, borderColor: '#1765cc' });
    await fireEvent(input, 'blur');
    expect(styleOf(input).borderWidth).toBe(1);
  });
});

describe('lists and chips show the mouse too', () => {
  const hover = async (el: Parameters<typeof fireEvent>[0]) => {
    const before = styleOf(el as never);
    await fireEvent(el, 'hoverIn');
    expect(styleOf(el as never)).not.toEqual(before);
  };

  it('on search suggestions and the clear button', async () => {
    await renderScreen(<Plan />);
    const start = screen.getByLabelText('Starting point');
    await fireEvent(start, 'focus');
    await hover(await screen.findByRole('button', { name: 'Your location' }));
    const box = screen.getByLabelText('Destination');
    await fireEvent(box, 'focus');
    await fireEvent.changeText(box, 'gumdale');
    await hover(await screen.findByRole('button', { name: /Gumdale State School/ }));
    await hover(screen.getByRole('button', { name: 'Clear destination' }));
  });

  it('on the banner back to a running trip', async () => {
    await renderScreen(<NavigatingBanner />);
    await hover(screen.getByRole('button', { name: 'Back to directions' }));
  });

  it('on the chips in Discover and trips in the list', async () => {
    await renderScreen(<Discover />);
    await hover(screen.getAllByRole('checkbox')[0]!);
    fake.api.on({ 'GET api/trips': () => ({ items: [trip()], nextCursor: null }) });
    await renderScreen(<Trips />);
    await hover(await screen.findByRole('button', { name: /18 km/ }));
  });
});

describe('search and the Esc key', () => {
  const key = (name: string) => ({ nativeEvent: { key: name } });

  async function search() {
    await renderScreen(<Plan />);
    const box = screen.getByLabelText('Destination');
    await fireEvent(box, 'focus');
    await fireEvent.changeText(box, 'gumdale');
    expect(await screen.findByText('Gumdale State School')).toBeOnTheScreen();
    return box;
  }

  it('closes the suggestions first, then clears the text', async () => {
    const box = await search();
    await fireEvent(box, 'keyPress', key('Escape'));
    expect(screen.queryByText('Gumdale State School')).toBeNull();
    expect(box).toHaveDisplayValue('gumdale');
    await fireEvent(box, 'keyPress', key('Escape'));
    expect(box).toHaveDisplayValue('');
  });

  it('ignores other keys', async () => {
    const box = await search();
    await fireEvent(box, 'keyPress', key('a'));
    expect(screen.getByText('Gumdale State School')).toBeOnTheScreen();
    expect(box).toHaveDisplayValue('gumdale');
  });
});

describe('Enter sends the feedback form on a large screen', () => {
  const write = async () => {
    await renderScreen(<FeedbackScreen />);
    await fireEvent.changeText(screen.getByLabelText('What went wrong?'), 'Route vanished');
  };

  it('but a phone keeps Enter for a new line', async () => {
    await write();
    expect(screen.getByLabelText('What went wrong?').props.submitBehavior).toBeUndefined();
  });

  it('sends on Enter at 1000 dp, and only with a message', async () => {
    windowSize(WINDOWS.tablet.width, WINDOWS.tablet.height);
    await renderScreen(<FeedbackScreen />);
    const box = screen.getByLabelText('What went wrong?');
    expect(box.props.submitBehavior).toBe('submit');
    await fireEvent(box, 'submitEditing');
    expect(fake.api.callsTo('POST api/feedback')).toHaveLength(0);
    await fireEvent.changeText(box, 'Route vanished');
    await fireEvent(box, 'submitEditing');
    await waitFor(() => expect(fake.api.callsTo('POST api/feedback')).toHaveLength(1));
    expect(await screen.findByText('Thanks — your feedback was sent.')).toBeOnTheScreen();
  });

  it('switches when the window is resized', async () => {
    await write();
    await resizeWindow(WINDOWS.tablet.width, WINDOWS.tablet.height);
    expect(screen.getByLabelText('What went wrong?').props.submitBehavior).toBe('submit');
    expect(screen.getByLabelText('What went wrong?')).toHaveDisplayValue('Route vanished');
  });
});

describe('autofill hints', () => {
  it('tells the password manager the register password is a new one', async () => {
    await renderScreen(<Register />);
    expect(screen.getByLabelText('Password').props.autoComplete).toBe('new-password');
    expect(screen.getByLabelText('Email').props.autoComplete).toBe('email');
  });

  it('keeps the sign-in hints', async () => {
    await renderScreen(<SignIn />);
    expect(screen.getByLabelText('Password').props.autoComplete).toBe('password');
    expect(screen.getByLabelText('Email').props.autoComplete).toBe('email');
  });
});
