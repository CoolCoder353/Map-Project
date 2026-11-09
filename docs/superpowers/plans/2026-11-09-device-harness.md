# Device Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pnpm device …` commands that screenshot, tap, type, set GPS and replay drives on the user's phone (with the Android Auto Desktop Head Unit) or the emulator, safely, on a test account whose drives never reach shared data or the user's own account.

**Architecture:** Three parts. (1) Server: a `test_account` flag on users that the learning jobs skip, switched on in `/admin`. (2) App: the upload queue records which account each point belongs to, and a log line says when the car screen shows Wayfinder. (3) Harness: a TypeScript CLI in `scripts/device/` that builds every adb command in one place, guards each action, and drives the DHU through a FIFO on its stdin.

**Tech Stack:** TypeScript (Node 24, tsx), Vitest, PGlite, React + Testing Library, React Native + Jest, Kotlin + Robolectric/JUnit, adb, DHU 2.0.

**Spec:** `docs/superpowers/specs/2026-11-09-device-harness-design.md`

## Global Constraints

- Every change comes with tests in the same commit; `pnpm check` passes before anything is called done. Never skip, delete or weaken a test, or lower a coverage floor (CLAUDE.md, docs/testing.md).
- Coordinates are `[lon, lat]` everywhere in code (the DHU's `location` command and Android's `--location` take lat first; convert only at that boundary).
- Migrations are append-only: the new one is `packages/core/src/db/migrations/011_test_accounts.sql`.
- Commit to `master`, no branches. Commit messages: short subject, then prose on what was wrong and why the change fixes it, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Play: internal testing track only (`pnpm play upload`). Never `--track closed`, `pnpm play promote`, or any other track without asking.
- The harness never installs, uninstalls or clears anything on a real phone, never taps outside Wayfinder (and its permission prompts), never taps Sign out or Delete account (only `down` signs out), and only acts while the app is signed in to the configured test account.
- Claude never types, stores or sees the test account's password. The user creates the account and signs it in.
- User-facing words: plain, specific, no jargon.
- Non-interactive shells: `CI=true pnpm install`.

---

### Task 1: Test accounts in the database, left out of learning

**Files:**
- Create: `packages/core/src/db/migrations/011_test_accounts.sql`
- Modify: `packages/core/src/services/users.ts` (`UserRow`)
- Modify: `packages/core/src/services/road-speeds.ts:150-158`
- Modify: `packages/core/src/services/light-timing.ts:388-390`
- Test: `packages/core/test/integration/road-facts.test.ts`

**Interfaces:**
- Produces: column `users.test_account boolean NOT NULL DEFAULT false`; `UserRow.test_account: boolean`.

- [ ] **Step 1: Write the failing tests**

In `packages/core/test/integration/road-facts.test.ts`, in `it('goes only by drives that still stand', …)`, add before the closing `});` (after the last `expect(await rebuilt()).toBe(1);`):

```ts
    // A test account's drives (an admin's second account, the device harness) don't count either.
    await t.db.query(`UPDATE users SET test_account = true WHERE id = ${neighbour}`);
    expect(await rebuilt()).toBe(0);
    await t.db.query(`UPDATE users SET test_account = false WHERE id = ${neighbour}`);
    expect(await rebuilt()).toBe(1);
```

In `it('times each drive through them, …', …)`, insert just before the line `// The second person's drives deleted: one person alone doesn't set it.`:

```ts
    // The second person a test account: their drives don't count, so one person is left.
    await t.db.query('UPDATE users SET test_account = true WHERE id = $1', [b.id]);
    expect(await lightTiming.rebuildLightTimings(t.db)).toMatchObject({ lights: 0 });
    await t.db.query('UPDATE users SET test_account = false WHERE id = $1', [b.id]);
    expect(await lightTiming.rebuildLightTimings(t.db)).toMatchObject({ lights: 1 });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run packages/core/test/integration/road-facts.test.ts`
Expected: FAIL, `column "test_account" does not exist`.

- [ ] **Step 3: Add the migration**

`packages/core/src/db/migrations/011_test_accounts.sql`:

```sql
-- Accounts used to test the apps: an admin's second account, or the device harness's. Their drives
-- still make trips and coverage for that account, but don't count towards what is learned from
-- everyone's drives (road speeds, waits at lights), so testing never changes anyone's routes.
ALTER TABLE users ADD COLUMN test_account boolean NOT NULL DEFAULT false;
```

- [ ] **Step 4: Leave test accounts out of both jobs**

`packages/core/src/services/users.ts`, in `interface UserRow`, after `deleted_at: Date | null;`:

```ts
  test_account: boolean;
```

`packages/core/src/services/road-speeds.ts`, in `rebuildRoadSpeeds`, change the users join to:

```ts
       JOIN users u ON u.id = t.user_id AND u.deleted_at IS NULL AND u.disabled_at IS NULL AND NOT u.test_account
```

and in its doc comment change "nor a deleted or disabled account's" to "nor a deleted, disabled or test account's".

`packages/core/src/services/light-timing.ts`, in `rebuildLightTimings`, change the users join the same way:

```ts
     JOIN users u ON u.id = t.user_id AND u.deleted_at IS NULL AND u.disabled_at IS NULL AND NOT u.test_account`,
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run packages/core/test/integration/road-facts.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/db/migrations/011_test_accounts.sql packages/core/src/services/users.ts packages/core/src/services/road-speeds.ts packages/core/src/services/light-timing.ts packages/core/test/integration/road-facts.test.ts
git commit -m "Leave test accounts' drives out of learned speeds and light timings" -m "Road speeds and waits at lights are learned once two people's drives agree. A second account used for testing, such as the device harness replaying a drive on the beta testers' server, would count as a second person and change everyone's routes. A test_account flag on users now keeps those drives out, as deleted and disabled accounts already are." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Admins mark test accounts (API)

**Files:**
- Modify: `packages/shared/src/schemas/admin.ts:5-35`
- Modify: `packages/core/src/services/admin.ts:25-36,108-150`
- Test: `packages/core/test/integration/admin.test.ts`
- Test: `apps/api/test/integration/admin-api.test.ts:32`
- Modify: `apps/web/test/fixtures.ts:202-215` (the fixture must satisfy the schema)

**Interfaces:**
- Consumes: `UserRow.test_account` (Task 1).
- Produces: `AdminUser.testAccount: boolean`; `AdminUpdateUserSchema` accepts `testAccount?: boolean`; `updateUserAsAdmin(db, actor, userId, { testAccount })`; audit action `user.test_account_change` with `details: { testAccount }`.

- [ ] **Step 1: Write the failing tests**

Append inside `describe('admin service guardrails', …)` in `packages/core/test/integration/admin.test.ts`:

```ts
  it('marks a test account, audited once, without signing it out, and not on yourself', async () => {
    const lead = await makeUser(t.db, 'harness-lead@example.com', 'admin');
    const harness = await makeUser(t.db, 'harness@example.com', 'admin');
    const session = await auth.login(t.db, tokens, harness.email, 'test password 123', null);
    const actor = { id: lead.id, ip: null };

    const marked = await admin.updateUserAsAdmin(t.db, actor, harness.id, { testAccount: true });
    expect(marked).toMatchObject({ testAccount: true, role: 'admin' });
    const [entry] = await admin.listAudit(t.db, { targetId: harness.id, limit: 10 });
    expect(entry).toMatchObject({ action: 'user.test_account_change', actorEmail: 'harness-lead@example.com', details: { testAccount: true } });

    // Asking again for what it already is changes and records nothing.
    const n = await auditCount();
    await admin.updateUserAsAdmin(t.db, actor, harness.id, { testAccount: true });
    expect(await auditCount()).toBe(n);
    // Still signed in: unlike a role change, nothing in their tokens depends on it.
    await expect(auth.refresh(t.db, tokens, session.tokens.refreshToken, null)).resolves.toBeTruthy();

    expect((await admin.updateUserAsAdmin(t.db, actor, harness.id, { testAccount: false })).testAccount).toBe(false);
    await expect(admin.updateUserAsAdmin(t.db, { id: harness.id, ip: null }, harness.id, { testAccount: true })).rejects.toMatchObject({ statusCode: 403 });
  });
```

In `apps/api/test/integration/admin-api.test.ts`, after the line `{ method: 'PATCH', url: () => \`/api/admin/users/${target.id}\`, body: () => ({ disabled: false }), mutation: true },` add:

```ts
  { method: 'PATCH', url: () => `/api/admin/users/${target.id}`, body: () => ({ testAccount: false }), mutation: true },
```

(That table already checks every admin route refuses non-admins and devs; this adds the new field to it.)

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run packages/core/test/integration/admin.test.ts apps/api/test/integration/admin-api.test.ts`
Expected: FAIL; `testAccount` is undefined on the result, and the API answers 400 "Nothing to update".

- [ ] **Step 3: Schema**

`packages/shared/src/schemas/admin.ts`: in `AdminUserSchema` after `deletedAt: z.string().nullable(),` add:

```ts
  /** Its drives don't count towards learned road speeds or light timings. */
  testAccount: z.boolean(),
```

Replace `AdminUpdateUserSchema` with:

```ts
export const AdminUpdateUserSchema = z
  .object({
    role: RoleSchema.optional(),
    disabled: z.boolean().optional(),
    testAccount: z.boolean().optional(),
    /** Type-to-confirm: must equal the target user's email for role changes. */
    confirm: z.string().optional(),
  })
  .refine((v) => v.role !== undefined || v.disabled !== undefined || v.testAccount !== undefined, 'Nothing to update');
```

- [ ] **Step 4: Service**

`packages/core/src/services/admin.ts`, in `toAdminUser` after `deletedAt: iso(r.deleted_at),`:

```ts
  testAccount: r.test_account,
```

Change the `patch` parameter type of `updateUserAsAdmin` to:

```ts
  patch: { role?: Role | undefined; disabled?: boolean | undefined; testAccount?: boolean | undefined; confirm?: string | undefined },
```

and, inside the transaction after the `if (patch.disabled !== undefined …) { … }` block, add:

```ts
    if (patch.testAccount !== undefined && patch.testAccount !== target.test_account) {
      await tx.query('UPDATE users SET test_account = $2 WHERE id = $1', [target.id, patch.testAccount]);
      await audit(tx, {
        actorId: actor.id,
        action: 'user.test_account_change',
        targetType: 'user',
        targetId: target.id,
        details: { testAccount: patch.testAccount },
        ip: actor.ip,
      });
    }
```

- [ ] **Step 5: Web fixture**

`apps/web/test/fixtures.ts`, in `adminUser`, after `deletedAt: null,` add `testAccount: false,`.

- [ ] **Step 6: Run the tests to see them pass**

Run: `npx vitest run packages/core/test/integration/admin.test.ts apps/api/test/integration/admin-api.test.ts apps/web/test/admin-management.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/schemas/admin.ts packages/core/src/services/admin.ts packages/core/test/integration/admin.test.ts apps/api/test/integration/admin-api.test.ts apps/web/test/fixtures.ts
git commit -m "Let admins mark an account as a test account" -m "The learning jobs now skip test accounts, but nothing could set the flag. The admin user PATCH takes testAccount, records the change in the audit log, and the admin user answers say which accounts are test accounts. An admin can't mark themselves, as with role and status." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Test account switch in /admin

**Files:**
- Modify: `apps/web/src/admin/pages/UserDetailPage.tsx:67-80,101-130`
- Modify: `apps/web/src/admin/pages/UsersPage.tsx:51`
- Test: `apps/web/test/admin-management.test.tsx`

**Interfaces:**
- Consumes: `AdminUser.testAccount`, `PATCH /api/admin/users/:id` with `{ testAccount }` (Task 2).

- [ ] **Step 1: Write the failing tests**

In `apps/web/test/admin-management.test.tsx`, in `describe('Users', …)`'s first test, add a fourth user to `users`: `adminUser({ id: 'u-5', email: 'harness@example.test', role: 'admin', testAccount: true })`, and after the existing row expectations add:

```ts
    expect(rows[4]).toHaveTextContent('Admin · Test account');
    expect(rows[1]).not.toHaveTextContent('Test account');
```

Append inside `describe('User detail', …)`:

```ts
  it('marks and unmarks a test account', async () => {
    const { api } = await open({ 'PATCH /api/admin/users/u-2': () => ({ ok: true }) });
    expect(await screen.findByText('Test account')).toBeInTheDocument();
    expect(screen.getByText('No')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Mark as test account/ }));
    expect(await screen.findByText('Marked as a test account. Its drives no longer count towards learned speeds or light timings.')).toBeInTheDocument();
    expect(api.calls('PATCH /api/admin/users/u-2')[0]!.body).toEqual({ testAccount: true });
  });

  it('shows a test account and turns it back into an ordinary one', async () => {
    const { api } = await open({
      'GET /api/admin/users/u-2': () => adminUserDetail({ testAccount: true }),
      'PATCH /api/admin/users/u-2': () => ({ ok: true }),
    });
    expect(await screen.findByText('Yes: its drives don’t count towards learned speeds or light timings')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Not a test account/ }));
    expect(await screen.findByText('No longer a test account.')).toBeInTheDocument();
    expect(api.calls('PATCH /api/admin/users/u-2')[0]!.body).toEqual({ testAccount: false });
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run apps/web/test/admin-management.test.tsx`
Expected: FAIL; no "Test account" text or button.

- [ ] **Step 3: Users list**

`apps/web/src/admin/pages/UsersPage.tsx`, replace the role cell with:

```tsx
                  <td>{u.role === 'user' ? 'User' : u.role === 'dev' ? 'Dev' : 'Admin'}{u.testAccount ? ' · Test account' : ''}</td>
```

- [ ] **Step 4: User page**

`apps/web/src/admin/pages/UserDetailPage.tsx`:

Add `FlaskConical` to the `lucide-react` import.

Change the `simple` mutation's kinds and handlers:

```tsx
  const simple = useMutation({
    mutationFn: (kind: 'enable' | 'revoke' | 'reset' | 'restore' | 'rebuild' | 'test' | 'untest') => {
      if (kind === 'enable') return api(`/api/admin/users/${id}`, { method: 'PATCH', body: { disabled: false } });
      if (kind === 'test' || kind === 'untest') return api(`/api/admin/users/${id}`, { method: 'PATCH', body: { testAccount: kind === 'test' } });
      if (kind === 'revoke') return api(`/api/admin/users/${id}/revoke-sessions`, { method: 'POST' });
      if (kind === 'restore') return api(`/api/admin/users/${id}/restore`, { method: 'POST' });
      if (kind === 'rebuild') return api(`/api/admin/users/${id}/coverage/rebuild`, { method: 'POST' });
      return api<{ url: string }>(`/api/admin/users/${id}/reset-password-link`, { method: 'POST' });
    },
    onSuccess: (data, kind) => {
      if (kind === 'reset') setResetLink((data as { url: string }).url);
      else
        toast(
          {
            enable: 'Account enabled.',
            revoke: 'All sessions signed out.',
            restore: 'Account restored.',
            rebuild: 'Coverage rebuild queued.',
            test: 'Marked as a test account. Its drives no longer count towards learned speeds or light timings.',
            untest: 'No longer a test account.',
          }[kind],
        );
      invalidate();
    },
    onError: (e) => toast(errorMessage(e)),
  });
```

In the `kv-grid`, after the Role row:

```tsx
                <div><dt>Test account</dt><dd>{u.testAccount ? 'Yes: its drives don’t count towards learned speeds or light timings' : 'No'}</dd></div>
```

In the active-account `action-row`, after the Disable/Enable button:

