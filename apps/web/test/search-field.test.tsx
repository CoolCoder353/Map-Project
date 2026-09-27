import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type ChosenPlace, SearchField } from '../src/components/SearchField';
import { apiError } from './fakeApi';
import { place } from './fixtures';
import { renderApp } from './harness';

const onChange = vi.fn();
const onPickOnMap = vi.fn();

function Field(props: { allowCurrentLocation?: boolean; pick?: boolean; initial?: ChosenPlace | null }) {
  const [value, setValue] = useState<ChosenPlace | null>(props.initial ?? null);
  return (
    <SearchField
      label="Destination"
      placeholder="Where to?"
      value={value}
      near={[153, -27.5]}
      allowCurrentLocation={props.allowCurrentLocation}
      onPickOnMap={props.pick ? onPickOnMap : undefined}
      onChange={(p) => {
        onChange(p);
        setValue(p);
      }}
    />
  );
}

const results = [
  place(),
  place({ id: 'p-2', name: 'Gumdale Tavern', typeLabel: 'Pub', description: 'Pub', hours: { openNow: true, label: 'Open until 10 pm' }, distanceM: 1200 }),
];

afterEach(() => {
  delete (navigator as { geolocation?: unknown }).geolocation;
});

describe('SearchField', () => {
  it('searches near a point after two characters and chooses with the mouse', async () => {
    const { api } = await renderApp(<Field />, { path: '/', api: { 'GET /api/search': () => ({ results }) } });
    const box = screen.getByRole('combobox', { name: 'Destination' });
    await userEvent.type(box, 'g');
    await new Promise((r) => setTimeout(r, 250));
    expect(api.calls('GET /api/search')).toHaveLength(0);
    await userEvent.type(box, 'um');
    const tavern = await screen.findByRole('option', { name: /Gumdale Tavern/ });
    expect(tavern).toHaveTextContent('Open until 10 pm');
    const q = api.calls('GET /api/search').at(-1)!.query;
    expect(Object.fromEntries(q)).toMatchObject({ q: 'gum', lon: '153', lat: '-27.5', limit: '8' });
    await userEvent.click(tavern);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Gumdale Tavern', location: [153.15, -27.49], hours: { openNow: true, label: 'Open until 10 pm' } }));
    expect(box).toHaveValue('Gumdale Tavern');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('works from the keyboard: arrows move, Enter chooses, Escape closes', async () => {
    await renderApp(<Field allowCurrentLocation pick />, { path: '/', api: { 'GET /api/search': () => ({ results }) } });
    const box = screen.getByRole('combobox', { name: 'Destination' });
    await userEvent.type(box, 'gum');
    await screen.findByRole('option', { name: /Gumdale Tavern/ });
    // The first search result is highlighted, not the fixed options above it.
    expect(screen.getByRole('option', { name: /Gumdale State School/ })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: /Gumdale Tavern/ })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: 'Your location' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowUp}{ArrowUp}{Enter}');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Gumdale State School' }));
    await userEvent.clear(box);
    await userEvent.type(box, 'gu');
    await screen.findByRole('listbox');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('offers your location and choose-on-map', async () => {
    Object.defineProperty(navigator, 'geolocation', {
      value: { getCurrentPosition: (ok: PositionCallback) => ok({ coords: { longitude: 153.3, latitude: -27.3 } } as GeolocationPosition) },
      configurable: true,
    });
    await renderApp(<Field allowCurrentLocation pick />, { path: '/' });
    const box = screen.getByRole('combobox', { name: 'Destination' });
    await userEvent.click(box);
    await userEvent.click(screen.getByRole('option', { name: 'Your location' }));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ name: 'Your location', description: '', location: [153.3, -27.3] }));
    await userEvent.click(box);
    await userEvent.click(screen.getByRole('option', { name: 'Choose on map' }));
    expect(onPickOnMap).toHaveBeenCalled();
  });

  it('says why your location is unavailable', async () => {
    await renderApp(<Field allowCurrentLocation />, { path: '/' });
    await userEvent.click(screen.getByRole('combobox', { name: 'Destination' }));
    await userEvent.click(screen.getByRole('option', { name: 'Your location' }));
    expect(await screen.findByText('Location is not available in this browser')).toBeInTheDocument();
  });

  it('shows search errors in the list', async () => {
    await renderApp(<Field />, { path: '/', api: { 'GET /api/search': () => apiError(503, 'unavailable', 'Search is warming up') } });
    await userEvent.type(screen.getByRole('combobox', { name: 'Destination' }), 'gum');
    expect(await screen.findByText('Search is warming up')).toBeInTheDocument();
  });

  it('clears the chosen place', async () => {
    await renderApp(<Field initial={{ name: 'Home', description: '', location: [153, -27] }} />, { path: '/' });
    expect(screen.getByRole('combobox', { name: 'Destination' })).toHaveValue('Home');
    await userEvent.click(screen.getByRole('button', { name: 'Clear destination' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole('combobox', { name: 'Destination' })).toHaveValue('');
  });

  it('closes when you click elsewhere', async () => {
    await renderApp(
      <div>
        <Field allowCurrentLocation />
        <button type="button">elsewhere</button>
      </div>,
      { path: '/' },
    );
    await userEvent.click(screen.getByRole('combobox', { name: 'Destination' }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'elsewhere' }));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
