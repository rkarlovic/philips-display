/**
 * REST contracts shared by the server and the admin UI.
 * Every request body is validated with these schemas on the server.
 */
import { z } from 'zod';

// ---------- primitives ----------

export const LOCALES = ['hr', 'en'] as const;
export const Locale = z.enum(LOCALES);
export type Locale = z.infer<typeof Locale>;

export const Role = z.enum(['super_admin', 'faculty_user']);
export type Role = z.infer<typeof Role>;

/** Emails are trimmed and stored lowercase. */
export const Email = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const Id = z.number().int().positive();
export const IdParam = z.object({ id: z.coerce.number().int().positive() });

// ---------- errors ----------

export const ErrorCode = z.enum([
  'bad_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'not_registered',
  'password_required',
  'invalid_credentials',
  'email_taken',
  'faculty_name_taken',
  'faculty_has_users',
  'faculty_not_found',
  'internal',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export interface ApiError {
  error: ErrorCode;
  message: string;
  issues?: { path: string; message: string }[];
}

// ---------- auth ----------

export const LoginRequest = z.object({
  email: Email,
  password: z.string().min(1).max(1024).optional(),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export interface Me {
  id: number;
  email: string;
  displayName: string;
  role: Role;
  facultyId: number | null;
  facultyName: string | null;
  locale: Locale;
}

export const UpdateMeRequest = z.object({ locale: Locale });
export type UpdateMeRequest = z.infer<typeof UpdateMeRequest>;

// ---------- faculties ----------

const FacultyName = z.string().trim().min(1).max(200);
const StorageQuotaMb = z.number().int().positive().max(10_000_000).nullable();

export interface Faculty {
  id: number;
  name: string;
  storageQuotaMb: number | null;
  userCount: number;
  createdAt: string;
}

export const CreateFacultyRequest = z.object({
  name: FacultyName,
  storageQuotaMb: StorageQuotaMb.optional(),
});
export type CreateFacultyRequest = z.infer<typeof CreateFacultyRequest>;

export const UpdateFacultyRequest = z.object({
  name: FacultyName.optional(),
  storageQuotaMb: StorageQuotaMb.optional(),
});
export type UpdateFacultyRequest = z.infer<typeof UpdateFacultyRequest>;

// ---------- users (faculty users, managed by the super admin) ----------

const DisplayName = z.string().trim().max(200);

export interface User {
  id: number;
  email: string;
  displayName: string;
  role: Role;
  facultyId: number | null;
  facultyName: string | null;
  locale: Locale;
  active: boolean;
  createdAt: string;
}

export const CreateUserRequest = z.object({
  email: Email,
  displayName: DisplayName.default(''),
  facultyId: Id,
  locale: Locale.default('hr'),
});
export type CreateUserRequest = z.input<typeof CreateUserRequest>;

export const UpdateUserRequest = z.object({
  email: Email.optional(),
  displayName: DisplayName.optional(),
  facultyId: Id.optional(),
  locale: Locale.optional(),
  active: z.boolean().optional(),
});
export type UpdateUserRequest = z.infer<typeof UpdateUserRequest>;

export const ListUsersQuery = z.object({
  facultyId: z.coerce.number().int().positive().optional(),
});

// ---------- audit ----------

export interface AuditEntry {
  id: number;
  at: string;
  userId: number | null;
  userEmail: string | null;
  facultyId: number | null;
  action: string;
  entity: string;
  entityId: string | null;
  details: unknown;
}

export const ListAuditQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  facultyId: z.coerce.number().int().positive().optional(),
});
