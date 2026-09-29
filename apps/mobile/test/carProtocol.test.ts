import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { ZodType } from 'zod';
import { CarNavSchema, CarPlacesSchema, CarPlannedSchema, CarPlanSchema, CarRouteLineSchema, CarStatusSchema } from '../src/car/protocol';

const dir = join(__dirname, '../modules/wayfinder-car/android/src/test/resources/fixtures');
const schemaFor: Record<string, ZodType> = {
  'status.json': CarStatusSchema,
  'places.json': CarPlacesSchema,
  'plan.json': CarPlanSchema,
  'planned.json': CarPlannedSchema,
  'route-line.json': CarRouteLineSchema,
  'nav-navigating.json': CarNavSchema,
  'nav-arrived.json': CarNavSchema,
};

it.each(Object.entries(schemaFor))('%s is what the JavaScript side sends', (file, schema) => {
  const parsed = schema.safeParse(JSON.parse(readFileSync(join(dir, file), 'utf8')));
  expect(parsed.error?.issues ?? []).toEqual([]);
});

it('checks every fixture the Kotlin tests read', () => {
  expect(readdirSync(dir).sort()).toEqual(Object.keys(schemaFor).sort());
});
