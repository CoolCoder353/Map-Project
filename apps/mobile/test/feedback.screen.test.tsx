/// <reference types="jest" />
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import FeedbackScreen from '../app/feedback';

const mockRequest = jest.fn();
const mockPick = jest.fn();

jest.mock('expo-router', () => ({ router: { back: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '0.1.0' }, deviceName: 'Pixel 8' } }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: (...a: unknown[]) => mockPick(...a) }));
jest.mock('../src/lib/api', () => ({ api: { request: (...a: unknown[]) => mockRequest(...a) }, errorMessage: (e: Error) => e.message }));
jest.mock('../src/lib/mapView', () => ({ lastMapView: () => ({ center: [149.13, -35.28], zoom: 12 }) }));

beforeEach(() => jest.clearAllMocks());

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
