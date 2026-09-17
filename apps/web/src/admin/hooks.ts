import type {
  AdminUser,
  AppSettings,
  AuditEntry,
  HealthResponse,
  Invite,
  MetricPoint,
  UsageStats,
} from '@wayfinder/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

export const useIsAdmin = () => useAuth().user?.role === 'admin';

export const useHealth = () =>
  useQuery({ queryKey: ['admin', 'health'], queryFn: () => api<HealthResponse>('/api/admin/health'), refetchInterval: 30_000 });

export interface SystemSample {
  ts: string;
  cpuPct: number;
  memUsedBytes: number;
  diskUsedBytes: number;
  queueDepth: number;
}
export const useSystem = (hours = 24) =>
  useQuery({
    queryKey: ['admin', 'system', hours],
    queryFn: () => api<{ samples: SystemSample[] }>('/api/admin/system', { query: { hours } }),
    refetchInterval: 60_000,
  });

export const useMetrics = (q: { metric?: string | undefined; groupBy: 'minute' | 'hour' | 'day'; from?: string | undefined }) =>
  useQuery({
    queryKey: ['admin', 'metrics', q],
    queryFn: () => api<{ points: MetricPoint[] }>('/api/admin/metrics', { query: q }),
    refetchInterval: 60_000,
  });

export interface ErrorGroup {
  message: string;
  service: string;
  source: string;
  count: number;
  lastSeen: string;
  latest: { id: string; createdAt: string; stack: string | null; requestId: string | null; userId: string | null };
}
export const useErrors = (service?: string) =>
  useQuery({
    queryKey: ['admin', 'errors', service],
    queryFn: () => api<{ groups: ErrorGroup[] }>('/api/admin/errors', { query: { service } }),
    refetchInterval: 30_000,
  });

export interface JobsResponse {
  queues: Array<{ name: string; queued: number; active: number; failed: number }>;
  jobs: Array<{ id: string; name: string; state: string; createdOn: string; completedOn: string | null; retryCount: number; output: unknown }>;
}
export const useJobs = (state?: string) =>
  useQuery({ queryKey: ['admin', 'jobs', state], queryFn: () => api<JobsResponse>('/api/admin/jobs', { query: { state } }), refetchInterval: 15_000 });

export interface PipelineRun {
  id: string;
  kind: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  osmDataDate: string | null;
  logTail: string;
}
export const usePipelineRuns = () =>
  useQuery({ queryKey: ['admin', 'pipeline'], queryFn: () => api<{ items: PipelineRun[] }>('/api/admin/pipeline/runs'), refetchInterval: 10_000 });

export const useUsage = () => useQuery({ queryKey: ['admin', 'usage'], queryFn: () => api<UsageStats>('/api/admin/stats/usage') });

export const useUsers = (q: { q?: string | undefined; status: string; limit: number; offset: number }) =>
  useQuery({ queryKey: ['admin', 'users', q], queryFn: () => api<{ items: AdminUser[]; total: number }>('/api/admin/users', { query: q }) });

export interface AdminUserDetail extends AdminUser {
  sessions: Array<{ id: string; createdAt: string; expiresAt: string; revokedAt: string | null; userAgent: string | null }>;
}
export const useAdminUser = (id: string) =>
  useQuery({ queryKey: ['admin', 'user', id], queryFn: () => api<AdminUserDetail>(`/api/admin/users/${id}`) });

export const useInvites = (status?: string) =>
  useQuery({ queryKey: ['admin', 'invites', status], queryFn: () => api<{ items: Invite[] }>('/api/admin/invites', { query: { status } }) });

export const useAudit = (q: { action?: string | undefined; actorId?: string; targetId?: string; limit: number }) =>
  useQuery({ queryKey: ['admin', 'audit', q], queryFn: () => api<{ items: AuditEntry[] }>('/api/admin/audit', { query: q }) });

export interface DeletedItems {
  users: Array<{ id: string; email: string; deletedAt: string; purgeAt: string }>;
  trips: Array<{ id: string; userId: string; userEmail: string; startedAt: string; deletedAt: string; purgeAt: string }>;
}
export const useDeleted = () => useQuery({ queryKey: ['admin', 'deleted'], queryFn: () => api<DeletedItems>('/api/admin/deleted') });

export const useAppSettings = () => useQuery({ queryKey: ['admin', 'app-settings'], queryFn: () => api<AppSettings>('/api/admin/app-settings') });
