import { type SavedPlace, SavedPlaceSchema } from '@wayfinder/shared/schemas';
import { useQueryClient } from '@tanstack/react-query';
import { Briefcase, Check, Home, Star } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';
import { api, errorMessage } from '../lib/api';
import { space, useTheme } from '../lib/theme';
import type { ChosenPlace } from './PlaceSearch';
import { Button, Field, Notice, Small } from './kit';

/** Names offered with one tap; anything else can be typed. */
const QUICK = [
  { name: 'Home', icon: Home },
  { name: 'Work', icon: Briefcase },
];

/**
 * Saves a chosen place under a name of your own, so typing that name in any search finds it
 * first ("Home", "Work"). Saving under a name already used moves that place.
 */
export function SavePlace({ place }: { place: ChosenPlace }) {
  const t = useTheme();
  const queries = useQueryClient();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedPlace | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async (as: string) => {
    if (busy || !as.trim()) return;
    setBusy(as);
    setError(null);
    try {
      const res = await api.request('api/saved-places', { method: 'POST', body: { name: as.trim(), description: [place.name, place.description].filter(Boolean).join(', ').slice(0, 300), location: place.location }, schema: SavedPlaceSchema });
      setSaved(res);
      setNaming(false);
      void queries.invalidateQueries({ queryKey: ['saved-places'] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  if (saved) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }} accessibilityLiveRegion="polite">
        <Check size={16} color={t.explore} />
        <Small color={t.text}>Saved as {saved.name}. Type “{saved.name}” in any search to find it.</Small>
      </View>
    );
  }
  return (
    <View style={{ gap: space[2] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space[2] }}>
        <Small>Save this place as</Small>
        {QUICK.map((q) => (
          <Button key={q.name} label={q.name} icon={q.icon} kind="secondary" compact busy={busy === q.name} disabled={!!busy} onPress={() => void save(q.name)} />
        ))}
        <Button label="Other…" icon={Star} kind="ghost" compact disabled={!!busy} onPress={() => setNaming((n) => !n)} />
      </View>
      {naming ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space[2] }}>
          <View style={{ flex: 1 }}>
            <Field label="Name for this place" value={name} onChangeText={setName} maxLength={60} placeholder="Gym, Mum’s, School" returnKeyType="done" onSubmitEditing={() => void save(name)} />
          </View>
          <Button label="Save" compact busy={!!busy} disabled={!name.trim()} onPress={() => void save(name)} />
        </View>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
    </View>
  );
}

/** A place chosen from search that is already one of your saved places. */
export const isSavedPlace = (p: ChosenPlace) => p.description.startsWith('Saved place');
