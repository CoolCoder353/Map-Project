/** Shared jest mocks for screen tests: native modules and app services the screens call. */
import type { PublicUser } from '@wayfinder/shared/schemas';

export const user = (trackingEnabled = false): PublicUser =>
  ({
    id: 'u1',
    email: 'sam@example.com',
    role: 'user',
    createdAt: '2026-09-01T00:00:00Z',
    settings: { trackingEnabled, defaultMode: 'car', exploreBudgetMin: 15 },
  }) as PublicUser;
