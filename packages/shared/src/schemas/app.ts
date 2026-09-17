import { z } from 'zod';

export const VoiceSchema = z.enum(['plain', 'playful', 'minimal']);
export type Voice = z.infer<typeof VoiceSchema>;

export const AppSettingsSchema = z.object({
  appName: z.string().trim().min(1).max(40),
  voice: VoiceSchema,
});
export type AppSettings = z.infer<typeof AppSettingsSchema>;

export const DEFAULT_APP_SETTINGS: AppSettings = { appName: 'Wayfinder', voice: 'plain' };

export const UpdateAppSettingsSchema = AppSettingsSchema.partial().refine(
  (v) => v.appName !== undefined || v.voice !== undefined,
  'Nothing to update',
);

/** Public, unauthenticated runtime configuration for clients. */
export const PublicConfigSchema = AppSettingsSchema.extend({
  osmDataDate: z.string().nullable(),
});
export type PublicConfig = z.infer<typeof PublicConfigSchema>;
