import { z } from 'zod';
import { LngLatSchema } from './common.js';

/** A place someone saved under a name of their own ("Home", "Work"). */
export const SavedPlaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** What the place is: the address or the place's own name and suburb, as it was chosen. */
  description: z.string(),
  location: LngLatSchema,
  createdAt: z.string(),
});
export type SavedPlace = z.infer<typeof SavedPlaceSchema>;

/** Saving under a name already used (any capitals) moves that place. */
export const SavedPlaceSaveSchema = z.object({
  name: z.string().trim().min(1, 'Give it a name').max(60),
  description: z.string().trim().max(300).default(''),
  location: LngLatSchema,
});
export type SavedPlaceSave = z.infer<typeof SavedPlaceSaveSchema>;

export const SavedPlaceListSchema = z.object({ items: z.array(SavedPlaceSchema) });

/** How many places one person can save. */
export const MAX_SAVED_PLACES = 50;

/** Search results that are saved places carry this kind, and ids starting `saved:`. */
export const SAVED_PLACE_KIND = 'saved';
