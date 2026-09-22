/// <reference types="jest" />
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { PlaceSearch } from '../src/ui/PlaceSearch';

const mockRequest = jest.fn();
const mockFind = jest.fn();

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-location', () => ({ requestForegroundPermissionsAsync: jest.fn(), getCurrentPositionAsync: jest.fn(), Accuracy: { Balanced: 3 } }));
jest.mock('../src/lib/api', () => ({ api: { request: (...a: unknown[]) => mockRequest(...a) }, errorMessage: (e: Error) => e.message }));
jest.mock('../src/lib/contacts', () => ({ findContacts: (...a: unknown[]) => mockFind(...a) }));

beforeEach(() => {
  jest.clearAllMocks();
  mockRequest.mockResolvedValue({ results: [] });
  mockFind.mockResolvedValue([]);
});

const type = async (text: string) => {
  await render(<PlaceSearch label="Destination" placeholder="Where to?" value={null} onChange={jest.fn()} />);
  const box = screen.getByLabelText('Destination');
  await fireEvent(box, 'focus');
  await fireEvent.changeText(box, text);
};

it('shows nothing from contacts when the feature is off', async () => {
  await type('mum');
  await waitFor(() => expect(mockFind).toHaveBeenCalledWith('mum'));
  expect(screen.queryByText('Mum')).toBeNull();
});

it('offers a matching contact and looks up only their address when picked', async () => {
  const onChange = jest.fn();
  mockFind.mockResolvedValue([{ id: 'c1', name: 'Mum', address: '12 Queen St, Brisbane', label: 'home' }]);
  mockRequest.mockImplementation(async (_path: string, opts: { query: { q: string } }) =>
    opts.query.q === '12 Queen St, Brisbane'
      ? { results: [{ id: 'p1', name: '12 Queen Street', kind: 'address', description: '', location: [153.02, -27.47] }] }
      : { results: [] },
  );
  await render(<PlaceSearch label="Destination" placeholder="Where to?" value={null} onChange={onChange} />);
  const box = screen.getByLabelText('Destination');
  await fireEvent(box, 'focus');
  await fireEvent.changeText(box, 'mum');
  expect(await screen.findByText('Mum')).toBeOnTheScreen();
  expect(screen.getByText('home · 12 Queen St, Brisbane')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('Mum'));
  await waitFor(() => expect(onChange).toHaveBeenCalledWith({ name: 'Mum', description: '12 Queen St, Brisbane', location: [153.02, -27.47] }));
});

it('says so when the contact’s address cannot be found on the map', async () => {
  mockFind.mockResolvedValue([{ id: 'c1', name: 'Dad', address: 'Nowhere Road', label: null }]);
  await render(<PlaceSearch label="Destination" placeholder="Where to?" value={null} onChange={jest.fn()} />);
  const box = screen.getByLabelText('Destination');
  await fireEvent(box, 'focus');
  await fireEvent.changeText(box, 'dad');
  await fireEvent.press(await screen.findByText('Dad'));
  expect(await screen.findByText(/Couldn’t find Dad’s address/)).toBeOnTheScreen();
});