```tsx
                  <button type="button" className="btn btn-secondary btn-sm" disabled={self} onClick={() => simple.mutate(u.testAccount ? 'untest' : 'test')}>
                    <FlaskConical aria-hidden /> {u.testAccount ? 'Not a test account' : 'Mark as test account'}
                  </button>
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run apps/web/test/admin-management.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/admin/pages/UserDetailPage.tsx apps/web/src/admin/pages/UsersPage.tsx apps/web/test/admin-management.test.tsx
git commit -m "Show and switch test accounts in /admin" -m "Admins had no way to see or set the new test account flag. The user page says whether an account is one and what that means, with a button to switch it; the users list marks them." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Upload queue tied to the account

**Files:**
- Create: `apps/mobile/src/lib/account.ts`
- Modify: `apps/mobile/src/lib/api.ts:27`
- Modify: `apps/mobile/src/tracking/queue.ts` (`QueueStore`, `flushQueue`, `MemoryQueueStore`)
- Modify: `apps/mobile/src/tracking/sqliteStore.ts`
- Modify: `apps/mobile/src/tracking/sync.ts`
- Modify: `apps/mobile/src/tracking/background.ts:12-35`
- Modify: `apps/mobile/src/nav/navigationService.ts:366-378`
- Modify: `apps/mobile/src/lib/session.tsx:77`
- Test: `apps/mobile/test/queue.test.ts` (Vitest)
- Test: `apps/mobile/test/tracking.native.test.tsx`, `apps/mobile/test/device.native.test.tsx` (Jest)
- Modify (mocks only): `apps/mobile/test/navigation-service.native.test.tsx`, `apps/mobile/test/turn-by-turn.native.test.tsx`, `apps/mobile/test/car-test-drive.native.test.tsx`

**Interfaces:**
- Produces:
  - `apps/mobile/src/lib/account.ts`: `currentAccountId(): Promise<string | null>`, `cachedAccountId(): string | null`, `setCurrentAccountId(id: string | null): Promise<void>`.
  - `QueueStore.append(points: QueuedPoint[], accountId: string)`, `claim(limit, newBatchId, accountId: string)`, `complete(batchId)`, `count(accountId?: string)`.
  - `flushQueue(store, upload, newBatchId, accountId: string, opts?)`.
  - Points queued before this version (no account) belong to whoever is signed in when they're uploaded.

- [ ] **Step 1: Write the failing Vitest tests**

Append to `apps/mobile/test/queue.test.ts` inside `describe('tracking queue', …)`:

```ts
  it('uploads only the signed-in account’s points, leaving another’s until it signs in again', async () => {
    const store = new MemoryQueueStore();
    await store.append([pt(0), pt(1)], 'test-account');
    await store.append([pt(2)], 'owner');
    const sent: Array<{ who: string; n: number }> = [];
    const as = (who: string) => flushQueue(store, async (req) => void sent.push({ who, n: req.points.length }), ids, who);

    // The phone's owner signs in after the test account signed out: none of its points go up as theirs.
    expect(await as('owner')).toMatchObject({ uploaded: 1, remaining: 0 });
    expect(sent).toEqual([{ who: 'owner', n: 1 }]);
    expect(await store.count()).toBe(2); // the test account's, still waiting
    // The test account signs in again later and gets its own.
    expect(await as('test-account')).toMatchObject({ uploaded: 2, remaining: 0 });
    expect(await store.count()).toBe(0);
  });

  it('keeps a batch claimed by one account away from another', async () => {
    const store = new MemoryQueueStore();
    await store.append([pt(0)], 'a');
    await store.append([pt(1)], 'b');
    const claimed = await store.claim(10, ids, 'a');
    expect(claimed!.points).toHaveLength(1);
    // 'a' signed out before its upload finished; 'b' gets its own point, not 'a''s claimed batch.
    const forB = await store.claim(10, ids, 'b');
    expect(forB!.batchId).not.toBe(claimed!.batchId);
    expect(forB!.points[0]!.lon).toBe(pt(1).lon);
  });
```

Also update every existing call in that file: `store.append(points)` → `store.append(points, 'u1')`, and `flushQueue(store, upload, ids)` / `flushQueue(store, upload, ids, opts)` → `flushQueue(store, upload, ids, 'u1')` / `flushQueue(store, upload, ids, 'u1', opts)`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run apps/mobile/test/queue.test.ts`
Expected: FAIL; the owner's flush uploads all three points.

- [ ] **Step 3: Queue and memory store**

`apps/mobile/src/tracking/queue.ts`: replace the `QueueStore` interface with:

```ts
/**
 * Durable point queue. A batch id is assigned when points are claimed and kept until the
 * upload succeeds, so retries reuse the same id and the server de-duplicates them.
 * Each point belongs to the account signed in when it was recorded, and only that account
 * uploads it: points recorded on one account are never sent as another's after a switch.
 */
export interface QueueStore {
  append(points: QueuedPoint[], accountId: string): Promise<void>;
  /** Return this account's pending claimed batch, or claim up to `limit` of its points sharing one group key. */
  claim(limit: number, newBatchId: () => string, accountId: string): Promise<ClaimedBatch | null>;
  complete(batchId: string): Promise<void>;
  /** Points waiting: this account's, or everyone's. */
  count(accountId?: string): Promise<number>;
}
```

Change `flushQueue`'s signature and its two store calls:

```ts
export async function flushQueue(
  store: QueueStore,
  upload: (req: TrackBatchRequest) => Promise<void>,
  newBatchId: () => string,
  accountId: string,
  opts: { batchSize?: number; maxBatches?: number } = {},
): Promise<FlushResult> {
```

with `const batch = await store.claim(batchSize, newBatchId, accountId);` and `return { uploaded, batches, remaining: await store.count(accountId), dropped, error };`.

Replace `MemoryQueueStore` with:

```ts
/** In-memory store (tests and fallback). A null account is a point queued before accounts were kept. */
export class MemoryQueueStore implements QueueStore {
  private rows: Array<QueuedPoint & { seq: number; batchId: string | null; accountId: string | null }> = [];
  private seq = 0;

  /** Test helper: a point queued by a version that didn't record the account. */
  async appendUnowned(points: QueuedPoint[]) {
    for (const p of points) this.rows.push({ ...p, seq: this.seq++, batchId: null, accountId: null });
  }

  async append(points: QueuedPoint[], accountId: string) {
    for (const p of points) this.rows.push({ ...p, seq: this.seq++, batchId: null, accountId });
  }

  async claim(limit: number, newBatchId: () => string, accountId: string): Promise<ClaimedBatch | null> {
    const mine = this.rows.filter((r) => r.accountId === accountId || r.accountId === null);
    const pending = mine.find((r) => r.batchId !== null);
    if (pending) {
      const id = pending.batchId!;
      return { batchId: id, points: mine.filter((r) => r.batchId === id).map(strip) };
    }
    const free = mine.filter((r) => r.batchId === null);
    const first = free[0];
    if (!first) return null;
    const key = groupKey(first);
    const id = newBatchId();
    const picked: typeof this.rows = [];
    for (const r of free) {
      if (groupKey(r) !== key) break; // keep batches contiguous in time
      picked.push(r);
      if (picked.length >= limit) break;
    }
    picked.forEach((r) => (r.batchId = id));
    return { batchId: id, points: picked.map(strip) };
  }

  async complete(batchId: string) {
    this.rows = this.rows.filter((r) => r.batchId !== batchId);
  }

  async count(accountId?: string) {
    return accountId === undefined ? this.rows.length : this.rows.filter((r) => r.accountId === accountId || r.accountId === null).length;
  }
}
```

Add one more Vitest test for points from before the upgrade:

```ts
  it('sends points queued before accounts were kept as the signed-in account’s', async () => {
    const store = new MemoryQueueStore();
    await store.appendUnowned([pt(0)]);
    expect(await flushQueue(store, async () => undefined, ids, 'whoever')).toMatchObject({ uploaded: 1, remaining: 0 });
  });
```

Run: `npx vitest run apps/mobile/test/queue.test.ts`
Expected: PASS.

- [ ] **Step 4: Write the failing Jest tests**

In `apps/mobile/test/tracking.native.test.tsx`, replace the `mockDb` object (top of the file) with this version, which keeps the account and the schema version:

```ts
type MockRow = Record<string, unknown>;
const mine = (r: MockRow, account: unknown) => r.account_id === account || r.account_id == null;
const mockDb: {
  rows: MockRow[];
  nextId: number;
  version: number;
  [fn: string]: unknown;
} = {
  rows: [] as MockRow[],
  nextId: 1,
  version: 0,
  execAsync: jest.fn(async (sql: string) => {
    if (sql.includes('user_version = 1')) mockDb.version = 1;
  }),
  withTransactionAsync: jest.fn(async (fn: () => Promise<void>) => fn()),
  runAsync: jest.fn(async (sql: string, ...args: unknown[]) => {
    if (sql.startsWith('INSERT')) {
      const [ts, lon, lat, accuracy_m, speed_mps, heading_deg, source, mode, session_id, account_id] = args;
      mockDb.rows.push({ id: mockDb.nextId++, ts, lon, lat, accuracy_m, speed_mps, heading_deg, source, mode, session_id, account_id, batch_id: null });
    } else if (sql.startsWith('UPDATE')) {
      const [id, from, to, account] = args as [string, number, number, string];
      for (const r of mockDb.rows) if ((r.id as number) >= from && (r.id as number) <= to && r.batch_id === null && mine(r, account)) r.batch_id = id;
    } else if (sql.startsWith('DELETE')) {
      mockDb.rows = mockDb.rows.filter((r: MockRow) => r.batch_id !== args[0]);
    }
  }),
  getFirstAsync: jest.fn(async (sql: string, ...args: unknown[]): Promise<object | null> => {
    if (sql.includes('user_version')) return { user_version: mockDb.version };
    if (sql.includes('count(*)')) return { n: args.length ? mockDb.rows.filter((r) => mine(r, args[0])).length : mockDb.rows.length };
    const r = mockDb.rows.find((x: MockRow) => x.batch_id !== null && mine(x, args[0]));
    return r ? { batch_id: r.batch_id } : null;
  }),
  getAllAsync: jest.fn(async (sql: string, ...args: unknown[]) =>
    sql.includes('WHERE batch_id = ?')
      ? mockDb.rows.filter((r: MockRow) => r.batch_id === args[0])
      : mockDb.rows.filter((r: MockRow) => r.batch_id === null && mine(r, args[0])).slice(0, args[1] as number),
  ),
};
```

Add a mock for the account helper next to the other `jest.mock` calls:

```ts
let mockAccount: string | null = 'u1';
jest.mock('../src/lib/account', () => ({ currentAccountId: async () => mockAccount, cachedAccountId: () => mockAccount }));
```

Update the existing SQLite store tests in this file: `sqliteQueueStore.append(points)` → `sqliteQueueStore.append(points, 'u1')`; `sqliteQueueStore.claim(n, id)` → `sqliteQueueStore.claim(n, id, 'u1')`.

Add tests (in the describe that holds the SQLite store tests; reset with `mockDb.rows = []` first as the neighbouring tests do):

```ts
  it('adds the account column once, and keeps each account’s points to itself', async () => {
    mockDb.rows = [];
    // A point from before the upgrade has no account.
    mockDb.rows.push({ id: mockDb.nextId++, ts: 1, lon: 153, lat: -27, accuracy_m: null, speed_mps: null, heading_deg: null, source: 'background', mode: null, session_id: null, account_id: null, batch_id: null });
    await sqliteQueueStore.append([point(1)], 'test-account');
    expect(mockDb.version).toBe(1); // the ALTER TABLE ran (the mock records it on the version)
    expect(await sqliteQueueStore.count('owner')).toBe(1); // only the old, unowned one
    const forOwner = await sqliteQueueStore.claim(10, () => 'b-owner', 'owner');
    expect(forOwner!.points).toHaveLength(1);
    await sqliteQueueStore.complete('b-owner');
    expect(await sqliteQueueStore.claim(10, () => 'b-none', 'owner')).toBeNull();
    expect((await sqliteQueueStore.claim(10, () => 'b-test', 'test-account'))!.points).toHaveLength(1);
  });

  it('queues nothing from the background while nobody is signed in', async () => {
    mockDb.rows = [];
    mockAccount = null;
    const task = (TaskManager.defineTask as jest.Mock).mock.calls.find((c) => c[0] === BACKGROUND_TASK)![1];
    await task({ data: { locations: [{ timestamp: 1, coords: { longitude: 153, latitude: -27, accuracy: 5, speed: 0, heading: 0 } }] }, error: null });
    expect(mockDb.rows).toHaveLength(0);
    mockAccount = 'u1';
  });
```

