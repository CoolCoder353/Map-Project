import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb } from '../helpers/db.js';

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t?.close();
});

describe('database harness', () => {
  it('migrates and supports the features we rely on', async () => {
    const r = await t.db.query("SELECT gen_random_uuid() AS id, similarity('Canberra', 'Canbera') AS sim");
    expect(r.rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.rows[0].sim).toBeGreaterThan(0.3);
    await expect(t.db.query("INSERT INTO audit_log (action, target_type) VALUES ('x', 'y')")).resolves.toBeTruthy();
    await expect(t.db.query('DELETE FROM audit_log')).rejects.toThrow(/append-only/);
    const up = await t.db.query(
      `INSERT INTO app_state (key, value) VALUES ('k', '1') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value RETURNING (xmax = 0) AS inserted`,
    );
    expect(up.rows[0].inserted).toBe(true);
  });
});
