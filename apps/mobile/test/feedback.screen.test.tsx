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

beforeEach(() => {
  jest.clearAllMocks();
  mockScheme = 'light';
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
  await fireEvent.changeText(screen.getByLabelText('What went wrong?'), 'Route vanished');
  expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
});

it('sends the report with a gallery screenshot and, only when switched on, the map view', async () => {
  mockPick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///shot.jpg', base64: 'AAAA', mimeType: 'image/jpeg' }] });
  mockRequest.mockResolvedValue({ id: 'f1' });
  await render(<FeedbackScreen />);
  await fireEvent.press(screen.getByRole('radio', { name: 'Idea' }));
  await fireEvent.changeText(screen.getByLabelText('What would you like?'), 'Show petrol prices');
  await fireEvent.press(screen.getByRole('button', { name: 'Attach a screenshot' }));
  expect(await screen.findByLabelText('Screenshot that will be sent')).toBeOnTheScreen();
  await fireEvent(screen.getByLabelText('Include what the map was showing'), 'valueChange', true);
  await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(mockRequest).toHaveBeenCalled());
  const [path, init] = mockRequest.mock.calls[0]!;
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
  mockRequest.mockRejectedValue(new Error('Feedback is turned off'));
  await render(<FeedbackScreen />);
  await fireEvent.changeText(screen.getByLabelText('What went wrong?'), 'Something broke');
  await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
  expect(await screen.findByText('Feedback is turned off')).toBeOnTheScreen();
});

it('says so when the photo picker can’t open, and trims the message it sends', async () => {
  mockPick.mockRejectedValueOnce(new Error('No activity found to handle intent'));
  mockRequest.mockResolvedValue({ id: 'f1' });
  await render(<FeedbackScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Attach a screenshot' }));
  expect(await screen.findByText(/Couldn’t open your photos/)).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText('What went wrong?'), '   Map went blank   ');
  await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(mockRequest).toHaveBeenCalled());
  expect(mockRequest.mock.calls[0]![1]).toMatchObject({ body: { message: 'Map went blank' }, timeoutMs: 120_000 });
});

it('turns down an image the picker couldn’t read', async () => {
  mockPick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///shot.heic', base64: null, mimeType: 'image/heic' }] });
  await render(<FeedbackScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Attach a screenshot' }));
  expect(await screen.findByText(/Couldn’t read that image/)).toBeOnTheScreen();
  expect(screen.queryByLabelText('Screenshot that will be sent')).toBeNull();
});