(If the file already captures the background task under another name, use that instead of re-reading `defineTask`'s calls.)

In `apps/mobile/test/device.native.test.tsx`, add near the other mocks:

```ts
const mockSync = jest.fn(async () => null as unknown);
jest.mock('../src/tracking/sync', () => ({ syncQueue: () => mockSync() }));
```

and append to `describe('session', …)`:

```ts
  it('uploads what the leaving account recorded before signing out, and signs out even when that fails', async () => {
    mockSaved = auth;
    await show();
    expect(await screen.findByText('authenticated:sam@example.test')).toBeOnTheScreen();
    mockSync.mockClear();
    await act(async () => signOut());
    expect(mockSync).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('anonymous:-')).toBeOnTheScreen();

    mockSaved = auth;
    await show();
    expect(await screen.findByText('authenticated:sam@example.test')).toBeOnTheScreen();
    mockSync.mockRejectedValueOnce(new Error('offline'));
    await act(async () => signOut());
    expect(await screen.findByText('anonymous:-')).toBeOnTheScreen();
  });
```

In `navigation-service.native.test.tsx`, `turn-by-turn.native.test.tsx` and `car-test-drive.native.test.tsx`, next to their `sqliteStore` mock, add:

```ts
jest.mock('../src/lib/account', () => ({ currentAccountId: async () => 'u1', cachedAccountId: () => 'u1' }));
```

- [ ] **Step 5: Run them to see them fail**

Run: `cd apps/mobile && npx jest test/tracking.native.test.tsx test/device.native.test.tsx`
Expected: FAIL (`../src/lib/account` doesn't exist; sign-out doesn't sync).

- [ ] **Step 6: Account helper**

`apps/mobile/src/lib/account.ts`:

```ts
import * as SecureStore from 'expo-secure-store';

const KEY = 'wf.accountId';
let cached: string | null | undefined;

/**
 * The account signed in on this phone. Kept in secure storage as well as memory so the
 * background location task, which can run with no screen open, knows whose points it records.
 */
export async function currentAccountId(): Promise<string | null> {
  if (cached !== undefined) return cached;
  try {
    cached = await SecureStore.getItemAsync(KEY);
  } catch {
    cached = null;
  }
  return cached;
}

/** The account as last seen this run, for code that can't wait (a navigation fix every second). */
export const cachedAccountId = () => cached ?? null;

export async function setCurrentAccountId(id: string | null): Promise<void> {
  cached = id;
  try {
    if (id) await SecureStore.setItemAsync(KEY, id);
    else await SecureStore.deleteItemAsync(KEY);
  } catch {
    // Memory still has it for this run; the next sign-in writes it again.
  }
}
```

`apps/mobile/src/lib/api.ts`: import `setCurrentAccountId` from `./account` and change the `onSession` option to:

```ts
  onSession: (auth) => {
    void setCurrentAccountId(auth?.user.id ?? null);
    listeners.forEach((l) => l(auth));
  },
```

- [ ] **Step 7: SQLite store**

`apps/mobile/src/tracking/sqliteStore.ts`:

Add `account_id: string | null;` to `Row`.

In `db()`, after the `execAsync` that creates the table and index, add the one-off upgrade:

```ts
    // Version 1: each point records the account it was recorded under. Points already queued
    // keep a null account and go up as whoever is signed in when they're sent.
    const v = await d.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    if ((v?.user_version ?? 0) < 1) await d.execAsync('ALTER TABLE queued_points ADD COLUMN account_id TEXT; PRAGMA user_version = 1;');
```

Replace the store with:

```ts
const MINE = '(account_id = ? OR account_id IS NULL)';

/** Durable queue on the device; survives the app being killed while offline. */
export const sqliteQueueStore: QueueStore = {
  async append(points, accountId) {
    if (points.length === 0) return;
    const d = await db();
    await d.withTransactionAsync(async () => {
      for (const p of points) {
        await d.runAsync(
          'INSERT INTO queued_points (ts, lon, lat, accuracy_m, speed_mps, heading_deg, source, mode, session_id, account_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          p.ts, p.lon, p.lat, p.accuracyM, p.speedMps, p.headingDeg, p.source, p.mode, p.sessionId, accountId,
        );
      }
    });
  },
  async claim(limit, newBatchId, accountId): Promise<ClaimedBatch | null> {
    const d = await db();
    const pending = await d.getFirstAsync<{ batch_id: string }>(`SELECT batch_id FROM queued_points WHERE batch_id IS NOT NULL AND ${MINE} LIMIT 1`, accountId);
    if (pending) {
      const rows = await d.getAllAsync<Row>('SELECT * FROM queued_points WHERE batch_id = ? ORDER BY id', pending.batch_id);
      return { batchId: pending.batch_id, points: rows.map(toPoint) };
    }
    const rows = await d.getAllAsync<Row>(`SELECT * FROM queued_points WHERE batch_id IS NULL AND ${MINE} ORDER BY id LIMIT ?`, accountId, limit);
    if (rows.length === 0) return null;
    const key = groupKey({ source: rows[0]!.source, sessionId: rows[0]!.session_id, mode: rows[0]!.mode });
    const picked: Row[] = [];
    for (const r of rows) {
      if (groupKey({ source: r.source, sessionId: r.session_id, mode: r.mode }) !== key) break;
      picked.push(r);
    }
    const id = newBatchId();
    const last = picked[picked.length - 1]!.id;
    // Another account's points may sit between these ids; they stay unclaimed.
    await d.runAsync(`UPDATE queued_points SET batch_id = ? WHERE id >= ? AND id <= ? AND batch_id IS NULL AND ${MINE}`, id, picked[0]!.id, last, accountId);
    return { batchId: id, points: picked.map(toPoint) };
  },
  async complete(batchId) {
    const d = await db();
    await d.runAsync('DELETE FROM queued_points WHERE batch_id = ?', batchId);
  },
  async count(accountId) {
    const d = await db();
    const r = accountId === undefined
      ? await d.getFirstAsync<{ n: number }>('SELECT count(*) AS n FROM queued_points')
      : await d.getFirstAsync<{ n: number }>(`SELECT count(*) AS n FROM queued_points WHERE ${MINE}`, accountId);
    return r?.n ?? 0;
  },
};
```

- [ ] **Step 8: Callers**

`apps/mobile/src/tracking/sync.ts`: import `currentAccountId` from `../lib/account`; after the `api.refresh()` line:

```ts
      const account = await currentAccountId();
      if (!account) return null; // nobody signed in: nobody to send them as
      return await flushQueue(
        sqliteQueueStore,
        (req) => api.request('api/tracks/batches', { method: 'POST', body: req }),
        () => Crypto.randomUUID(),
        account,
      );
```

`apps/mobile/src/tracking/background.ts`: import `currentAccountId` from `../lib/account`; in the task, after the `isNavigationRecording()` check:

```ts
  const account = await currentAccountId();
  if (!account) return; // signed out: these points would belong to nobody
```

pass `account` as the second argument to `sqliteQueueStore.append(…)`, and change the count check to `if ((await sqliteQueueStore.count(account)) >= 50) await syncQueue();`.

`apps/mobile/src/nav/navigationService.ts`: import `cachedAccountId` from `../lib/account`; replace the `void sqliteQueueStore.append([...]).catch(...)` block with:

```ts
    const account = cachedAccountId();
    if (!account) return;
    void sqliteQueueStore
      .append(
        [
          {
            ...fix,
            accuracyM: fix.accuracyM ?? null,
            speedMps: fix.speedMps ?? null,
            headingDeg: fix.headingDeg ?? null,
            source: 'navigation',
            mode: nav.mode,
            sessionId,
          },
        ],
        account,
      )
      .catch(() => undefined);
```

`apps/mobile/src/lib/session.tsx`: import `syncQueue` from `../tracking/sync`; make `signOut` start with:

```ts
      signOut: async () => {
        // Send what this account recorded while there's signal; anything left waits for it to sign in again.
        await syncQueue().catch(() => undefined);
        await reconcileTracking(false, config.appName).catch(() => undefined);
```

- [ ] **Step 9: Run every mobile test**

Run: `npx vitest run apps/mobile/test && pnpm test:mobile`
Expected: PASS. If `pnpm test:mobile` reports a coverage drop for `lib/account.ts`, add Jest tests for it (read from secure storage once, then memory; a storage failure gives null; `setCurrentAccountId(null)` deletes) rather than lowering anything.

- [ ] **Step 10: Commit**

```bash
git add apps/mobile/src apps/mobile/test
git commit -m "Keep each account's queued points to that account" -m "Recorded points wait in a local queue that didn't know whose they were, and signing out left them there. Points recorded on one account and not yet sent went up under the next account to sign in: a tester switching accounts, or the device harness's test drive, could put trips and coverage in someone else's account. Each point now carries the account it was recorded on and only that account uploads it; points queued by older versions go up as whoever is signed in, as before. Signing out sends what it can first." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Car log line when the car screen shows Wayfinder

**Files:**
- Create: `apps/mobile/modules/wayfinder-car/android/src/main/java/app/wayfinder/car/CarVisibility.kt`
- Modify: `apps/mobile/modules/wayfinder-car/android/src/main/java/app/wayfinder/car/WayfinderSession.kt:30-31`
- Test: `apps/mobile/modules/wayfinder-car/android/src/test/java/app/wayfinder/car/CarVisibilityTest.kt`

**Interfaces:**
- Produces: logcat lines, tag `WayfinderCar`, priority I: `car screen shown` (session resumed) and `car screen hidden` (paused). The harness (Task 7, `carShowsWayfinder`) reads the last of them.

- [ ] **Step 1: Write the failing test**

`CarVisibilityTest.kt`:

```kotlin
package app.wayfinder.car

import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import org.junit.Assert.assertEquals
import org.junit.Test

class CarVisibilityTest {
  private class Owner : LifecycleOwner {
    val registry = LifecycleRegistry.createUnsafe(this)
    override val lifecycle: Lifecycle get() = registry
  }

  @Test fun logsEachTimeTheCarScreenShowsOrHidesWayfinder() {
    val lines = mutableListOf<String>()
    val owner = Owner()
    owner.registry.addObserver(CarVisibility { lines += it })
    owner.registry.currentState = Lifecycle.State.RESUMED
    owner.registry.currentState = Lifecycle.State.STARTED // another Android Auto app in front
    owner.registry.currentState = Lifecycle.State.RESUMED
    owner.registry.currentState = Lifecycle.State.DESTROYED
    assertEquals(listOf("car screen shown", "car screen hidden", "car screen shown", "car screen hidden"), lines)
  }
}
```

- [ ] **Step 2: Run it to see it fail**

Run: `CI=true pnpm test:android -- --tests '*CarVisibilityTest'`
Expected: FAIL, unresolved reference `CarVisibility`. (If the filter isn't accepted, run `CI=true pnpm test:android`.)

- [ ] **Step 3: Implement**

`CarVisibility.kt`:

```kotlin
package app.wayfinder.car

import android.util.Log
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner

/**
 * Logs when the car's screen starts and stops showing Wayfinder. The device harness
 * (scripts/device) reads the last of these lines, so it never taps the car's screen while
 * another Android Auto app, such as the dialler or messages, is in front.
 */
class CarVisibility(private val log: (String) -> Unit = { Log.i(TAG, it) }) : DefaultLifecycleObserver {
  override fun onResume(owner: LifecycleOwner) = log("car screen shown")
  override fun onPause(owner: LifecycleOwner) = log("car screen hidden")

  companion object {
    const val TAG = "WayfinderCar"
  }
}
```

`WayfinderSession.kt`, first line of `onCreateScreen`:

```kotlin
    lifecycle.addObserver(CarVisibility())
```

- [ ] **Step 4: Run it to see it pass**

Run: `CI=true pnpm test:android -- --tests '*CarVisibilityTest'`
Expected: PASS. Then the whole module: `CI=true pnpm test:android` (it holds `node_modules` while it runs; run no pnpm meanwhile). Expected: PASS with the JaCoCo floor met.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/modules/wayfinder-car/android/src
git commit -m "Log when the car screen shows Wayfinder" -m "Nothing outside the car app could tell whether the head unit was showing Wayfinder or another Android Auto app. The device harness needs to know before it taps the car screen, so a tap never lands in the dialler or messages. The session now logs when it's shown and hidden." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Harness building blocks: adb commands, screen reading, routes

**Files:**
- Create: `scripts/device/adb.ts`, `scripts/device/ui.ts`, `scripts/device/route.ts`
- Test: `scripts/test/device/adb.test.ts`, `scripts/test/device/ui.test.ts`, `scripts/test/device/route.test.ts`, `scripts/test/device/fakes.ts` (create it now with the `node` and `dump` helpers shown in Task 7 Step 3; Task 7 adds the rest)
- Modify: `vitest.config.ts:11` (coverage include)

**Interfaces:**
- Produces (`adb.ts`): `APP = 'app.wayfinder.maps'`, `MIN_SAFE_VERSION_CODE = 17`, `DHU_PORT = 5277`, `LIST_DEVICES = ['devices']`, `interface Device { serial: string; emulator: boolean }`, `type Key = 'back' | 'home' | 'enter'`, `type AdbCommand` (union below), `adbArgs(device, cmd): string[]`, `shellQuote(s): string`, `focusedPackage(dumpsys): string | null`, `versionCode(dumpsys): number | null`, `carShowsWayfinder(log): boolean`, `parseDevices(out): ListedDevice[]`, `pickDevice(listed, registered, named?): Device`.
- Produces (`ui.ts`): `interface UiNode { text; desc; id; pkg; bounds: [number, number, number, number] }`, `parseUiDump(xml): UiNode[]`, `label(n)`, `centre(n): [number, number]`, `describeScreen(nodes): string[]`, `findByText(nodes, text): UiNode`, `NEVER_TAP`, `forbiddenAt(nodes, x, y): string | null`, `isSignInScreen(nodes): boolean`, `signedInEmail(nodes): string | null`, `screenSize(nodes): [number, number]`.
- Produces (`route.ts`): `interface Fix { lon; lat; atS; speedMps; bearingDeg }`, `readRoute(text, fileName): LngLat[]`, `replay(line, speedKmh, stepS = 1): Fix[]`.

- [ ] **Step 1: Write the failing tests**

`scripts/test/device/adb.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { type AdbCommand, LIST_DEVICES, adbArgs, carShowsWayfinder, focusedPackage, parseDevices, pickDevice, shellQuote, versionCode } from '../../device/adb.js';

const phone = { serial: 'R5CT1234', emulator: false };
const emulator = { serial: 'emulator-5554', emulator: true };

/** One of every command the harness can send to a phone. */
const PHONE_COMMANDS: AdbCommand[] = [
  { kind: 'screencap' },
  { kind: 'uiDump' },
  { kind: 'tap', x: 10, y: 20 },
  { kind: 'text', text: 'Mt Coot-tha' },
  { kind: 'key', key: 'back' },
  { kind: 'swipe', x1: 1, y1: 2, x2: 3, y2: 4 },
  { kind: 'focus' },
  { kind: 'version' },
  { kind: 'open' },
  { kind: 'open', path: '/settings' },
  { kind: 'logs', sinceEpochS: 1_790_000_000.5 },
  { kind: 'carLog' },
  { kind: 'mockLocation', allow: true },
  { kind: 'mockLocation', allow: false },
  { kind: 'testProvider', add: true },
  { kind: 'testProvider', add: false },
  { kind: 'testLocation', lon: 153.02, lat: -27.47 },
  { kind: 'forward', add: true },
  { kind: 'forward', add: false },
];

describe('adb commands', () => {
  it('only ever looks, taps and types, sets a test location, or forwards the head unit port on a phone', () => {
    const allowedShell = new Set(['input', 'dumpsys', 'am', 'appops', 'cmd']);
    for (const cmd of PHONE_COMMANDS) {
      const args = adbArgs(phone, cmd);
      expect(args.slice(0, 2)).toEqual(['-s', 'R5CT1234']);
      const [verb, first] = args.slice(2);
      expect(['exec-out', 'shell', 'logcat', 'forward']).toContain(verb);
      if (verb === 'shell') expect(allowedShell).toContain(first);
      if (verb === 'exec-out') expect(['screencap', 'uiautomator']).toContain(first);
      const line = args.join(' ');
      for (const banned of ['uninstall', 'install', ' pm ', 'clear', ' rm ', 'reboot', 'settings put', 'wipe', 'factory']) expect(line).not.toContain(banned);
    }
    expect(LIST_DEVICES).toEqual(['devices']);
  });

  it('keeps installing, geo fix and shutting down to the emulator', () => {
    for (const cmd of [{ kind: 'install', apk: 'a.apk' }, { kind: 'geoFix', lon: 1, lat: 2 }, { kind: 'emuKill' }] as AdbCommand[]) {
      expect(() => adbArgs(phone, cmd)).toThrow('only runs on the emulator');
      expect(adbArgs(emulator, cmd).slice(0, 2)).toEqual(['-s', 'emulator-5554']);
    }
    expect(adbArgs(emulator, { kind: 'geoFix', lon: 153.02, lat: -27.47 })).toEqual(['-s', 'emulator-5554', 'emu', 'geo', 'fix', '153.020000', '-27.470000']);
  });

  it('sends typed text as text, never as a shell command', () => {
    const args = adbArgs(phone, { kind: 'text', text: "it's; rm -rf / $(reboot)" });
    expect(args.slice(2)).toEqual(['shell', 'input', 'text', `'it'\\''s;%srm%s-rf%s/%s$(reboot)'`]);
    expect(shellQuote("a'b")).toBe(`'a'\\''b'`);
  });

  it('refuses positions and places that aren’t numbers on Earth', () => {
    expect(() => adbArgs(phone, { kind: 'tap', x: Number.NaN, y: 1 })).toThrow('Not a number');
    expect(() => adbArgs(phone, { kind: 'testLocation', lon: 200, lat: 0 })).toThrow('Not a coordinate');
    expect(adbArgs(phone, { kind: 'testLocation', lon: 153.02, lat: -27.47 }).slice(-2)).toEqual(['--location', '-27.470000,153.020000']);
  });

  it('reads the app in front, the installed version and the car app’s log', () => {
    expect(focusedPackage('  mCurrentFocus=Window{8f1 u0 app.wayfinder.maps/app.wayfinder.maps.MainActivity}\n')).toBe('app.wayfinder.maps');
    expect(focusedPackage('mCurrentFocus=Window{1 u0 com.google.android.permissioncontroller/com.android.permissioncontroller.permission.ui.GrantPermissionsActivity}')).toBe('com.google.android.permissioncontroller');
    expect(focusedPackage('mCurrentFocus=Window{2 u0 NotificationShade}')).toBeNull();
    expect(focusedPackage('')).toBeNull();
    expect(versionCode('    versionCode=17 minSdk=26 targetSdk=36')).toBe(17);
    expect(versionCode('Unable to find package')).toBeNull();
    expect(carShowsWayfinder('I WayfinderCar: car screen shown\nI WayfinderCar: car screen hidden\n')).toBe(false);
    expect(carShowsWayfinder('I WayfinderCar: car screen hidden\nI WayfinderCar: car screen shown\n')).toBe(true);
    expect(carShowsWayfinder('')).toBe(false);
  });
});

describe('choosing a device', () => {
  const listed = parseDevices('List of devices attached\nR5CT1234\tdevice\nemulator-5554\tdevice\nXYZ\tunauthorized\n\n');

  it('reads adb devices', () => {
    expect(listed).toEqual([{ serial: 'R5CT1234', state: 'device' }, { serial: 'emulator-5554', state: 'device' }, { serial: 'XYZ', state: 'unauthorized' }]);
  });

  it('never picks a phone that isn’t registered', () => {
    expect(() => pickDevice(listed, [], 'R5CT1234')).toThrow('pnpm device register R5CT1234');
    expect(pickDevice(listed, ['R5CT1234'], 'R5CT1234')).toEqual({ serial: 'R5CT1234', emulator: false });
  });

  it('needs one named when several are attached, and says when none is', () => {
    expect(() => pickDevice(listed, ['R5CT1234'])).toThrow('More than one device');
    expect(pickDevice(listed, [], 'emulator-5554')).toEqual({ serial: 'emulator-5554', emulator: true });
    expect(() => pickDevice([], [])).toThrow('No device attached');
    expect(() => pickDevice(listed, [], 'XYZ')).toThrow("isn't attached");
  });
});
```

`scripts/test/device/ui.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { centre, describeScreen, findByText, forbiddenAt, isSignInScreen, parseUiDump, screenSize, signedInEmail } from '../../device/ui.js';
import { dump, node } from './fakes.js';

describe('reading the screen', () => {
  const nodes = parseUiDump(
    dump(
      node({ text: 'sam@example.test · Wayfinder at maps.example.test', b: [40, 300, 1040, 340] }),
      node({ desc: 'Sign out', b: [40, 2000, 400, 2100] }),
      node({ text: 'Sign out', b: [60, 2020, 380, 2080] }),
      node({ text: 'Remove', b: [800, 900, 1000, 960] }),
      node({ text: 'Remove', b: [800, 1100, 1000, 1160] }),
      node({ text: 'Tom &amp; Jerry&apos;s', id: 'app.wayfinder.maps:id/place', b: [0, 500, 1080, 600] }),
    ),
  );

  it('parses each node, with its text decoded', () => {
    expect(nodes).toHaveLength(7);
    expect(nodes[6]).toMatchObject({ text: "Tom & Jerry's", id: 'app.wayfinder.maps:id/place', bounds: [0, 500, 1080, 600] });
    expect(screenSize(nodes)).toEqual([1080, 2400]);
  });

  it('lists what can be tapped, and where', () => {
    expect(describeScreen(nodes)).toContain('"Tom & Jerry\'s" #place @ 540,550');
  });

  it('finds the one thing showing a text, taking a button over the label inside it', () => {
    expect(centre(findByText(nodes, 'sign out'))).toEqual([220, 2050]);
    expect(() => findByText(nodes, 'Remove')).toThrow('appears 2 times');
    expect(() => findByText(nodes, 'Nowhere')).toThrow('Nothing on screen says "Nowhere"');
  });

  it('knows what it must never tap', () => {
    expect(forbiddenAt(nodes, 220, 2050)).toBe('Sign out');
    expect(forbiddenAt(nodes, 900, 930)).toBeNull();
  });

  it('reads who is signed in on Settings, and recognises the sign-in screen', () => {
    expect(signedInEmail(nodes)).toBe('sam@example.test');
    expect(isSignInScreen(nodes)).toBe(false);
    const signIn = parseUiDump(dump(node({ text: 'Email', b: [0, 0, 10, 10] }), node({ text: 'Password', b: [0, 20, 10, 30] }), node({ text: 'Sign in', b: [0, 40, 10, 50] })));
    expect(isSignInScreen(signIn)).toBe(true);
    expect(signedInEmail(signIn)).toBeNull();
  });
});
```

`scripts/test/device/route.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { destination, haversineM } from '@wayfinder/shared';
import { readRoute, replay } from '../../device/route.js';

describe('routes to replay', () => {
  const line = [[153.0, -27.5], [153.01, -27.5]];

  it('reads a GeoJSON line, bare, as a feature, or the first in a collection', () => {
    expect(readRoute(JSON.stringify({ type: 'LineString', coordinates: line }), 'r.geojson')).toEqual(line);
    expect(readRoute(JSON.stringify({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line } }), 'r.json')).toEqual(line);
    const fc = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] } }, { type: 'Feature', geometry: { type: 'LineString', coordinates: line } }] };
    expect(readRoute(JSON.stringify(fc), 'r.geojson')).toEqual(line);
  });

  it('reads a GPX track or route as [lon, lat]', () => {
    const gpx = '<gpx><trk><trkseg><trkpt lat="-27.5" lon="153.0"><time>2026-11-09T00:00:00Z</time></trkpt><trkpt lon="153.01" lat="-27.5"/></trkseg></trk></gpx>';
    expect(readRoute(gpx, 'Drive.GPX')).toEqual(line);
    expect(readRoute('<gpx><rte><rtept lat="-27.5" lon="153.0"/></rte></gpx>', 'r.gpx')).toEqual([[153.0, -27.5]]);
  });

  it('refuses a file with no route, or a point off the Earth', () => {
    expect(() => readRoute('{"type":"Point","coordinates":[0,0]}', 'p.geojson')).toThrow('No route found');
    expect(() => readRoute('<gpx/>', 'e.gpx')).toThrow('No route found');
    expect(() => readRoute(JSON.stringify({ type: 'LineString', coordinates: [[-27.5, 153]] }), 'swapped.geojson')).toThrow("isn't on Earth");
  });

  it('gives a fix a second along the line at the speed asked, ending stopped at the end', () => {
    const start = [153.0, -27.5] as const;
    const end = destination([...start], 90, 1000);
    const fixes = replay([[...start], end], 36); // 10 m/s
    expect(fixes).toHaveLength(101);
    expect(fixes[0]).toMatchObject({ lon: 153.0, lat: -27.5, atS: 0, speedMps: 10 });
    expect(fixes[1]!.bearingDeg).toBeCloseTo(90, 0);
    expect(haversineM([fixes[0]!.lon, fixes[0]!.lat], [fixes[1]!.lon, fixes[1]!.lat])).toBeCloseTo(10, 1);
    expect(fixes.at(-1)).toMatchObject({ atS: 100, speedMps: 0 });
    expect(haversineM([fixes.at(-1)!.lon, fixes.at(-1)!.lat], end)).toBeLessThan(0.01);
  });

  it('turns with the line, and copes with a line shorter than a step or of one point', () => {
    const a: [number, number] = [153.0, -27.5];
    const b = destination(a, 90, 50);
    const c = destination(b, 180, 50);
    const fixes = replay([a, b, c], 36);
    expect(fixes[2]!.bearingDeg).toBeCloseTo(90, 0);
    expect(fixes[8]!.bearingDeg).toBeCloseTo(180, 0);
    expect(replay([a, destination(a, 90, 3)], 36)).toHaveLength(2);
    expect(replay([a], 36)).toEqual([{ lon: 153.0, lat: -27.5, atS: 0, speedMps: 0, bearingDeg: 0 }]);
    expect(() => replay([a, b], 0)).toThrow('above 0');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run scripts/test/device`
Expected: FAIL, modules not found.

- [ ] **Step 3: `scripts/device/adb.ts`**

```ts
/**
 * Every adb command the device harness sends is built here and nowhere else. On a real phone the
 * harness may only look, tap and type, set a test location, and forward the head unit's port:
 * nothing here installs, uninstalls, clears data, deletes files, reboots or changes settings, and
 * scripts/test/device/adb.test.ts holds it to that. See docs/development.md, "Device harness".
 */
export const APP = 'app.wayfinder.maps';
/** The first version whose upload queue keeps each account's points to that account. */
export const MIN_SAFE_VERSION_CODE = 17;
export const DHU_PORT = 5277;
export const LIST_DEVICES = ['devices'];

export interface Device {
  serial: string;
  emulator: boolean;
}

export type Key = 'back' | 'home' | 'enter';
const KEYCODES: Record<Key, string> = { back: 'KEYCODE_BACK', home: 'KEYCODE_HOME', enter: 'KEYCODE_ENTER' };

export type AdbCommand =
  | { kind: 'screencap' }
  | { kind: 'uiDump' }
  | { kind: 'tap'; x: number; y: number }
  | { kind: 'text'; text: string }
  | { kind: 'key'; key: Key }
  | { kind: 'swipe'; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'focus' }
  | { kind: 'version' }
  | { kind: 'open'; path?: string }
  | { kind: 'logs'; sinceEpochS: number }
  | { kind: 'carLog' }
  | { kind: 'mockLocation'; allow: boolean }
  | { kind: 'testProvider'; add: boolean }
  | { kind: 'testLocation'; lon: number; lat: number }
  | { kind: 'forward'; add: boolean }
  | { kind: 'geoFix'; lon: number; lat: number }
  | { kind: 'install'; apk: string }
  | { kind: 'emuKill' };

const EMULATOR_ONLY = new Set<AdbCommand['kind']>(['geoFix', 'install', 'emuKill']);

/** Quoted for the device's shell, so typed text is only ever text. */
export const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

const int = (n: number) => {
  if (!Number.isFinite(n)) throw new Error(`Not a number: ${n}`);
  return String(Math.round(n));
};
const coord = (n: number, max: number) => {
  if (!Number.isFinite(n) || Math.abs(n) > max) throw new Error(`Not a coordinate: ${n}`);
  return n.toFixed(6);
};

/** The adb arguments for a command. Throws for an emulator-only command on a phone. */
export function adbArgs(device: Device, cmd: AdbCommand): string[] {
  if (EMULATOR_ONLY.has(cmd.kind) && !device.emulator) throw new Error(`${cmd.kind} only runs on the emulator`);
  const s = ['-s', device.serial];
  switch (cmd.kind) {
    case 'screencap':
      return [...s, 'exec-out', 'screencap', '-p'];
    case 'uiDump':
      return [...s, 'exec-out', 'uiautomator', 'dump', '/dev/tty'];
    case 'tap':
      return [...s, 'shell', 'input', 'tap', int(cmd.x), int(cmd.y)];
    case 'text':
      // `input text` takes %s for a space.
      return [...s, 'shell', 'input', 'text', shellQuote(cmd.text.replace(/ /g, '%s'))];
    case 'key':
      return [...s, 'shell', 'input', 'keyevent', KEYCODES[cmd.key]];
    case 'swipe':
      return [...s, 'shell', 'input', 'swipe', int(cmd.x1), int(cmd.y1), int(cmd.x2), int(cmd.y2), '300'];
    case 'focus':
      return [...s, 'shell', 'dumpsys', 'window'];
    case 'version':
      return [...s, 'shell', 'dumpsys', 'package', APP];
    case 'open':
      return cmd.path === undefined
        ? [...s, 'shell', 'am', 'start', '-n', `${APP}/.MainActivity`]
        : [...s, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', shellQuote(`wayfinder://${cmd.path}`), APP];
    case 'logs':
      return [...s, 'logcat', '-d', '-v', 'epoch', '-T', cmd.sinceEpochS.toFixed(3), 'ReactNativeJS:V', 'WayfinderCar:V', 'AndroidRuntime:E', '*:S'];
    case 'carLog':
      return [...s, 'logcat', '-d', '-s', 'WayfinderCar:I'];
    case 'mockLocation':
      return [...s, 'shell', 'appops', 'set', 'com.android.shell', 'android:mock_location', cmd.allow ? 'allow' : 'deny'];
    case 'testProvider':
      return [...s, 'shell', 'cmd', 'location', 'providers', cmd.add ? 'add-test-provider' : 'remove-test-provider', 'gps'];
    case 'testLocation':
      return [...s, 'shell', 'cmd', 'location', 'providers', 'set-test-provider-location', 'gps', '--location', `${coord(cmd.lat, 90)},${coord(cmd.lon, 180)}`];
    case 'forward':
      return cmd.add ? [...s, 'forward', `tcp:${DHU_PORT}`, `tcp:${DHU_PORT}`] : [...s, 'forward', '--remove', `tcp:${DHU_PORT}`];
    case 'geoFix':
      return [...s, 'emu', 'geo', 'fix', coord(cmd.lon, 180), coord(cmd.lat, 90)];
    case 'install':
      return [...s, 'install', '-r', cmd.apk];
    case 'emuKill':
      return [...s, 'emu', 'kill'];
  }
}

/** The app with focus, from `dumpsys window` ("mCurrentFocus=Window{… u0 app.wayfinder.maps/….MainActivity}"). */
export function focusedPackage(dumpsys: string): string | null {
  return /mCurrentFocus=Window\{[^}]*?\s([\w.]+)\/[^\s}]+\}/.exec(dumpsys)?.[1] ?? null;
}

export function versionCode(dumpsys: string): number | null {
  const m = /versionCode=(\d+)/.exec(dumpsys);
  return m ? Number(m[1]) : null;
}

/** Whether the car's screen shows Wayfinder, by the car app's last "car screen …" line (CarVisibility.kt). */
export function carShowsWayfinder(log: string): boolean {
  return log.split('\n').filter((l) => l.includes('car screen ')).at(-1)?.includes('car screen shown') ?? false;
}

export interface ListedDevice {
  serial: string;
  state: string;
}

export function parseDevices(out: string): ListedDevice[] {
  return out
    .split('\n')
    .slice(1)
    .map((l) => l.trim().split(/\s+/))
    .filter((p) => p.length >= 2 && p[0])
    .map(([serial, state]) => ({ serial: serial!, state: state! }));
}

/**
 * The device to act on: the one named, or the only one attached. A phone (anything not an
 * emulator) only once registered, so the harness never acts on a phone by accident.
 */
export function pickDevice(listed: ListedDevice[], registered: readonly string[], named?: string): Device {
  const ready = listed.filter((d) => d.state === 'device');
  const candidates = named ? ready.filter((d) => d.serial === named) : ready;
  if (candidates.length === 0) throw new Error(named ? `${named} isn't attached (or isn't allowed USB debugging).` : 'No device attached.');
  if (candidates.length > 1) throw new Error(`More than one device attached (${candidates.map((d) => d.serial).join(', ')}): name one with --device.`);
  const d = candidates[0]!;
  const emulator = d.serial.startsWith('emulator-');
  if (!emulator && !registered.includes(d.serial)) throw new Error(`${d.serial} isn't registered. If it's the phone to test with: pnpm device register ${d.serial}`);
  return { serial: d.serial, emulator };
}
```

- [ ] **Step 4: `scripts/device/ui.ts`**

```ts
/** Reading the phone's screen from `uiautomator dump`. */
export interface UiNode {
  text: string;
  desc: string;
  id: string;
  pkg: string;
  bounds: [number, number, number, number];
}

const decode = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#10;/g, '\n').replace(/&amp;/g, '&');
const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? decode(m[1]!) : '';
};

