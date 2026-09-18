import { placeDetail } from '@wayfinder/shared/australia';
import type { LngLat } from '@wayfinder/shared/geo';
import type { Place } from '@wayfinder/shared/schemas';
import * as Location from 'expo-location';
import { LocateFixed, MapPin, Search, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { api, errorMessage } from '../lib/api';
import { formatDistanceShort } from '../lib/format';
import { radius, space, useTheme } from '../lib/theme';

export interface ChosenPlace {
  name: string;
  description: string;
  location: LngLat;
}

/** What a chosen place keeps: its type and suburb (distance depends on where you start). */
const chosen = (p: Place): ChosenPlace => ({ name: p.name, description: placeDetail({ ...p, distanceM: undefined }, formatDistanceShort), location: p.location });

export function PlaceSearch({ label, placeholder, value, onChange, near, allowCurrentLocation, tone = 'search' }: {
  label: string;
  placeholder: string;
  value: ChosenPlace | null;
  onChange(p: ChosenPlace | null): void;
  near?: LngLat | undefined;
  allowCurrentLocation?: boolean;
  tone?: 'search' | 'start' | 'end';
}) {
  const t = useTheme();
  const [text, setText] = useState(value?.name ?? '');
  const [focused, setFocused] = useState(false);
  const [results, setResults] = useState<Place[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setText(value?.name ?? ''), [value]);

  useEffect(() => {
    const q = text.trim();
    if (!focused || q.length < 2 || q === value?.name) {
      setResults([]);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      api
        .request<{ results: Place[] }>('api/search', { query: { q, lon: near?.[0], lat: near?.[1], limit: 6 }, signal: ctrl.signal })
        .then((r) => {
          setResults(r.results);
          setError(null);
        })
        .catch((e) => {
          if ((e as Error).name !== 'AbortError') setError(errorMessage(e));
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [text, focused, near, value?.name]);

  const Icon = tone === 'search' ? Search : MapPin;
  const iconColor = tone === 'end' ? t.danger : t.text2;
  const choose = (p: ChosenPlace) => {
    onChange(p);
    setFocused(false);
    setResults([]);
  };

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: 48, paddingLeft: space[3], borderRadius: radius.control, backgroundColor: t.surface2, borderWidth: 1, borderColor: focused ? t.accent : 'transparent' }}>
        <Icon size={18} color={iconColor} />
        <TextInput
          accessibilityLabel={label}
          style={{ flex: 1, color: t.text, fontSize: 16, minHeight: 46 }}
          placeholder={placeholder}
          placeholderTextColor={t.text3}
          value={text}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onChangeText={(s) => {
            setText(s);
            if (value) onChange(null);
          }}
          returnKeyType="search"
        />
        {text ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Clear ${label.toLowerCase()}`} onPress={() => { setText(''); onChange(null); }} style={{ padding: space[3] }}>
            <X size={18} color={t.text2} />
          </Pressable>
        ) : null}
      </View>
      {focused && (results.length > 0 || allowCurrentLocation || error) ? (
        <View style={{ marginTop: 4, borderRadius: radius.control, backgroundColor: t.surface, borderWidth: 1, borderColor: t.border }}>
          {allowCurrentLocation ? (
            <Pressable
              accessibilityRole="button"
              style={{ flexDirection: 'row', gap: space[3], padding: space[3] }}
              onPress={async () => {
                const perm = await Location.requestForegroundPermissionsAsync();
                if (!perm.granted) return setError('Location permission is needed for this.');
                const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
                choose({ name: 'Your location', description: '', location: [pos.coords.longitude, pos.coords.latitude] });
              }}
            >
              <LocateFixed size={18} color={t.accent} />
              <Text style={{ color: t.text, fontWeight: '600' }}>Your location</Text>
            </Pressable>
          ) : null}
          {results.map((p) => (
            <Pressable key={p.id} accessibilityRole="button" style={{ flexDirection: 'row', gap: space[3], padding: space[3] }} onPress={() => choose(chosen(p))}>
              <MapPin size={18} color={t.text3} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text, fontWeight: '600' }}>{p.name}</Text>
                <Text style={{ color: t.text2, fontSize: 13 }}>{placeDetail(p, formatDistanceShort)}</Text>
                {p.hours ? <Text style={{ color: p.hours.openNow ? t.explore : t.text2, fontSize: 13, fontWeight: p.hours.openNow ? '600' : '400' }}>{p.hours.label}</Text> : null}
              </View>
            </Pressable>
          ))}
          {error ? <Text style={{ color: t.danger, padding: space[3] }}>{error}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}
