import type { LngLat, Place } from '@wayfinder/shared';
import { Crosshair, LocateFixed, MapPin, Search, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { currentPosition } from '../lib/geolocation';

export interface ChosenPlace {
  name: string;
  description: string;
  location: LngLat;
}

interface Props {
  label: string;
  placeholder: string;
  value: ChosenPlace | null;
  onChange(place: ChosenPlace | null): void;
  near?: LngLat | undefined;
  /** Offer "Your location" at the top of the suggestions. */
  allowCurrentLocation?: boolean;
  /** Offer "Choose on map"; the parent handles the next map click. */
  onPickOnMap?: (() => void) | undefined;
  autoFocus?: boolean;
  icon?: 'search' | 'start' | 'end';
}

export function SearchField({ label, placeholder, value, onChange, near, allowCurrentLocation, onPickOnMap, autoFocus, icon = 'search' }: Props) {
  const id = useId();
  const [text, setText] = useState(value?.name ?? '');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Place[]>([]);
  const [active, setActive] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => setText(value?.name ?? ''), [value]);

  useEffect(() => {
    const q = text.trim();
    if (!open || q.length < 2 || q === value?.name) {
      setResults([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api<{ results: Place[] }>('/api/search', {
          query: { q, lon: near?.[0], lat: near?.[1], limit: 8 },
          signal: ctrl.signal,
        });
        setResults(res.results);
        // Highlight the first search result, not the fixed options above it.
        setActive(res.results.length ? (allowCurrentLocation ? 1 : 0) + (onPickOnMap ? 1 : 0) : -1);
        setError(null);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setError(errorMessage(err));
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, open, near, value?.name]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const choose = (p: ChosenPlace) => {
    onChange(p);
    setText(p.name);
    setOpen(false);
  };

  const useMyLocation = async () => {
    setLoading(true);
    try {
      const loc = await currentPosition();
      choose({ name: 'Your location', description: '', location: loc });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const extras = [
    ...(allowCurrentLocation ? [{ key: 'me', label: 'Your location', icon: LocateFixed, run: useMyLocation }] : []),
    ...(onPickOnMap ? [{ key: 'map', label: 'Choose on map', icon: Crosshair, run: () => { setOpen(false); onPickOnMap(); } }] : []),
  ];
  const total = extras.length + results.length;

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (total ? (a + 1) % total : -1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (total ? (a - 1 + total) % total : -1));
    } else if (e.key === 'Enter' && open && active >= 0) {
      e.preventDefault();
      if (active < extras.length) void extras[active]!.run();
      else {
        const p = results[active - extras.length]!;
        choose({ name: p.name, description: p.description, location: p.location });
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const LeadIcon = icon === 'search' ? Search : MapPin;
  return (
    <div className="search" ref={wrap}>
      <label className="visually-hidden" htmlFor={id}>
        {label}
      </label>
      <div className={`search-box search-box-${icon}`}>
        <LeadIcon aria-hidden className="search-lead" />
        <input
          id={id}
          className="search-input"
          role="combobox"
          aria-expanded={open && total > 0}
          aria-controls={`${id}-list`}
          aria-activedescendant={open && active >= 0 ? `${id}-opt-${active}` : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          placeholder={placeholder}
          value={text}
          autoFocus={autoFocus}
          onClick={() => setOpen(true)}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            if (value) onChange(null);
          }}
          onKeyDown={onKeyDown}
        />
        {loading ? (
          <span className="spinner search-trail" aria-label="Searching" />
        ) : text ? (
          <button
            type="button"
            className="icon-btn search-trail"
            aria-label={`Clear ${label.toLowerCase()}`}
            onClick={() => {
              setText('');
              onChange(null);
              setOpen(true);
            }}
          >
            <X />
          </button>
        ) : null}
      </div>
      {open && (total > 0 || error) && (
        <ul className="search-list" id={`${id}-list`} role="listbox" aria-label={`${label} suggestions`}>
          {extras.map((x, i) => (
            <li
              key={x.key}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={active === i}
              className="search-option"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void x.run()}
            >
              <x.icon aria-hidden />
              <span className="search-option-name">{x.label}</span>
            </li>
          ))}
          {results.map((p, i) => {
            const idx = i + extras.length;
            return (
              <li
                key={p.id}
                id={`${id}-opt-${idx}`}
                role="option"
                aria-selected={active === idx}
                className="search-option"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose({ name: p.name, description: p.description, location: p.location })}
              >
                <MapPin aria-hidden />
                <span>
                  <span className="search-option-name">{p.name}</span>
                  {p.description && <span className="search-option-desc">{p.description}</span>}
                </span>
              </li>
            );
          })}
          {error && <li className="search-error">{error}</li>}
        </ul>
      )}
    </div>
  );
}