export function parseUiDump(xml: string): UiNode[] {
  const out: UiNode[] = [];
  for (const m of xml.matchAll(/<node\b[^>]*>/g)) {
    const tag = m[0];
    const b = /bounds="\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]"/.exec(tag);
    if (!b) continue;
    out.push({ text: attr(tag, 'text'), desc: attr(tag, 'content-desc'), id: attr(tag, 'resource-id'), pkg: attr(tag, 'package'), bounds: [Number(b[1]), Number(b[2]), Number(b[3]), Number(b[4])] });
  }
  return out;
}

export const label = (n: UiNode) => n.text || n.desc;
export const centre = (n: UiNode): [number, number] => [Math.round((n.bounds[0] + n.bounds[2]) / 2), Math.round((n.bounds[1] + n.bounds[3]) / 2)];
const inside = (n: UiNode, x: number, y: number) => x >= n.bounds[0] && x < n.bounds[2] && y >= n.bounds[1] && y < n.bounds[3];
const contains = (o: UiNode, n: UiNode) => o.bounds[0] <= n.bounds[0] && o.bounds[1] <= n.bounds[1] && o.bounds[2] >= n.bounds[2] && o.bounds[3] >= n.bounds[3];
/** Drop matches inside another match (a button's own label), keeping the first of identical ones. */
const outermost = (ns: UiNode[]) => ns.filter((n, i) => !ns.some((o, j) => j !== i && contains(o, n) && (!contains(n, o) || j < i)));

/** The screen's size, from the root node. */
export const screenSize = (nodes: UiNode[]): [number, number] => [nodes[0]?.bounds[2] ?? 1080, nodes[0]?.bounds[3] ?? 2400];

