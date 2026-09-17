import { z } from 'zod';
import { RoleSchema } from './common.js';
import { UserSettingsSchema } from './auth.js';

export const AdminUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: RoleSchema,
  createdAt: z.string(),
  lastSeenAt: z.string().nullable(),
  disabledAt: z.string().nullable(),
  deletedAt: z.string().nullable(),
  tripCount: z.number().int(),
  cellCount: z.number().int(),
  settings: UserSettingsSchema,
});
export type AdminUser = z.infer<typeof AdminUserSchema>;

export const AdminUserListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(['active', 'disabled', 'deleted', 'all']).default('all'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const AdminUserListSchema = z.object({ items: z.array(AdminUserSchema), total: z.number().int() });

export const AdminUpdateUserSchema = z
  .object({
    role: RoleSchema.optional(),
    disabled: z.boolean().optional(),
    /** Type-to-confirm: must equal the target user's email for role changes. */
    confirm: z.string().optional(),
  })
  .refine((v) => v.role !== undefined || v.disabled !== undefined, 'Nothing to update');

export const ConfirmBodySchema = z.object({ confirm: z.string() });

export const SessionSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
  revokedAt: z.string().nullable(),
  userAgent: z.string().nullable(),
});
export const AdminUserDetailSchema = AdminUserSchema.extend({ sessions: z.array(SessionSchema) });

export const InviteStatusSchema = z.enum(['unused', 'used', 'expired', 'revoked']);
export const InviteSchema = z.object({
  code: z.string(),
  note: z.string().nullable(),
  roleOnSignup: RoleSchema,
  createdAt: z.string(),
  createdBy: z.string().nullable(),
  expiresAt: z.string().nullable(),
  usedAt: z.string().nullable(),
  usedByEmail: z.string().nullable(),
  revokedAt: z.string().nullable(),
  status: InviteStatusSchema,
});
export type Invite = z.infer<typeof InviteSchema>;
export const InviteListQuerySchema = z.object({ status: InviteStatusSchema.optional() });
export const InviteListSchema = z.object({ items: z.array(InviteSchema) });
export const CreateInvitesSchema = z.object({
  count: z.number().int().min(1).max(50).default(1),
  expiresInDays: z.number().int().min(1).max(365).nullable().default(14),
  note: z.string().trim().max(200).nullable().default(null),
  roleOnSignup: RoleSchema.default('user'),
});

export const ResetLinkResponseSchema = z.object({ url: z.string(), expiresAt: z.string() });

export const AuditEntrySchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  actorId: z.string().nullable(),
  actorEmail: z.string().nullable(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string().nullable(),
  details: z.record(z.string(), z.unknown()),
  ip: z.string().nullable(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;
export const AuditQuerySchema = z.object({
  actorId: z.string().optional(),
  targetId: z.string().optional(),
  action: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  before: z.string().optional(),
});
export const AuditListSchema = z.object({ items: z.array(AuditEntrySchema) });

export const ServiceStatusSchema = z.object({
  name: z.string(),
  up: z.boolean(),
  latencyMs: z.number().nullable(),
  detail: z.string().nullable(),
});
export const HealthResponseSchema = z.object({
  services: z.array(ServiceStatusSchema),
  osmDataDate: z.string().nullable(),
  system: z
    .object({
      ts: z.string(),
      cpuPct: z.number(),
      memUsedBytes: z.number(),
      memTotalBytes: z.number(),
      diskUsedBytes: z.number(),
      diskTotalBytes: z.number(),
    })
    .nullable(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const MetricsQuerySchema = z.object({
  metric: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  groupBy: z.enum(['minute', 'hour', 'day']).default('hour'),
});
export const MetricPointSchema = z.object({
  bucket: z.string(),
  metric: z.string(),
  label: z.string(),
  count: z.number(),
  errorCount: z.number(),
  p50Ms: z.number().nullable(),
  p95Ms: z.number().nullable(),
  maxMs: z.number().nullable(),
});
export type MetricPoint = z.infer<typeof MetricPointSchema>;
export const MetricsResponseSchema = z.object({ points: z.array(MetricPointSchema) });

export const SystemSamplesResponseSchema = z.object({
  samples: z.array(
    z.object({
      ts: z.string(),
      cpuPct: z.number(),
      memUsedBytes: z.number(),
      diskUsedBytes: z.number(),
      queueDepth: z.number(),
    }),
  ),
});

export const ErrorEventSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  service: z.string(),
  source: z.string(),
  message: z.string(),
  stack: z.string().nullable(),
  requestId: z.string().nullable(),
  userId: z.string().nullable(),
});
export const ErrorListQuerySchema = z.object({
  service: z.string().optional(),
  source: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export const ErrorGroupSchema = z.object({
  message: z.string(),
  service: z.string(),
  source: z.string(),
  count: z.number().int(),
  lastSeen: z.string(),
  latest: ErrorEventSchema,
});
export const ErrorListSchema = z.object({ groups: z.array(ErrorGroupSchema) });

export const JobStateSchema = z.enum(['created', 'retry', 'active', 'completed', 'cancelled', 'failed']);
export const JobSchema = z.object({
  id: z.string(),
  name: z.string(),
  state: z.string(),
  createdOn: z.string(),
  completedOn: z.string().nullable(),
  retryCount: z.number().int(),
  output: z.unknown().nullable(),
});
export const JobListQuerySchema = z.object({ state: JobStateSchema.optional() });
export const JobListSchema = z.object({
  queues: z.array(z.object({ name: z.string(), queued: z.number(), active: z.number(), failed: z.number() })),
  jobs: z.array(JobSchema),
});

export const PipelineRunSchema = z.object({
  id: z.string(),
  kind: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  status: z.enum(['queued', 'running', 'succeeded', 'failed']),
  osmDataDate: z.string().nullable(),
  logTail: z.string(),
});
export const PipelineRunListSchema = z.object({ items: z.array(PipelineRunSchema) });

export const UsageStatsSchema = z.object({
  totalUsers: z.number().int(),
  signupsByDay: z.array(z.object({ day: z.string(), count: z.number().int() })),
  dau: z.number().int(),
  wau: z.number().int(),
  tripsByDay: z.array(z.object({ day: z.string(), car: z.number().int(), foot: z.number().int() })),
  routesByKind: z.array(z.object({ kind: z.string(), count: z.number().int() })),
  trackingOptInPct: z.number(),
  exploredKm2Total: z.number(),
  exploredKm2Week: z.number(),
});
export type UsageStats = z.infer<typeof UsageStatsSchema>;

export const DeletedItemsSchema = z.object({
  users: z.array(z.object({ id: z.string(), email: z.string(), deletedAt: z.string(), purgeAt: z.string() })),
  trips: z.array(
    z.object({
      id: z.string(),
      userId: z.string(),
      userEmail: z.string(),
      startedAt: z.string(),
      deletedAt: z.string(),
      purgeAt: z.string(),
    }),
  ),
});
