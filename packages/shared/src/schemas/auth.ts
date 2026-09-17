import { z } from 'zod';
import { ModeSchema, RoleSchema } from './common.js';

export const EmailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

export const PasswordSchema = z.string().min(10, 'Password must be at least 10 characters').max(200);

export const RegisterRequestSchema = z.object({
  inviteCode: z.string().trim().min(4).max(64),
  email: EmailSchema,
  password: PasswordSchema,
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const LoginRequestSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1).max(200),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/** Mobile clients send the refresh token in the body; web uses an httpOnly cookie. */
export const RefreshRequestSchema = z.object({ refreshToken: z.string().optional() });

export const ResetPasswordRequestSchema = z.object({
  token: z.string().min(10),
  password: PasswordSchema,
});

export const UserSettingsSchema = z.object({
  trackingEnabled: z.boolean(),
  defaultMode: ModeSchema,
  exploreBudgetMin: z.number().int().min(0).max(120),
});
export type UserSettings = z.infer<typeof UserSettingsSchema>;

export const DEFAULT_SETTINGS: UserSettings = {
  trackingEnabled: false,
  defaultMode: 'car',
  exploreBudgetMin: 15,
};

export const UpdateSettingsSchema = UserSettingsSchema.partial();

export const PublicUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: RoleSchema,
  createdAt: z.string(),
  settings: UserSettingsSchema,
});
export type PublicUser = z.infer<typeof PublicUserSchema>;

export const AuthResponseSchema = z.object({
  accessToken: z.string(),
  /** Only returned to mobile clients (X-Client: mobile). */
  refreshToken: z.string().optional(),
  user: PublicUserSchema,
});
export type AuthResponse = z.infer<typeof AuthResponseSchema>;