/** Lines for `pnpm device ui`: each labelled thing on screen, its id, and where to tap it. */
export function describeScreen(nodes: UiNode[]): string[] {
  return nodes
    .filter((n) => label(n))
    .map((n) => {
      const [x, y] = centre(n);
      return `${JSON.stringify(label(n))}${n.id ? ` #${n.id.replace(/^.*:id\//, '')}` : ''} @ ${x},${y}`;
    });
}

/** The one thing showing this text (exactly, else ignoring case). Throws if there's none, or several. */
export function findByText(nodes: UiNode[], text: string): UiNode {
  const exact = nodes.filter((n) => label(n) === text);
  const matches = outermost(exact.length ? exact : nodes.filter((n) => label(n).toLowerCase() === text.toLowerCase()));
  if (matches.length === 0) throw new Error(`Nothing on screen says "${text}". pnpm device ui lists what does.`);
  if (matches.length > 1) throw new Error(`"${text}" appears ${matches.length} times; tap one by position: ${matches.map((n) => centre(n).join(',')).join('  ')}`);
  return matches[0]!;
}

/** Controls the harness never taps: signing out is `pnpm device down`'s job, and nothing deletes an account. */
export const NEVER_TAP = ['Sign out', 'Delete account', 'Delete my account'];

export function forbiddenAt(nodes: UiNode[], x: number, y: number): string | null {
  const hit = nodes.find((n) => NEVER_TAP.includes(label(n)) && inside(n, x, y));
  return hit ? label(hit) : null;
}

/** Wayfinder's sign-in screen: a password to fill in and a Sign in button. */
export const isSignInScreen = (nodes: UiNode[]) => nodes.some((n) => label(n) === 'Password') && nodes.some((n) => label(n) === 'Sign in');

/** Who is signed in, from Settings' "sam@example.com · Wayfinder at maps.example.com" line. */
export function signedInEmail(nodes: UiNode[]): string | null {
  for (const n of nodes) {
    const m = /^(\S+@\S+) · /.exec(n.text);
    if (m) return m[1]!;
  }
  return null;
}
```

- [ ] **Step 5: `scripts/device/route.ts`**

```ts
import { type LngLat, bearingDeg, haversineM, interpolate } from '@wayfinder/shared';

/** A position to replay: where, seconds from the start, speed and heading. */
export interface Fix {
  lon: number;
  lat: number;
  atS: number;
  speedMps: number;
  bearingDeg: number;
}

/** The line of a GeoJSON LineString (bare, a Feature, or the first in a FeatureCollection) or of a GPX track or route, as [lon, lat]. */
export function readRoute(text: string, fileName: string): LngLat[] {
  const line = fileName.toLowerCase().endsWith('.gpx') ? fromGpx(text) : fromGeoJson(JSON.parse(text) as unknown);
  if (line.length === 0) throw new Error(`No route found in ${fileName}`);
  for (const [lon, lat] of line) {
    if (!(Math.abs(lon) <= 180 && Math.abs(lat) <= 90)) throw new Error(`${fileName} has a point that isn't on Earth: ${lon},${lat}`);
  }
  return line;
}

function fromGpx(xml: string): LngLat[] {
  const pts: LngLat[] = [];
  for (const m of xml.matchAll(/<(?:trkpt|rtept)\b([^>]*)>/g)) {
    const lat = /\blat="([^"]+)"/.exec(m[1]!)?.[1];
    const lon = /\blon="([^"]+)"/.exec(m[1]!)?.[1];
    if (lat !== undefined && lon !== undefined) pts.push([Number(lon), Number(lat)]);
  }
  return pts;
}

function fromGeoJson(g: unknown): LngLat[] {
  const o = g as { type?: string; coordinates?: LngLat[]; geometry?: unknown; features?: unknown[] } | null;
  if (o?.type === 'LineString') return o.coordinates ?? [];
  if (o?.type === 'Feature') return fromGeoJson(o.geometry);
  if (o?.type === 'FeatureCollection') {
    for (const f of o.features ?? []) {
      const l = fromGeoJson(f);
      if (l.length) return l;
    }
  }
  return [];
}

/** A fix every `stepS` seconds along the line at `speedKmh`, from its start to a stop at its end. */
export function replay(line: readonly LngLat[], speedKmh: number, stepS = 1): Fix[] {
  if (!(speedKmh > 0)) throw new Error('Speed must be above 0 km/h');
  const speedMps = speedKmh / 3.6;
  const legs: Array<{ a: LngLat; b: LngLat; len: number; bearing: number }> = [];
  for (let i = 1; i < line.length; i++) {
    const len = haversineM(line[i - 1]!, line[i]!);
    if (len > 0) legs.push({ a: line[i - 1]!, b: line[i]!, len, bearing: bearingDeg(line[i - 1]!, line[i]!) });
  }
  if (legs.length === 0) {
    const [lon, lat] = line[0]!;
    return [{ lon, lat, atS: 0, speedMps: 0, bearingDeg: 0 }];
  }
  const total = legs.reduce((sum, l) => sum + l.len, 0);
  const fixes: Fix[] = [];
  let leg = 0;
  let legStart = 0;
  for (let k = 0; ; k++) {
    const d = Math.min(k * speedMps * stepS, total);
    while (leg < legs.length - 1 && d > legStart + legs[leg]!.len) {
      legStart += legs[leg]!.len;
      leg++;
    }
    const l = legs[leg]!;
    const [lon, lat] = interpolate(l.a, l.b, Math.min(1, (d - legStart) / l.len));
    const last = d >= total - 0.01; // within a centimetre: the end, whatever the rounding
    fixes.push({ lon, lat, atS: k * stepS, speedMps: last ? 0 : speedMps, bearingDeg: l.bearing });
    if (last) return fixes;
  }
}
```

- [ ] **Step 6: Coverage**

`vitest.config.ts`: add `'scripts/device/**/*.ts'` to `coverage.include` (next to `'scripts/play/**/*.ts'`). `scripts/device.ts` (the entry, Task 7) sits outside that folder, as `scripts/play-publish.ts` does.

- [ ] **Step 7: Run the tests to see them pass**

Run: `npx vitest run scripts/test/device`
Expected: PASS. If the first fix of the 1 km line isn't exactly 153.0/-27.5, `interpolate` at t=0 returns `a`; check the leg selection rather than loosening the test.

- [ ] **Step 8: Commit**

```bash
git add scripts/device scripts/test/device vitest.config.ts
git commit -m "Add the device harness's adb commands, screen reading and route replay" -m "Driving the phone meant typing adb commands by hand, with nothing stopping one that uninstalls, wipes or taps the wrong app. Every command the harness can send is now built in one place, held by a test to looking, tapping, typing, test locations and the head unit port; typed text is quoted so it can't run as a shell command. It also reads the screen to tap by name and spaces a route's fixes a second apart for replaying drives." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `pnpm device`: state, head unit, commands and guards

**Files:**
- Create: `scripts/device/state.ts`, `scripts/device/dhu.ts`, `scripts/device/cli.ts`, `scripts/device.ts`
- Create: `scripts/device/routes/brisbane-to-mt-coot-tha.geojson`
- Test: `scripts/test/device/cli.test.ts`, `scripts/test/device/fakes.ts`
- Modify: `package.json` (script), `.gitignore`

**Interfaces:**
- Consumes: everything from Task 6.
- Produces (`state.ts`): `Config { testAccountEmail: string; phones: string[] }`, `Session { serial; emulator; account: string | null; testProvider: boolean; forward: boolean; dhu: { pid: number; fifo: string } | null; startedEmulator: boolean; logsSince: number }`, `Files { read(path): Promise<string | null>; write(path, text): Promise<void>; remove(path): Promise<void> }`, `harnessDir(root)`, `loadConfig`, `saveConfig`, `loadSession`, `saveSession`, `clearSession`.
- Produces (`dhu.ts`): `dhuCommand.{screenshot, tap, location, day, night, key, restrict, quit}`, `CAR_KEYS`, `CarKey`, `DHU_CONFIG`.
- Produces (`cli.ts`): `Deps` (below), `TAP_PACKAGES`, `run(argv, deps): Promise<number>` (0 ok, 1 refused or failed, 130 drive interrupted).

- [ ] **Step 1: `scripts/device/state.ts`**

```ts
import { join } from 'node:path';

/** `.harness/config.json` (git-ignored): the test account and the phones the harness may use. No secrets. */
export interface Config {
  testAccountEmail: string;
  phones: string[];
}

/** `.harness/session.json`: what `up` set going, so `down` can undo every part of it. */
export interface Session {
  serial: string;
  emulator: boolean;
  /** The test account's email once `up` has read it on Wayfinder's Settings; null while unconfirmed. */
  account: string | null;
  testProvider: boolean;
  forward: boolean;
  dhu: { pid: number; fifo: string } | null;
  startedEmulator: boolean;
  /** Epoch seconds; `logs` shows lines after this. */
  logsSince: number;
}

export interface Files {
  read(path: string): Promise<string | null>;
  write(path: string, text: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export const harnessDir = (root: string) => join(root, '.harness');
const configPath = (root: string) => join(harnessDir(root), 'config.json');
const sessionPath = (root: string) => join(harnessDir(root), 'session.json');

export async function loadConfig(files: Files, root: string): Promise<Config> {
  const text = await files.read(configPath(root));
  const c = text ? (JSON.parse(text) as Partial<Config>) : {};
  return { testAccountEmail: c.testAccountEmail ?? '', phones: c.phones ?? [] };
}
export const saveConfig = (files: Files, root: string, c: Config) => files.write(configPath(root), `${JSON.stringify(c, null, 2)}\n`);

export async function loadSession(files: Files, root: string): Promise<Session | null> {
  const text = await files.read(sessionPath(root));
  return text ? (JSON.parse(text) as Session) : null;
}
export const saveSession = (files: Files, root: string, s: Session) => files.write(sessionPath(root), `${JSON.stringify(s, null, 2)}\n`);
export const clearSession = (files: Files, root: string) => files.remove(sessionPath(root));
```

- [ ] **Step 2: `scripts/device/dhu.ts`**

```ts
/** Desktop Head Unit console commands (developer.android.com/training/cars/testing/dhu), written to its stdin. */

/** Car keys the harness may press. No call, end-call or phone keys: it never starts a call. */
export const CAR_KEYS = ['home', 'back', 'search', 'navigation'] as const;
export type CarKey = (typeof CAR_KEYS)[number];

export const dhuCommand = {
  screenshot: (path: string) => `screenshot ${path}`,
  tap: (x: number, y: number) => `tap ${Math.round(x)} ${Math.round(y)}`,
  /** The car's own GPS. The DHU takes latitude first; accuracy 5 m, altitude 0. */
  location: (lon: number, lat: number, speedMps = 0, bearing = 0) => `location ${lat.toFixed(6)} ${lon.toFixed(6)} 5 0 ${speedMps.toFixed(1)} ${Math.round(bearing)}`,
  day: () => 'day',
  night: () => 'night',
  key: (key: CarKey) => `keycode ${key}`,
  restrict: (on: boolean) => `restrict ${on ? 'all' : 'none'}`,
  quit: () => 'quit',
};

/** An 800×480 touch head unit with a cluster, sending the car's location, speed and day/night. */
export const DHU_CONFIG = `[general]
touch = true
resolution = 800x480
dpi = 160
framerate = 30
instrumentcluster = true

[sensors]
location = true
night_mode = true
driving_status = true
speed = true
compass = true
`;
```

- [ ] **Step 3: Write the failing CLI tests**

`scripts/test/device/fakes.ts`:

```ts
import type { Deps } from '../../device/cli.js';

/** One node of a `uiautomator dump`. */
export const node = (o: { text?: string; desc?: string; id?: string; b: [number, number, number, number] }) =>
  `<node index="0" text="${o.text ?? ''}" resource-id="${o.id ?? ''}" class="android.widget.TextView" package="app.wayfinder.maps" content-desc="${o.desc ?? ''}" bounds="[${o.b[0]},${o.b[1]}][${o.b[2]},${o.b[3]}]" />`;
/** A whole dump: a full-screen root, the nodes, and the line uiautomator prints after it. */
export const dump = (...nodes: string[]) => `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">${node({ b: [0, 0, 1080, 2400] })}${nodes.join('')}</hierarchy>UI hierchary dumped to: /dev/tty`;

export const ROOT = '/repo';
export const TEST_EMAIL = 'claude-harness@example.test';

export const settings = (email = TEST_EMAIL) =>
  dump(node({ text: `${email} · Wayfinder at maps.example.test`, b: [40, 300, 1040, 340] }), node({ text: 'Sync now', b: [40, 500, 400, 560] }), node({ desc: 'Sign out', b: [40, 2000, 400, 2100] }));
export const signIn = () => dump(node({ text: 'Email', b: [0, 400, 1080, 460] }), node({ text: 'Password', b: [0, 500, 1080, 560] }), node({ text: 'Sign in', b: [40, 700, 1040, 780] }));
export const planScreen = () => dump(node({ text: 'Search', b: [40, 200, 1040, 300] }), node({ text: 'Sign out', b: [40, 2000, 400, 2100] }));

export interface World {
  deps: Deps;
  calls: string[][];
  dhuLines: string[];
  files: Map<string, string>;
  binary: Map<string, Buffer>;
  /** Screens returned by successive UI dumps; the last one repeats. */
  screens: string[];
  focus: string;
  version: number;
  carLog: string;
  devices: string;
  interrupt: () => void;
  dhuAlive: boolean;
  slept: number;
}

export function world(over: Partial<Pick<World, 'focus' | 'version' | 'carLog' | 'devices' | 'screens'>> = {}): World {
  const w: World = {
    calls: [],
    dhuLines: [],
    files: new Map([[`${ROOT}/.harness/config.json`, JSON.stringify({ testAccountEmail: TEST_EMAIL, phones: ['R5CT1234'] })]]),
    binary: new Map(),
    screens: over.screens ?? [settings()],
    focus: over.focus ?? 'app.wayfinder.maps',
    version: over.version ?? 17,
    carLog: over.carLog ?? 'I WayfinderCar: car screen shown\n',
    devices: over.devices ?? 'List of devices attached\nR5CT1234\tdevice\n',
    interrupt: () => undefined,
    dhuAlive: true,
    slept: 0,
    deps: undefined as unknown as Deps,
  };
  const ok = (out: string | Buffer) => ({ code: 0, out: Buffer.isBuffer(out) ? out : Buffer.from(out), err: '' });
  w.deps = {
    root: ROOT,
    adb: async (args) => {
      w.calls.push(args);
      const line = args.join(' ');
      if (line === 'devices') return ok(w.devices);
      if (line.includes('screencap')) return ok(Buffer.from('PNG'));
      if (line.includes('uiautomator')) return ok(w.screens.length > 1 ? w.screens.shift()! : w.screens[0]!);
      if (line.includes('dumpsys window')) return ok(`mCurrentFocus=Window{1 u0 ${w.focus}/x.Main}`);
      if (line.includes('dumpsys package')) return ok(`versionCode=${w.version} minSdk=26`);
      if (line.includes('-s WayfinderCar:I')) return ok(w.carLog);
      return ok('');
    },
    files: {
      read: async (p) => w.files.get(p) ?? null,
      write: async (p, t) => void w.files.set(p, t),
      remove: async (p) => void w.files.delete(p),
    },
    writeBinary: async (p, b) => void w.binary.set(p, b),
    exists: async (p) => w.binary.has(p) || w.files.has(p),
    startDhu: async () => 4242,
    sendDhu: async (_fifo, line) => {
      w.dhuLines.push(line);
      const shot = /^screenshot (.+)$/.exec(line);
      if (shot) w.binary.set(shot[1]!, Buffer.from('PNG'));
      if (line === 'quit') w.dhuAlive = false;
    },
    alive: () => w.dhuAlive,
    kill: () => void (w.dhuAlive = false),
    startEmulator: async () => undefined,
    sleep: async (ms) => void (w.slept += ms),
    nowMs: () => Date.parse('2026-11-09T01:00:00Z'),
    log: () => undefined,
    onInterrupt: (fn) => void (w.interrupt = fn),
  };
  return w;
}

