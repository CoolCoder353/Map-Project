import { AU_STATES } from './australia.js';
import { expandAbbreviations } from './categories.js';

/** A query that reads as a postal address, split into the part that names the place and where it is. */
export interface AddressQuery {
  /** "12 Wellington St", as typed. */
  name: string;
  /** Suburb or town, lower case, or null when none was given. */
  locality: string | null;
  postcode: string | null;
}

const STATE_WORDS = new Set(Object.entries(AU_STATES).flatMap(([abbr, s]) => [abbr.toLowerCase(), s.name.toLowerCase()]));
const STREET_TYPES = new Set(
  'street road avenue drive parade crescent place highway court terrace circuit close grove lane boulevard esplanade square way walk row rise loop mews promenade track'.split(' '),
);

/**
 * Read "12 Wellington St, Cleveland QLD 4163" (or the same over several lines, as a phone contact
 * keeps it) as an address: "12 Wellington St" in Cleveland, 4163. Without a comma, a state or a
 * postcode it isn't treated as one, so "Main Street" or "Woolworths Cleveland" search as before.
 */
export function splitAddress(raw: string): AddressQuery | null {
  let text = raw.replace(/\s*[\r\n]+\s*/g, ', ').replace(/,?\s*australia\s*$/i, '').trim();
  let postcode: string | null = null;
  const pc = /[\s,]+(\d{4})$/.exec(text);
  if (pc) {
    postcode = pc[1]!;
    text = text.slice(0, pc.index);
  }
  let state = false;
  for (const words of [3, 2, 1]) {
    const m = new RegExp(`[\\s,]+((?:\\S+\\s+){${words - 1}}\\S+)$`).exec(text);
    if (m && STATE_WORDS.has(m[1]!.toLowerCase())) {
      state = true;
      text = text.slice(0, m.index);
      break;
    }
  }
  const parts = text.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length > 1) return { name: parts[0]!, locality: parts[1]!.toLowerCase(), postcode };
  if (!state && !postcode) return null;
  // "12 Wellington St Cleveland": the suburb follows the street type.
  const words = parts[0]!.split(/\s+/);
  const expanded = expandAbbreviations(parts[0]!).toLowerCase().split(/\s+/);
  const typeAt = expanded.findLastIndex((w, i) => i > 0 && i < expanded.length - 1 && STREET_TYPES.has(w));
  if (typeAt < 0) return { name: parts[0]!, locality: null, postcode };
  return { name: words.slice(0, typeAt + 1).join(' '), locality: words.slice(typeAt + 1).join(' ').toLowerCase(), postcode };
}
