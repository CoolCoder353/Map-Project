// The SDK 57 package's main entry is a new API whose old-style functions throw when called; the
// functions this file uses live on in the legacy entry point.
import * as Contacts from 'expo-contacts/legacy';
import * as SecureStore from 'expo-secure-store';

const KEY = 'wf.contactsSearch';

/** Contacts search is off until the user turns it on; the phone then asks for permission. */
export async function contactsSearchEnabled(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(KEY)) === 'on';
  } catch {
    return false;
  }
}

/** Turning it on asks for contacts permission; returns whether it is on afterwards. */
export async function setContactsSearchEnabled(on: boolean): Promise<boolean> {
  if (!on) {
    await SecureStore.setItemAsync(KEY, 'off');
    return false;
  }
  const { granted } = await Contacts.requestPermissionsAsync();
  await SecureStore.setItemAsync(KEY, granted ? 'on' : 'off');
  return granted;
}

export interface ContactMatch {
  id: string;
  name: string;
  /** The address as written in the contact, e.g. "12 Queen St, Brisbane". */
  address: string;
  label: string | null;
}

const addressText = (a: Contacts.Address): string =>
  [a.street, a.city, a.region, a.postalCode].map((s) => s?.trim()).filter(Boolean).join(', ');

/**
 * Contacts whose name matches and who have an address. Reading happens on the phone; only the
 * address text of a contact the user picks is ever sent to the server, to be located.
 */
export async function findContacts(query: string, limit = 4): Promise<ContactMatch[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  try {
    if (!(await contactsSearchEnabled())) return [];
    const { granted } = await Contacts.getPermissionsAsync();
    if (!granted) return [];
    const { data } = await Contacts.getContactsAsync({ name: q, fields: [Contacts.Fields.Addresses, Contacts.Fields.Name] });
    const out: ContactMatch[] = [];
    for (const c of data) {
      if (!c.name) continue;
      // Every address the contact has (home, work…), each once; the label tells them apart.
      const seen = new Set<string>();
      for (const [i, a] of (c.addresses ?? []).entries()) {
        const address = addressText(a);
        if (!address || seen.has(address.toLowerCase())) continue;
        seen.add(address.toLowerCase());
        out.push({ id: `${c.id}:${i}`, name: c.name, address, label: a.label ?? null });
        if (out.length >= limit) return out;
      }
    }
    return out;
  } catch {
    return [];
  }
}