/** The adb shell/exec-out/logcat calls after the device serial, as text. */
export const sent = (w: World) => w.calls.filter((c) => c[0] === '-s').map((c) => c.slice(2).join(' '));
```

`scripts/test/device/cli.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { run } from '../../device/cli.js';
import { ROOT, TEST_EMAIL, planScreen, sent, settings, signIn, world } from './fakes.js';

const logged = (w: ReturnType<typeof world>) => {
  const lines: string[] = [];
  w.deps.log = (l) => void lines.push(l);
  return lines;
};
const session = (w: ReturnType<typeof world>) => JSON.parse(w.files.get(`${ROOT}/.harness/session.json`) ?? 'null');

describe('setting up', () => {
  it('registers a phone and the test account', async () => {
    const w = world();
    w.files.clear();
    expect(await run(['register', 'R5CT9999'], w.deps)).toBe(0);
    expect(await run(['account', 'tester@example.test'], w.deps)).toBe(0);
    expect(JSON.parse(w.files.get(`${ROOT}/.harness/config.json`)!)).toEqual({ testAccountEmail: 'tester@example.test', phones: ['R5CT9999'] });
  });

  it('starts only when Wayfinder is signed in to the test account', async () => {
    const w = world();
    expect(await run(['up'], w.deps)).toBe(0);
    expect(sent(w)).toContain("shell am start -a android.intent.action.VIEW -d 'wayfinder:///settings' app.wayfinder.maps");
    expect(session(w)).toMatchObject({ serial: 'R5CT1234', account: TEST_EMAIL, dhu: null });
  });

  it('touches nothing when the app is signed in to someone else, such as the phone’s owner', async () => {
    const w = world({ screens: [settings('owner@example.test')] });
    const lines = logged(w);
    expect(await run(['up'], w.deps)).toBe(1);
    expect(lines.join('\n')).toContain('signed in as owner@example.test, not the test account');
    expect(session(w).account).toBeNull();
    // So every command that changes anything refuses, sign-out included.
    expect(await run(['tap', '540', '1200'], w.deps)).toBe(1);
    expect(await run(['down'], w.deps)).toBe(0);
    expect(sent(w).some((c) => c.startsWith('shell input'))).toBe(false);
  });

  it('refuses an unregistered phone', async () => {
    const w = world({ devices: 'List of devices attached\nOTHERPHONE\tdevice\n' });
    const lines = logged(w);
    expect(await run(['up'], w.deps)).toBe(1);
    expect(lines.join('\n')).toContain('pnpm device register OTHERPHONE');
    expect(w.calls.filter((c) => c[0] === '-s')).toHaveLength(0);
  });

  it('starts the head unit with --car, and says what to do when it doesn’t stay up', async () => {
    const w = world();
    expect(await run(['up', '--car'], w.deps)).toBe(0);
    expect(sent(w)).toContain('forward tcp:5277 tcp:5277');
    expect(session(w)).toMatchObject({ forward: true, dhu: { pid: 4242 } });
    expect(w.files.get(`${ROOT}/.harness/dhu.ini`)).toContain('location = true');

    const dead = world();
    dead.dhuAlive = false;
    dead.files.set(`${ROOT}/.harness/dhu.log`, 'error while loading shared libraries: libc++.so.1');
    const lines = logged(dead);
    expect(await run(['up', '--car'], dead.deps)).toBe(1);
    expect(lines.join('\n')).toContain('libc++');
  });
});

describe('tapping and typing', () => {
  const started = async (over: Parameters<typeof world>[0] = {}) => {
    const w = world(over);
    await run(['up'], w.deps);
    w.calls.length = 0;
    return w;
  };

  it('taps by visible text, at its centre', async () => {
    const w = await started({ screens: [settings(), planScreen()] });
    expect(await run(['tap', 'Search'], w.deps)).toBe(0);
    expect(sent(w)).toContain('shell input tap 540 250');
  });

  it('only in Wayfinder or its permission prompts', async () => {
    const w = await started();
    w.focus = 'com.google.android.apps.messaging';
    const lines = logged(w);
    expect(await run(['tap', '540', '1200'], w.deps)).toBe(1);
    expect(lines.join('\n')).toContain('com.google.android.apps.messaging is');
    w.focus = 'com.google.android.permissioncontroller';
    expect(await run(['tap', '540', '1200'], w.deps)).toBe(0);
    expect(sent(w).filter((c) => c.startsWith('shell input tap'))).toEqual(['shell input tap 540 1200']);
  });

  it('never taps Sign out or Delete account, by name or by position', async () => {
    const w = await started({ screens: [settings(), planScreen()] });
    expect(await run(['tap', 'Sign out'], w.deps)).toBe(1);
    expect(await run(['tap', '220', '2050'], w.deps)).toBe(1);
    expect(sent(w).some((c) => c.startsWith('shell input tap'))).toBe(false);
  });

  it('stops when the app shows the sign-in screen, until up confirms the account again', async () => {
    const w = await started({ screens: [settings(), signIn()] });
    expect(await run(['type', 'hello'], w.deps)).toBe(1);
    expect(session(w).account).toBeNull();
    expect(await run(['key', 'back'], w.deps)).toBe(1);
  });

  it('types text quoted for the phone’s shell', async () => {
    const w = await started({ screens: [settings(), planScreen()] });
    expect(await run(['type', 'Mt', 'Coot-tha'], w.deps)).toBe(0);
    expect(sent(w)).toContain("shell input text 'Mt%sCoot-tha'");
  });

  it('taps the car only while it shows Wayfinder', async () => {
    const w = world();
    await run(['up', '--car'], w.deps);
    expect(await run(['tap', 'car', '400', '240'], w.deps)).toBe(0);
    expect(w.dhuLines).toContain('tap 400 240');
    w.carLog = 'I WayfinderCar: car screen shown\nI WayfinderCar: car screen hidden\n';
    expect(await run(['tap', 'car', '100', '100'], w.deps)).toBe(1);
    expect(w.dhuLines).not.toContain('tap 100 100');
  });
});

describe('screenshots', () => {
  it('saves the phone’s and the car’s under .harness/shots', async () => {
    const w = world();
    const lines = logged(w);
    await run(['up', '--car'], w.deps);
    expect(await run(['shot', 'phone'], w.deps)).toBe(0);
    expect(await run(['shot', 'car'], w.deps)).toBe(0);
    const paths = lines.filter((l) => l.endsWith('.png'));
    expect(paths).toHaveLength(2);
    expect(paths.every((p) => p.startsWith(`${ROOT}/.harness/shots/`))).toBe(true);
    expect(w.dhuLines.some((l) => l.startsWith('screenshot '))).toBe(true);
  });
});

describe('location', () => {
  it('needs an app version that keeps accounts’ points apart', async () => {
    const w = world({ version: 16 });
    await run(['up'], w.deps);
    const lines = logged(w);
    expect(await run(['gps', '153.02', '-27.47'], w.deps)).toBe(1);
    expect(lines.join('\n')).toContain('versionCode 16');
    expect(sent(w).some((c) => c.includes('location'))).toBe(false);
  });

  it('sets the phone through a test provider, and the car through the head unit, [lon, lat] in', async () => {
    const w = world();
    await run(['up', '--car'], w.deps);
    expect(await run(['gps', '153.02', '-27.47'], w.deps)).toBe(0);
    expect(await run(['gps', '153.03', '-27.48'], w.deps)).toBe(0);
    const s = sent(w);
    expect(s.filter((c) => c.includes('add-test-provider'))).toHaveLength(1);
    expect(s).toContain('shell appops set com.android.shell android:mock_location allow');
    expect(s).toContain('shell cmd location providers set-test-provider-location gps --location -27.470000,153.020000');
    expect(w.dhuLines).toContain('location -27.480000 153.030000 5 0 0.0 0');
  });

  it('uses geo fix on the emulator', async () => {
    const w = world({ devices: 'List of devices attached\nemulator-5554\tdevice\n' });
    await run(['up'], w.deps);
    expect(await run(['gps', '153.02', '-27.47'], w.deps)).toBe(0);
    expect(sent(w)).toContain('emu geo fix 153.020000 -27.470000');
  });

  it('replays a drive a fix a second, and cleans everything up when interrupted', async () => {
    const w = world({ screens: [settings()] });
    w.files.set('/r.geojson', JSON.stringify({ type: 'LineString', coordinates: [[153, -27.5], [153.001, -27.5]] }));
    await run(['up', '--car'], w.deps);
    expect(await run(['drive', '/r.geojson', '--speed', '36'], w.deps)).toBe(0);
    const fixes = sent(w).filter((c) => c.includes('set-test-provider-location'));
    expect(fixes.length).toBeGreaterThan(9);
    expect(w.dhuLines.filter((l) => l.startsWith('location')).at(-1)).toMatch(/ 0\.0 90$/);

    w.deps.sleep = async () => w.interrupt();
    w.screens = [settings(), signIn()];
    expect(await run(['drive', '/r.geojson'], w.deps)).toBe(130);
    expect(session(w)).toBeNull();
    expect(sent(w)).toContain('shell cmd location providers remove-test-provider gps');
  });
});

describe('down', () => {
  it('signs the test account out, turns the test location off and stops the head unit', async () => {
    const w = world();
    await run(['up', '--car'], w.deps);
    await run(['gps', '153.02', '-27.47'], w.deps);
    w.calls.length = 0;
    w.screens = [settings(), signIn()];
    const lines = logged(w);
    expect(await run(['down'], w.deps)).toBe(0);
    const s = sent(w);
    expect(s).toContain('shell input tap 220 2050');
    expect(s).toContain('shell cmd location providers remove-test-provider gps');
    expect(s).toContain('shell appops set com.android.shell android:mock_location deny');
    expect(s).toContain('forward --remove tcp:5277');
    expect(w.dhuLines.at(-1)).toBe('quit');
    expect(session(w)).toBeNull();
    expect(lines.join('\n')).toContain('Signed out of');
  });

  it('says plainly when the test account may still be signed in', async () => {
    const w = world();
    await run(['up'], w.deps);
    w.screens = [settings()]; // Sign out tapped, but the sign-in screen never comes
    const lines = logged(w);
    expect(await run(['down'], w.deps)).toBe(1);
    expect(lines.join('\n')).toContain(`may still be signed in to ${TEST_EMAIL}`);
  });

  it('never signs out an account that isn’t the test account', async () => {
    const w = world();
    await run(['up'], w.deps);
    w.calls.length = 0;
    w.screens = [settings('owner@example.test')];
    expect(await run(['down'], w.deps)).toBe(1);
    expect(sent(w).some((c) => c.startsWith('shell input tap'))).toBe(false);
  });
});

describe('the emulator', () => {
  it('installs an APK there and nowhere else', async () => {
    const phone = world();
    expect(await run(['install', '/a.apk'], phone.deps)).toBe(1);
    expect(sent(phone).some((c) => c.startsWith('install'))).toBe(false);
    const emu = world({ devices: 'List of devices attached\nemulator-5554\tdevice\n' });
    expect(await run(['install', '/a.apk'], emu.deps)).toBe(0);
    expect(sent(emu)).toContain('install -r /a.apk');
  });
});
```

- [ ] **Step 4: Run them to see them fail**

Run: `npx vitest run scripts/test/device/cli.test.ts`
Expected: FAIL, `../../device/cli.js` not found.

- [ ] **Step 5: `scripts/device/cli.ts`**

```ts
/**
 * `pnpm device …`: screenshots, taps, typing, GPS and drive replay on a phone (with the Desktop
 * Head Unit for Android Auto) or the emulator. Safeguards, all enforced here and tested in
 * scripts/test/device: a phone must be registered; taps only land in Wayfinder (or its permission
 * prompts), never on Sign out or Delete account; everything that changes anything needs the app
 * signed in to the configured test account; drives need an app version that keeps each account's
 * queued points apart; `down` signs the test account out and undoes the rest. docs/development.md,
 * "Device harness".
 */
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { type AdbCommand, type Device, type Key, APP, LIST_DEVICES, MIN_SAFE_VERSION_CODE, adbArgs, carShowsWayfinder, focusedPackage, parseDevices, pickDevice, versionCode } from './adb.js';
import { CAR_KEYS, type CarKey, DHU_CONFIG, dhuCommand } from './dhu.js';
import { type Fix, readRoute, replay } from './route.js';
import { type Config, type Files, type Session, clearSession, harnessDir, loadConfig, loadSession, saveConfig, saveSession } from './state.js';
import { type UiNode, centre, describeScreen, findByText, forbiddenAt, isSignInScreen, label, parseUiDump, screenSize, signedInEmail } from './ui.js';

export interface Deps {
  root: string;
  adb: (args: string[]) => Promise<{ code: number; out: Buffer; err: string }>;
  files: Files;
  writeBinary: (path: string, data: Buffer) => Promise<void>;
  exists: (path: string) => Promise<boolean>;
  /** Start the DHU reading console commands from `fifo`; returns its pid. */
  startDhu: (o: { fifo: string; config: string; headless: boolean }) => Promise<number>;
  sendDhu: (fifo: string, line: string) => Promise<void>;
  alive: (pid: number) => boolean;
  kill: (pid: number) => void;
  startEmulator: () => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  nowMs: () => number;
  log: (line: string) => void;
  onInterrupt: (fn: () => void) => void;
}

/** Apps a phone tap may land in: Wayfinder, and the permission prompts it causes. */
export const TAP_PACKAGES = [APP, 'com.google.android.permissioncontroller', 'com.android.permissioncontroller'];

const USAGE = `Usage: pnpm device <command>
  register <serial>            allow the harness to use this phone
  account <email>              the test account the app must be signed in to
  devices                      attached devices, and which may be used
  up [--car] [--window] [--emulator] [--device <serial>]
                               check the app is on the test account; --car starts the head unit
  shot phone|car [--out f.png] screenshot; prints the file
  ui                           what's on the phone's screen, and where to tap it
  tap <text> | tap <x> <y> | tap car <x> <y>
  type <text>   key back|home|enter   swipe <x1> <y1> <x2> <y2>
  gps <lon> <lat> [--phone|--car]   gps reset
  drive <route.geojson|.gpx> [--speed <km/h>]
  car day|night | car key ${CAR_KEYS.join('|')} | car restrict on|off
  logs                         app and car logs since the last look
  install <apk>                emulator only
  down                         sign the test account out and undo everything`;

class Refused extends Error {}

interface Ctx {
  deps: Deps;
  config: Config;
  session: Session | null;
  device: Device;
}

async function adb(ctx: Ctx, cmd: AdbCommand): Promise<Buffer> {
  const r = await ctx.deps.adb(adbArgs(ctx.device, cmd));
  if (r.code !== 0) throw new Error(`adb ${cmd.kind} failed: ${r.err.trim() || `exit ${r.code}`}`);
  return r.out;
}
const text = async (ctx: Ctx, cmd: AdbCommand) => (await adb(ctx, cmd)).toString('utf8');
const screen = async (ctx: Ctx): Promise<UiNode[]> => parseUiDump(await text(ctx, { kind: 'uiDump' }));
const save = (ctx: Ctx) => saveSession(ctx.deps.files, ctx.deps.root, ctx.session!);
const sameEmail = (a: string | null, b: string) => !!a && a.toLowerCase() === b.toLowerCase();

function requireSession(ctx: Ctx): Session {
  const s = ctx.session;
  if (!s || s.serial !== ctx.device.serial) throw new Refused('No harness session on this device: run pnpm device up first.');
  if (!ctx.config.testAccountEmail) throw new Refused('No test account set: pnpm device account <email>.');
  if (!sameEmail(s.account, ctx.config.testAccountEmail)) throw new Refused(`Wayfinder isn't known to be signed in to the test account (${ctx.config.testAccountEmail}). Ask for it to be signed in, then run pnpm device up.`);
  return s;
}

