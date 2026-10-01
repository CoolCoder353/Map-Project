/// <reference types="jest" />
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { PlaceSearch } from '../src/ui/PlaceSearch';

const mockRequest = jest.fn();
const mockFind = jest.fn();

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-location', () => ({ requestForegroundPermissionsAsync: jest.fn(), getCurrentPositionAsync: jest.fn(), getLastKnownPositionAsync: jest.fn(), Accuracy: { Balanced: 3 } }));
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

it('lists each of a contact’s addresses as its own choice', async () => {
  const onChange = jest.fn();
  mockFind.mockResolvedValue([
    { id: 'c1:0', name: 'Mum', address: '12 Queen St, Brisbane', label: 'home' },
    { id: 'c1:1', name: 'Mum', address: '1 William St, Brisbane', label: 'work' },
  ]);
  mockRequest.mockImplementation(async (_path: string, opts: { query: { q: string } }) =>
    opts.query.q === '1 William St, Brisbane'
      ? { results: [{ id: 'p2', name: '1 William Street', kind: 'address', description: '', location: [153.03, -27.47] }] }
      : { results: [] },
  );
  await render(<PlaceSearch label="Destination" placeholder="Where to?" value={null} onChange={onChange} />);
  const box = screen.getByLabelText('Destination');
  await fireEvent(box, 'focus');
  await fireEvent.changeText(box, 'mum');
  expect(await screen.findByText('home · 12 Queen St, Brisbane')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('work · 1 William St, Brisbane'));
  await waitFor(() => expect(onChange).toHaveBeenCalledWith({ name: 'Mum', description: '1 William St, Brisbane', location: [153.03, -27.47] }));
});

it('looks the address up near where you are, when that is known', async () => {
  mockFind.mockResolvedValue([{ id: 'c1', name: 'Gran', address: '12 Wellington St, Cleveland QLD 4163', label: null }]);
  mockRequest.mockResolvedValue({ results: [{ id: 'p1', name: '12 Wellington Street', kind: 'address', description: '', location: [153.26, -27.52] }] });
  await render(<PlaceSearch label="Destination" placeholder="Where to?" value={null} onChange={jest.fn()} near={[153.2, -27.5]} />);
  const box = screen.getByLabelText('Destination');
  await fireEvent(box, 'focus');
  await fireEvent.changeText(box, 'gran');
  await fireEvent.press(await screen.findByText('Gran'));
  await waitFor(() =>
    expect(mockRequest).toHaveBeenCalledWith('api/search', { query: { q: '12 Wellington St, Cleveland QLD 4163', lon: 153.2, lat: -27.5, limit: 1 } }),
  );
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

describe('Your location', () => {
  const open = async (onChange = jest.fn()) => {
    await render(<PlaceSearch label="Starting point" placeholder="From" value={null} onChange={onChange} allowCurrentLocation />);
    await fireEvent(screen.getByLabelText('Starting point'), 'focus');
    return onChange;
  };

  it('uses a recent position straight away when the phone has one', async () => {
    jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue({ granted: true } as never);
    jest.mocked(Location.getLastKnownPositionAsync).mockResolvedValue({ coords: { longitude: 153, latitude: -27.5 } } as never);
    const onChange = await open();
    await fireEvent.press(screen.getByText('Your location'));
    expect(onChange).toHaveBeenCalledWith({ name: 'Your location', description: '', location: [153, -27.5] });
    expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it('explains when location is switched off, and keeps the message after the list closes', async () => {
    jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue({ granted: true } as never);
    jest.mocked(Location.getLastKnownPositionAsync).mockResolvedValue(null as never);
    jest.mocked(Location.getCurrentPositionAsync).mockRejectedValue(new Error('Location services are disabled'));
    const onChange = await open();
    await fireEvent.press(screen.getByText('Your location'));
    expect(await screen.findByText(/Couldn’t find where you are/)).toBeOnTheScreen();
    await fireEvent(screen.getByLabelText('Starting point'), 'blur');
    await waitFor(() => expect(screen.queryByText('Your location')).toBeNull());
    expect(screen.getByText(/Couldn’t find where you are/)).toBeOnTheScreen();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('explains a refused permission', async () => {
    jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue({ granted: false } as never);
    await open();
    await fireEvent.press(screen.getByText('Your location'));
    expect(await screen.findByText('Location permission is needed for this.')).toBeOnTheScreen();
  });
});
