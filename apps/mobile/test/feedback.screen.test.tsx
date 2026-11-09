/// <reference types="jest" />
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import FeedbackScreen from '../app/feedback';

const mockRequest = jest.fn();
const mockPick = jest.fn();

jest.mock('expo-router', () => ({ router: { back: jest.fn(), canGoBack: () => true, replace: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '0.1.0' }, deviceName: 'Pixel 8' } }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: (...a: unknown[]) => mockPick(...a) }));
jest.mock('../src/lib/api', () => ({ api: { request: (...a: unknown[]) => mockRequest(...a) }, errorMessage: (e: Error) => e.message }));
jest.mock('../src/lib/mapView', () => ({ lastMapView: () => ({ center: [149.13, -35.28], zoom: 12 }) }));
let mockScheme: 'light' | 'dark' = 'light';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({ __esModule: true, default: () => mockScheme }));

/** Your reports from the car, as the server lists them. */
let mockCarReports: unknown[] = [];
/** Answers what the screen sends; the list of reports from the car is answered from mockCarReports. */
const answer = (send: (path: string, init: unknown) => Promise<unknown>) =>
  mockRequest.mockImplementation((path: string, init: unknown) => (path === 'api/feedback/car-reports' ? Promise.resolve({ reports: mockCarReports }) : send(path, init)));
/** What was sent, leaving out the request for reports from the car. */
const sent = () => mockRequest.mock.calls.filter(([path]) => path !== 'api/feedback/car-reports');

beforeEach(() => {
  jest.clearAllMocks();
  mockScheme = 'light';
  mockCarReports = [];
  answer(async () => ({ id: 'f1' }));
});

it('keeps the message readable in dark mode', async () => {
  mockScheme = 'dark';
  await render(<FeedbackScreen />);
  const style = StyleSheet.flatten(screen.getByLabelText('What went wrong?').props.style);
  // Light text on the dark panel, not the platform's default black.
  expect(style).toMatchObject({ color: '#e8eaed', backgroundColor: '#202327', minHeight: 120 });
});

it('needs a message before it can be sent', async () => {
  await render(<FeedbackScreen />);
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  // Says why it can't be sent yet, rather than a dim button and nothing else.
  expect(screen.getByText('Write a few words about what happened to send it.')).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText('What went wrong?'), 'Route vanished');
  expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  expect(screen.queryByText('Write a few words about what happened to send it.')).toBeNull();
});

it('sends the report with a gallery screenshot and, only when switched on, the map view', async () => {
  mockPick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///shot.jpg', base64: 'AAAA', mimeType: 'image/jpeg' }] });
  await render(<FeedbackScreen />);
  await fireEvent.press(screen.getByRole('radio', { name: 'Idea' }));
  await fireEvent.changeText(screen.getByLabelText('What would you like?'), 'Show petrol prices');
  await fireEvent.press(screen.getByRole('button', { name: 'Attach a screenshot' }));
  expect(await screen.findByLabelText('Screenshot that will be sent')).toBeOnTheScreen();
  await fireEvent(screen.getByLabelText('Include what the map was showing'), 'valueChange', true);
  await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(sent()).toHaveLength(1));
  const [path, init] = sent()[0]!;
  expect(path).toBe('api/feedback');
  expect(init.body).toMatchObject({
    type: 'idea',
    message: 'Show petrol prices',
    context: { platform: 'android', appVersion: '0.1.0', mapView: { center: [149.13, -35.28], zoom: 12 } },
    screenshot: { mediaType: 'image/jpeg', data: 'AAAA' },
  });
  expect(await screen.findByText('Thanks — your feedback was sent.')).toBeOnTheScreen();
});

it('shows the server’s message when feedback has been switched off', async () => {
  answer(async () => {
    throw new Error('Feedback is turned off');
  });
  await render(<FeedbackScreen />);
  await fireEvent.changeText(screen.getByLabelText('What went wrong?'), 'Something broke');
  await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
  expect(await screen.findByText('Feedback is turned off')).toBeOnTheScreen();
});

it('says so when the photo picker can’t open, and trims the message it sends', async () => {
  mockPick.mockRejectedValueOnce(new Error('No activity found to handle intent'));
  await render(<FeedbackScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Attach a screenshot' }));
  expect(await screen.findByText(/Couldn’t open your photos/)).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText('What went wrong?'), '   Map went blank   ');
  await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(sent()).toHaveLength(1));
  expect(sent()[0]![1]).toMatchObject({ body: { message: 'Map went blank' }, timeoutMs: 120_000 });
});

it('turns down an image the picker couldn’t read', async () => {
  mockPick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///shot.heic', base64: null, mimeType: 'image/heic' }] });
  await render(<FeedbackScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Attach a screenshot' }));
  expect(await screen.findByText(/Couldn’t read that image/)).toBeOnTheScreen();
  expect(screen.queryByLabelText('Screenshot that will be sent')).toBeNull();
});

describe('reports from the car', () => {
  const report = (over = {}) => ({ id: '11111111-1111-4111-8111-111111111111', createdAt: '2026-11-02T00:23:02Z', showing: 'At roundabout, take exit 1 onto Moselle Drive', detailsAdded: false, ...over });

  it('lists your recent ones, and adds what was wrong to the one you pick', async () => {
    mockCarReports = [report(), report({ id: '22222222-2222-4222-8222-222222222222', showing: null, detailsAdded: true })];
    answer(async () => undefined);
    await render(<FeedbackScreen />);
    expect(await screen.findByText('At roundabout, take exit 1 onto Moselle Drive')).toBeOnTheScreen();
    expect(screen.getByText('No directions showing · details added')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('At roundabout, take exit 1 onto Moselle Drive'));
    // About a report from the car: what went wrong, without the kind of feedback or the map view.
    expect(screen.queryByRole('radio', { name: 'Idea' })).toBeNull();
    expect(screen.queryByLabelText('Include what the map was showing')).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('What went wrong?'), '  Couldn’t see the marker of me  ');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Thanks — that’s been added to your report from the car.')).toBeOnTheScreen();
    expect(sent()).toEqual([['api/feedback/11111111-1111-4111-8111-111111111111/details', { method: 'POST', body: { message: 'Couldn’t see the marker of me' }, timeoutMs: 120_000 }]]);
  });

  it('sends something new when you pick one and then change your mind', async () => {
    mockCarReports = [report()];
    await render(<FeedbackScreen />);
    const row = await screen.findByText('At roundabout, take exit 1 onto Moselle Drive');
    await fireEvent.press(row);
    await fireEvent.press(row);
    expect(screen.getByRole('radio', { name: 'Idea' })).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText('What went wrong?'), 'Something else');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(sent()).toHaveLength(1));
    expect(sent()[0]![0]).toBe('api/feedback');
  });

  it('still lets you send feedback when they can’t be listed', async () => {
    mockRequest.mockImplementation((path: string) => (path === 'api/feedback/car-reports' ? Promise.reject(new Error('offline')) : Promise.resolve({ id: 'f1' })));
    await render(<FeedbackScreen />);
    await fireEvent.changeText(screen.getByLabelText('What went wrong?'), 'Map went blank');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Thanks — your feedback was sent.')).toBeOnTheScreen();
    expect(screen.queryByText('Reports from the car')).toBeNull();
  });
});