/** Before anything that touches the phone: the test account's session, Wayfinder in front, still signed in, and not a control the harness never taps. */
async function guardPhone(ctx: Ctx, at?: [number, number]): Promise<UiNode[]> {
  const s = requireSession(ctx);
  const pkg = focusedPackage(await text(ctx, { kind: 'focus' }));
  if (!pkg || !TAP_PACKAGES.includes(pkg)) throw new Refused(`Wayfinder isn't in front (${pkg ? `${pkg} is` : 'the lock screen or notification shade is'}), so nothing was done.`);
  const nodes = await screen(ctx);
  if (pkg === APP && isSignInScreen(nodes)) {
    s.account = null;
    await save(ctx);
    throw new Refused('Wayfinder is on its sign-in screen, so the test account is signed out. Ask for it to be signed in again, then run pnpm device up.');
  }
  if (at) {
    const f = forbiddenAt(nodes, at[0], at[1]);
    if (f) throw new Refused(`That would tap "${f}". The harness never does: pnpm device down signs the test account out.`);
  }
  return nodes;
}

async function guardVersion(ctx: Ctx) {
  const v = versionCode(await text(ctx, { kind: 'version' }));
  if (v === null || v < MIN_SAFE_VERSION_CODE) {
    throw new Refused(`Wayfinder here is versionCode ${v ?? 'unknown'}. Moving the GPS needs ${MIN_SAFE_VERSION_CODE} or later, which keeps each account's recorded points to that account; update it from Play's internal testing first.`);
  }
}

function requireDhu(ctx: Ctx): { pid: number; fifo: string } {
  const dhu = ctx.session?.dhu;
  if (!dhu || !ctx.deps.alive(dhu.pid)) throw new Refused('The head unit isn’t running: pnpm device up --car.');
  return dhu;
}

async function readSettings(ctx: Ctx): Promise<UiNode[]> {
  await adb(ctx, { kind: 'open', path: '/settings' });
  await ctx.deps.sleep(2500);
  return screen(ctx);
}

async function up(ctx: Ctx, o: { car: boolean; window: boolean; startedEmulator: boolean }) {
  const { deps, config, device } = ctx;
  if (!config.testAccountEmail) throw new Refused('No test account set: pnpm device account <email>.');
  if (ctx.session) throw new Refused('A session is already open: pnpm device down first.');
  ctx.session = { serial: device.serial, emulator: device.emulator, account: null, testProvider: false, forward: false, dhu: null, startedEmulator: o.startedEmulator, logsSince: deps.nowMs() / 1000 };
  await save(ctx); // first, so down can undo whatever follows even if up stops part-way

  const nodes = await readSettings(ctx);
  if (isSignInScreen(nodes)) throw new Refused(`Wayfinder is signed out. Ask for it to be signed in to ${config.testAccountEmail}, then run up again.`);
  const email = signedInEmail(nodes);
  if (!sameEmail(email, config.testAccountEmail)) {
    throw new Refused(`Wayfinder is signed in as ${email ?? 'someone the harness can’t read on Settings'}, not the test account (${config.testAccountEmail}). Nothing was tapped. Run pnpm device down, sign in to the test account, then up again.`);
  }
  ctx.session.account = email;
  await save(ctx);
  const v = versionCode(await text(ctx, { kind: 'version' }));
  deps.log(`${device.emulator ? 'Emulator' : 'Phone'} ${device.serial}: Wayfinder versionCode ${v ?? '?'}, signed in to the test account ${email}.`);
  if (v === null || v < MIN_SAFE_VERSION_CODE) deps.log(`gps and drive will refuse until it's versionCode ${MIN_SAFE_VERSION_CODE} or later.`);

  if (o.car) {
    await adb(ctx, { kind: 'forward', add: true });
    ctx.session.forward = true;
    await save(ctx);
    const dir = harnessDir(deps.root);
    const ini = join(dir, 'dhu.ini');
    await deps.files.write(ini, DHU_CONFIG);
    const fifo = join(dir, 'dhu.fifo');
    const pid = await deps.startDhu({ fifo, config: ini, headless: !o.window });
    ctx.session.dhu = { pid, fifo };
    await save(ctx);
    await deps.sleep(3000);
    if (!deps.alive(pid)) {
      const log = (await deps.files.read(join(dir, 'dhu.log'))) ?? '';
      throw new Refused(
        log.includes('libc++')
          ? 'The head unit needs libc++: sudo pacman -S libc++ (Arch) or apt install libc++1 libc++abi1.'
          : `The head unit stopped straight away. On the phone, start Android Auto's head unit server (Android Auto settings, ⋮, Start head unit server), then pnpm device down and up --car again. Its log: ${join(dir, 'dhu.log')}`,
      );
    }
    deps.log('Head unit running.');
  }
}

async function shot(ctx: Ctx, which: string, out?: string) {
  const stamp = new Date(ctx.deps.nowMs()).toISOString().replace(/[:.]/g, '-');
  const path = out ?? join(harnessDir(ctx.deps.root), 'shots', `${which}-${stamp}.png`);
  if (/\s/.test(path)) throw new Refused('Screenshot paths can’t contain spaces (the head unit splits on them).');
  if (which === 'phone') {
    await ctx.deps.writeBinary(path, await adb(ctx, { kind: 'screencap' }));
  } else if (which === 'car') {
    const dhu = requireDhu(ctx);
    await ctx.deps.sendDhu(dhu.fifo, dhuCommand.screenshot(path));
    let waited = 0;
    while (!(await ctx.deps.exists(path))) {
      if (waited >= 10_000) throw new Error('The head unit didn’t save the screenshot.');
      await ctx.deps.sleep(250);
      waited += 250;
    }
  } else throw new Refused('shot phone or shot car');
  ctx.deps.log(path);
}

async function tap(ctx: Ctx, args: string[]) {
  const nums = args.map(Number);
  if (args[0] === 'car') {
    if (!Number.isFinite(nums[1]) || !Number.isFinite(nums[2])) throw new Refused('tap car <x> <y>');
    requireSession(ctx);
    const dhu = requireDhu(ctx);
    if (!carShowsWayfinder(await text(ctx, { kind: 'carLog' }))) throw new Refused('The car screen isn’t showing Wayfinder (by its log), so nothing was tapped.');
    await ctx.deps.sendDhu(dhu.fifo, dhuCommand.tap(nums[1]!, nums[2]!));
    return;
  }
  if (args.length === 2 && nums.every(Number.isFinite)) {
    await guardPhone(ctx, [nums[0]!, nums[1]!]);
    await adb(ctx, { kind: 'tap', x: nums[0]!, y: nums[1]! });
    return;
  }
  const nodes = await guardPhone(ctx);
  const [x, y] = centre(findByText(nodes, args.join(' ')));
  const f = forbiddenAt(nodes, x, y);
  if (f) throw new Refused(`That would tap "${f}". The harness never does: pnpm device down signs the test account out.`);
  await adb(ctx, { kind: 'tap', x, y });
}

async function setPosition(ctx: Ctx, f: Pick<Fix, 'lon' | 'lat' | 'speedMps' | 'bearingDeg'>, phone: boolean, car: boolean) {
  const s = ctx.session!;
  if (phone) {
    if (ctx.device.emulator) await adb(ctx, { kind: 'geoFix', lon: f.lon, lat: f.lat });
    else {
      if (!s.testProvider) {
        await adb(ctx, { kind: 'mockLocation', allow: true });
        await adb(ctx, { kind: 'testProvider', add: true });
        s.testProvider = true;
        await save(ctx);
      }
      await adb(ctx, { kind: 'testLocation', lon: f.lon, lat: f.lat });
    }
  }
  if (car && s.dhu) await ctx.deps.sendDhu(s.dhu.fifo, dhuCommand.location(f.lon, f.lat, f.speedMps, f.bearingDeg));
}

async function resetGps(ctx: Ctx) {
  const s = ctx.session;
  if (!s?.testProvider) return;
  await adb(ctx, { kind: 'testProvider', add: false });
  await adb(ctx, { kind: 'mockLocation', allow: false });
  s.testProvider = false;
  await save(ctx);
}

/** Sign the test account out through Settings, only if Settings shows the test account. */
async function signOut(ctx: Ctx) {
  const s = ctx.session!;
  if (!s.account) return; // never confirmed as the test account: leave the app as it is
  let nodes = await readSettings(ctx);
  if (isSignInScreen(nodes)) return;
  const email = signedInEmail(nodes);
  if (!sameEmail(email, ctx.config.testAccountEmail)) throw new Error(`Settings shows ${email ?? 'no account'}, not the test account, so it was left signed in.`);
  const [w, h] = screenSize(nodes);
  for (let i = 0; i < 6 && !nodes.some((n) => label(n) === 'Sign out'); i++) {
    await adb(ctx, { kind: 'swipe', x1: w / 2, y1: h * 0.75, x2: w / 2, y2: h * 0.25 });
    await ctx.deps.sleep(600);
    nodes = await screen(ctx);
  }
  const [x, y] = centre(findByText(nodes, 'Sign out'));
  await adb(ctx, { kind: 'tap', x, y });
  await ctx.deps.sleep(2500);
  if (!isSignInScreen(await screen(ctx))) throw new Error('Sign out was tapped but the sign-in screen didn’t appear.');
  s.account = null;
  await save(ctx);
  ctx.deps.log(`Signed out of ${ctx.config.testAccountEmail}.`);
}

async function down(ctx: Ctx): Promise<number> {
  const s = ctx.session;
  if (!s) {
    ctx.deps.log('No session open.');
    return 0;
  }
  const account = s.account;
  const problems: string[] = [];
  const step = async (what: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      problems.push(`${what}: ${(e as Error).message}`);
    }
  };
  await step('sign out', () => signOut(ctx));
  await step('test location', () => resetGps(ctx));
  if (s.forward) await step('port forward', () => adb(ctx, { kind: 'forward', add: false }));
  if (s.dhu) {
    const dhu = s.dhu;
    await step('head unit', async () => {
      if (ctx.deps.alive(dhu.pid)) await ctx.deps.sendDhu(dhu.fifo, dhuCommand.quit());
      await ctx.deps.sleep(1500);
      if (ctx.deps.alive(dhu.pid)) ctx.deps.kill(dhu.pid);
    });
  }
  if (s.startedEmulator) await step('emulator', () => adb(ctx, { kind: 'emuKill' }));
  await clearSession(ctx.deps.files, ctx.deps.root);
  for (const p of problems) ctx.deps.log(`Not done: ${p}`);
  if (account && problems.some((p) => p.startsWith('sign out'))) ctx.deps.log(`The phone may still be signed in to ${account}. Sign out in Wayfinder, Settings.`);
  return problems.length ? 1 : 0;
}

async function drive(ctx: Ctx, file: string, speedKmh: number): Promise<number> {
  requireSession(ctx);
  await guardVersion(ctx);
  const routeText = await ctx.deps.files.read(file);
  if (routeText === null) throw new Refused(`Can't read ${file}`);
  const fixes = replay(readRoute(routeText, file), speedKmh);
  let stopped = false;
  ctx.deps.onInterrupt(() => void (stopped = true));
  try {
    for (const f of fixes) {
      if (stopped) break;
      await setPosition(ctx, f, true, true);
      await ctx.deps.sleep(1000);
    }
  } catch (e) {
    await down(ctx);
    throw e;
  }
  if (stopped) {
    await down(ctx);
    ctx.deps.log('Stopped; everything undone as by pnpm device down.');
    return 130;
  }
  ctx.deps.log(`Drove ${fixes.length} fixes (${Math.round(fixes.at(-1)!.atS / 60)} min at ${speedKmh} km/h).`);
  return 0;
}

export async function run(argv: string[], deps: Deps): Promise<number> {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        device: { type: 'string' },
        car: { type: 'boolean', default: false },
        phone: { type: 'boolean', default: false },
        window: { type: 'boolean', default: false },
        emulator: { type: 'boolean', default: false },
        out: { type: 'string' },
        speed: { type: 'string', default: '50' },
      },
    });
    const [command, ...args] = positionals;
    const config = await loadConfig(deps.files, deps.root);
    if (command === 'register' && args[0]) {
      await saveConfig(deps.files, deps.root, { ...config, phones: [...new Set([...config.phones, args[0]])] });
      deps.log(`Registered ${args[0]}.`);
      return 0;
    }
    if (command === 'account' && args[0]) {
      await saveConfig(deps.files, deps.root, { ...config, testAccountEmail: args[0] });
      deps.log(`Test account: ${args[0]}`);
      return 0;
    }
    const session = await loadSession(deps.files, deps.root);
    const devicesOut = async () => (await deps.adb(LIST_DEVICES)).out.toString('utf8');
    if (command === 'devices') {
      for (const d of parseDevices(await devicesOut())) {
        const ok = d.serial.startsWith('emulator-') || config.phones.includes(d.serial);
        deps.log(`${d.serial}\t${d.state}\t${ok ? 'may be used' : 'not registered'}`);
      }
      return 0;
    }
    let startedEmulator = false;
    if (command === 'up' && values.emulator && !parseDevices(await devicesOut()).some((d) => d.serial.startsWith('emulator-'))) {
      await deps.startEmulator();
      startedEmulator = true;
    }
    const named = values.device ?? session?.serial ?? (values.emulator ? parseDevices(await devicesOut()).find((d) => d.serial.startsWith('emulator-'))?.serial : undefined);
    const device = pickDevice(parseDevices(await devicesOut()), config.phones, named);
    const ctx: Ctx = { deps, config, session, device };

    switch (command) {
      case 'up':
        await up(ctx, { car: values.car!, window: values.window!, startedEmulator });
        return 0;
      case 'shot':
        await shot(ctx, args[0] ?? '', values.out);
        return 0;
      case 'ui':
        for (const line of describeScreen(await screen(ctx))) deps.log(line);
        return 0;
      case 'tap':
        await tap(ctx, args);
        return 0;
      case 'type':
        await guardPhone(ctx);
        await adb(ctx, { kind: 'text', text: args.join(' ') });
        return 0;
      case 'key':
        if (!['back', 'home', 'enter'].includes(args[0] ?? '')) throw new Refused('key back|home|enter');
        await guardPhone(ctx);
        await adb(ctx, { kind: 'key', key: args[0] as Key });
        return 0;
      case 'swipe': {
        const [x1, y1, x2, y2] = args.map(Number);
        await guardPhone(ctx, [x1!, y1!]);
        await adb(ctx, { kind: 'swipe', x1: x1!, y1: y1!, x2: x2!, y2: y2! });
        return 0;
      }
      case 'gps': {
        requireSession(ctx);
        if (args[0] === 'reset') {
          await resetGps(ctx);
          return 0;
        }
        await guardVersion(ctx);
        const [lon, lat] = args.map(Number);
        const both = !values.phone && !values.car;
        await setPosition(ctx, { lon: lon!, lat: lat!, speedMps: 0, bearingDeg: 0 }, both || values.phone!, both || values.car!);
        return 0;
      }
      case 'drive':
        return await drive(ctx, args[0] ?? '', Number(values.speed));
      case 'car': {
        requireSession(ctx);
        const dhu = requireDhu(ctx);
        const [what, arg] = args;
        const line =
          what === 'day' ? dhuCommand.day()
          : what === 'night' ? dhuCommand.night()
          : what === 'key' && (CAR_KEYS as readonly string[]).includes(arg ?? '') ? dhuCommand.key(arg as CarKey)
          : what === 'restrict' && (arg === 'on' || arg === 'off') ? dhuCommand.restrict(arg === 'on')
          : null;
        if (!line) throw new Refused(`car day|night | car key ${CAR_KEYS.join('|')} | car restrict on|off`);
        await deps.sendDhu(dhu.fifo, line);
        return 0;
      }
      case 'logs': {
        const since = ctx.session?.logsSince ?? deps.nowMs() / 1000 - 300;
        deps.log(await text(ctx, { kind: 'logs', sinceEpochS: since }));
        if (ctx.session) {
          ctx.session.logsSince = deps.nowMs() / 1000;
          await save(ctx);
        }
        return 0;
      }
      case 'install':
        if (!device.emulator) throw new Refused('install only runs on the emulator; a phone keeps its Play build.');
        await adb(ctx, { kind: 'install', apk: args[0] ?? '' });
        return 0;
      case 'down':
        return await down(ctx);
      default:
        deps.log(USAGE);
        return command ? 1 : 0;
    }
  } catch (e) {
    deps.log(e instanceof Refused ? `Refused: ${e.message}` : `Error: ${(e as Error).message}`);
    return 1;
  }
}
```

Note on the "touches nothing when signed in to someone else" test: `up` leaves the session saved with `account: null`, so `down` there skips sign-out (`signOut` returns early) and only clears the session; it returns 0.

- [ ] **Step 6: Run the tests, fix until they pass**

Run: `npx vitest run scripts/test/device`
Expected: PASS. Where a test and the code disagree, decide from the spec which is right; never loosen a safety test (focus, Sign out, account, version, registration) to pass.

- [ ] **Step 7: Entry point, script, ignore file, sample route**

`scripts/device.ts`:

```ts
/** Entry point for `pnpm device …`; the commands are in scripts/device/cli.ts. */
import { execFile, execFileSync, spawn } from 'node:child_process';
import { constants, openSync } from 'node:fs';
import { mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { run } from './device/cli.js';

const root = resolve(import.meta.dirname, '..');
const sdk = process.env.ANDROID_HOME ?? join(process.env.ANDROID_DIR ?? join(homedir(), 'Android'), 'Sdk');
const adbPath = join(sdk, 'platform-tools/adb');
const dhuDir = join(sdk, 'extras/google/auto');

process.exitCode = await run(process.argv.slice(2), {
  root,
  adb: (args) =>
    new Promise((done) =>
      execFile(adbPath, args, { encoding: 'buffer', maxBuffer: 64 << 20 }, (err, stdout, stderr) =>
        done({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: stdout, err: stderr.toString() }),
      ),
    ),
  files: {
    read: (p) => readFile(p, 'utf8').catch(() => null),
    write: async (p, t) => {
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, t);
    },
    remove: (p) => rm(p, { force: true }),
  },
  writeBinary: async (p, b) => {
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, b);
  },
  exists: (p) => stat(p).then(() => true, () => false),
  startDhu: async ({ fifo, config, headless }) => {
    await mkdir(dirname(fifo), { recursive: true });
    await rm(fifo, { force: true });
    execFileSync('mkfifo', [fifo]);
    // Opened read-write so the DHU never sees end-of-input between commands.
    const input = openSync(fifo, 'r+');
    const log = openSync(join(dirname(fifo), 'dhu.log'), 'a');
    const child = spawn(join(dhuDir, 'desktop-head-unit'), ['-c', config, ...(headless ? ['--headless'] : [])], { cwd: dhuDir, stdio: [input, log, log], detached: true });
    child.unref();
    return child.pid!;
  },
  sendDhu: async (fifo, line) => {
    // Non-blocking: with no head unit reading, this fails instead of hanging.
    const fh = await open(fifo, constants.O_WRONLY | constants.O_NONBLOCK);
    try {
      await fh.write(`${line}\n`);
    } finally {
      await fh.close();
    }
  },
  alive: (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  },
  kill: (pid) => {
    try {
      process.kill(pid);
    } catch {
      // already gone
    }
  },
  startEmulator: () =>
    new Promise((done, fail) => execFile('sh', [join(root, 'infra/scripts/android-emulator.sh'), 'start'], (err) => (err ? fail(err) : done()))),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  nowMs: () => Date.now(),
  log: (line) => console.log(line),
  onInterrupt: (fn) => {
    process.once('SIGINT', fn);
    process.once('SIGTERM', fn);
  },
});
```

`package.json` scripts, after `"play": …`:

```json
    "device": "tsx --conditions=development scripts/device.ts"
```

`.gitignore`, after `dist-check/`:

```
# The device harness's settings, session and screenshots (scripts/device)
.harness/
```

`scripts/device/routes/brisbane-to-mt-coot-tha.geojson` (rough, along Milton Rd and Sir Samuel Griffith Dr; for moving the GPS, not for matching every road exactly):

```json
{
  "type": "Feature",
  "properties": { "name": "Brisbane CBD to Mt Coot-tha Lookout (approximate)" },
  "geometry": {
    "type": "LineString",
    "coordinates": [
      [153.0251, -27.4698], [153.0172, -27.4679], [153.0093, -27.4688], [153.0012, -27.4708],
      [152.9942, -27.4724], [152.9871, -27.4741], [152.9803, -27.4766], [152.9741, -27.4789],
      [152.9686, -27.4805], [152.9637, -27.4826], [152.9598, -27.4842], [152.9573, -27.4851]
    ]
  }
}
```

- [ ] **Step 8: Add an entry test for the sample route**

Append to `scripts/test/device/route.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

it('reads the checked-in sample route', () => {
  const file = resolve(import.meta.dirname, '../../device/routes/brisbane-to-mt-coot-tha.geojson');
  const line = readRoute(readFileSync(file, 'utf8'), file);
  expect(line[0]).toEqual([153.0251, -27.4698]);
  expect(replay(line, 50).length).toBeGreaterThan(400);
});
```

(Move the two imports to the top of the file.)

- [ ] **Step 9: Run tests, lint and a dry run**

Run: `npx vitest run scripts/test/device && pnpm lint`
Expected: PASS, no lint errors.

Run: `pnpm device` (no arguments)
Expected: the usage text, exit 0.

Run: `pnpm device devices`
Expected: lists attached devices (or nothing), exit 0.

- [ ] **Step 10: Commit**

```bash
git add scripts/device scripts/device.ts scripts/test/device package.json .gitignore
git commit -m "Add pnpm device: screenshots, taps, GPS and drives on the phone and car screen" -m "There was no way to see or drive the app and its Android Auto screen except by hand. pnpm device takes screenshots of both, taps by name or position, types, sets the phone's and the car's position and replays a route a fix a second, with the head unit driven through its console. It acts only on a registered phone, only in Wayfinder, never on Sign out or Delete account, only while the app is signed in to the test account, moves the GPS only on an app that keeps accounts' points apart, and down signs the test account out and undoes the rest." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Docs

**Files:**
- Modify: `docs/development.md` (Emulator section's adb table → new "Device harness" section)
- Modify: `docs/testing.md` (feature map; the commands table)
- Modify: `docs/api.md:141`
- Modify: `docs/architecture.md:109` and the light-timing paragraph
- Modify: `docs/build-android.md` ("Trying it in a car": point to the harness)

- [ ] **Step 1: development.md**

Replace the "Useful `adb` commands" table under Emulator with a pointer ("Use the device harness below; for anything it doesn't do, `adb` directly"), and add a section `### Device harness` after Emulator containing:

- What it is: `pnpm device …` drives Wayfinder on a registered phone (with the DHU for Android Auto) or the emulator; screenshots go to `.harness/shots/`.
- One-off setup, in order:
  1. `sdkmanager "extras;google;auto"`; on Arch `sudo pacman -S libc++` (Debian: `libc++1 libc++abi1`).
  2. The user creates a Wayfinder account for testing, makes it an admin, and switches **Test account** on in `/admin` (its drives don't count towards learned speeds or light timings).
  3. `pnpm device account <that email>` and, for a phone, `pnpm device register <serial>` (`pnpm device devices` shows the serial).
  4. On the phone, by the user: Android Auto's developer settings on (tap the version 10 times), Unknown sources on, and **Start head unit server** from its ⋮ menu (each time the phone restarts).
  5. Before each session the user signs Wayfinder in to the test account.
- The commands table from `scripts/device/cli.ts`'s `USAGE`.
- The safeguards (copy the eight from the spec, in plain words).
- Undoing the phone changes: Android Auto developer settings (⋮, Stop head unit server; developer settings off in its menu); `adb shell appops set com.android.shell android:mock_location deny` (done by `down`); `adb shell cmd location providers remove-test-provider gps` (done by `down`).
- Android Auto doesn't run on an emulator (spec Findings), so the car side needs the phone.

- [ ] **Step 2: testing.md**

In the commands table add a row: `pnpm device …` — "Not a test suite: drives the app on a phone or emulator for checking by eye (development.md, Device harness). Its logic is tested in `scripts/test/device`."

In the feature map add rows:
- Test accounts (learning skips them; admin switch): `packages/core/test/integration/road-facts.test.ts`, `admin.test.ts`, `apps/api/test/integration/admin-api.test.ts`, `apps/web/test/admin-management.test.tsx`.
- Upload queue keeps each account's points: `apps/mobile/test/queue.test.ts`, `tracking.native.test.tsx`, `device.native.test.tsx`.
- Car screen shown/hidden log: `CarVisibilityTest.kt`.
- Device harness: `scripts/test/device/*.test.ts`.

- [ ] **Step 3: api.md and architecture.md**

`docs/api.md` line 141: `| PATCH | \`/users/:id\` (**admin**) | Role, disable, test account (its drives don't count towards learned speeds or light timings) |`

`docs/architecture.md`: in "Speeds learned from drives" change "or deleted or disabled accounts" to "or deleted, disabled or test accounts (an admin marks an account used for testing, so test drives never change anyone's routes)"; in "Waits at lights learned from drives" add the same exclusion where it says which drives count (add the sentence "Test accounts' drives don't count." if it doesn't say).

- [ ] **Step 4: build-android.md**

At the end of "Trying it in a car", add: "To script it (screenshots, taps, the car's GPS, replaying a drive), use the device harness: [development.md](development.md#device-harness)."

- [ ] **Step 5: Commit**

```bash
git add docs
git commit -m "Document the device harness and test accounts" -m "The harness, the test account it needs, and the setup the phone needs were only in the spec. development.md now says how to set it up, what each command does, what it will never do and how to undo its phone changes; the API, architecture and testing docs cover test accounts and the queue fix." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Check, push, deploy the server, ship the app to internal testing

**Files:**
- Modify: `apps/mobile/app.config.ts` (version `0.6.1`, versionCode `17`), `apps/mobile/package.json` (version `0.6.1`)
- Modify: `docs/verification.md` (release record)

- [ ] **Step 1: Whole suite**

Run: `pnpm check`
Expected: PASS. On a failure, fix the cause and rerun only what failed (then `pnpm check` once at the end). Never lower a floor; if `scripts/device` lowers global coverage, add tests.

- [ ] **Step 2: Push**

```bash
git push origin master
```

- [ ] **Step 3: Deploy the server (migration 011, admin switch)**

Follow `docs/deploy-small-server.md` exactly: build images here, `infra/scripts/deploy-small.sh images`, update `/opt/wayfinder` on `ssh root@maps`, `docker compose -f docker-compose.yml -f docker-compose.small.yml up -d` from `/opt/wayfinder/infra`. Then `VERIFY_REGION=qld pnpm verify:stack` and `VERIFY_REGION=qld pnpm verify:mobile`. Confirm the migration ran: `ssh root@maps "docker compose -f /opt/wayfinder/infra/docker-compose.yml -f /opt/wayfinder/infra/docker-compose.small.yml exec -T db psql -U postgres -d wayfinder -c '\d users'"` shows `test_account`. (Use the database name and user from the compose file if they differ.)

- [ ] **Step 4: Bump and build the app**

`apps/mobile/app.config.ts`: `version: '0.6.1'`, `versionCode: 17`. `apps/mobile/package.json`: `"version": "0.6.1"`. Build the release bundle for `https://maps.coolcodertech.com` by `docs/build-android.md` (about 10 minutes; it holds `node_modules`, so run no pnpm meanwhile). Install the APK on the emulator (`infra/scripts/android-emulator.sh start && infra/scripts/android-emulator.sh install`) and check it opens with no crash: `~/Android/Sdk/platform-tools/adb logcat -d | grep -E "FATAL|AndroidRuntime: "` prints nothing.

- [ ] **Step 5: Internal testing only**

```bash
pnpm play upload
```

(Internal track by default. Not `--track closed`, not `pnpm play promote`.)

- [ ] **Step 6: Record and commit**

Add to `docs/verification.md`: "App 0.6.1 (versionCode 17, 2026-11-…): each account's queued points stay with that account (a fake or real drive no longer uploads as the next account to sign in); the car app logs when its screen is shown. Server: test accounts. Passed `pnpm check`; installs and opens on the emulator; internal testing only."

```bash
git add apps/mobile/app.config.ts apps/mobile/package.json docs/verification.md
git commit -m "Ship 0.6.1 to internal testing" -m "The queue fix and the car's shown/hidden log were in the code but on no phone, and the harness refuses to move the GPS on an older version. This bumps the app to 0.6.1 / versionCode 17, built for maps.coolcodertech.com and rolled out to internal testing only, with the server's test accounts deployed alongside." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin master
```

---

### Task 10: On the phone (with the user)

Needs the user: their phone on USB with USB debugging, 0.6.1 from Play's internal testing, the test account created, flagged as a test account and signed in, and Android Auto's head unit server started (development.md, Device harness, setup).

- [ ] **Step 1: Register and start**

```bash
pnpm device devices
```

```bash
pnpm device register <serial shown>
```

```bash
pnpm device account <test account email>
```

```bash
pnpm device up --car --window
```

Expected: "signed in to the test account …", "Head unit running." and a DHU window. If it refuses, follow its message; don't work around it.

- [ ] **Step 2: Check the three unknowns from the spec**

1. Phone GPS: `pnpm device gps 153.0251 -27.4698`, then `pnpm device shot phone` and open the PNG: Wayfinder's map is at Brisbane CBD. If `cmd location providers` is refused on this phone, record it in the spec's Findings, make `setPosition` skip the phone on real phones (car only) with a test, and tell the user.
2. Car shown/hidden: `pnpm device car key navigation` then `pnpm device tap car 400 240` (allowed); open the dialler on the car with the DHU window's own controls (by the user, not the harness), then `pnpm device tap car 400 240` refuses. If both behave, the log works; if not, report to the user before going further (spec: car taps are dropped if there's no reliable signal).
3. Sign-in screen detection: confirm `pnpm device ui` on Wayfinder's sign-in screen shows "Password" and "Sign in" labels (check during Step 4's `down`).

- [ ] **Step 3: A short drive**

```bash
pnpm device drive scripts/device/routes/brisbane-to-mt-coot-tha.geojson --speed 60
```

While it runs, in another shell: `pnpm device shot car` and `pnpm device shot phone` a few times. Expected: the car map follows the drive; no crash in `pnpm device logs`.

- [ ] **Step 4: Down**

```bash
pnpm device down
```

Expected: "Signed out of …", exit 0. Check: `~/Android/Sdk/platform-tools/adb shell cmd location providers list` doesn't list a test provider; the DHU has quit; Wayfinder shows its sign-in screen. Tell the user they can sign back in to their own account.

- [ ] **Step 5: Record**

In `docs/verification.md`: a "Device harness" entry with the date, phone model, what ran and passed (Steps 1–4), and any Android Auto checklist items actually seen working during the run, ticked with the date. Leave untouched any item not actually seen.

```bash
git add docs/verification.md
git commit -m "Record the first device harness run on a phone" -m "<what ran, on which phone, and what passed or failed>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin master
```

---

### Task 11: Remove the spike's Play Store emulator (after the user confirms)

- [ ] **Step 1: Ask the user** whether to delete the `wayfinder-play` emulator (it has their Google account signed in) and the `system-images;android-36;google_apis_playstore;x86_64` image (about 1.5 GB). Only on a yes:

```bash
~/Android/Sdk/platform-tools/adb -s emulator-5554 emu kill
```

```bash
JAVA_HOME=~/Android/jdk ~/Android/Sdk/cmdline-tools/latest/bin/avdmanager delete avd -n wayfinder-play
```

```bash
JAVA_HOME=~/Android/jdk ~/Android/Sdk/cmdline-tools/latest/bin/sdkmanager --uninstall "system-images;android-36;google_apis_playstore;x86_64"
```

(Check first with `adb devices` and `adb -s emulator-5554 shell getprop ro.product.name` that emulator-5554 is the Play one, not `wayfinder`.)
