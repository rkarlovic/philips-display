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
  'faculty_not_empty',
  'faculty_not_found',
  'unsupported_file',
  'file_too_large',
  'quota_exceeded',
  'pptx_unavailable',
  'media_in_use',
  'media_not_found',
  'read_only',
  'internal',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export interface NamedRef {
  id: number;
  name: string;
}

export interface ApiError {
  error: ErrorCode;
  message: string;
  issues?: { path: string; message: string }[];
  /** For `media_in_use`: the playlists (visible to the caller) that use the media. */
  usedIn?: NamedRef[];
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
  /** Bytes counted against the quota (sum of uploaded file sizes). */
  usedBytes: number;
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

// ---------- server capabilities ----------

export interface Capabilities {
  /** False when LibreOffice is not installed: PowerPoint upload is disabled. */
  pptx: boolean;
  maxUploadMb: number;
  /** File extensions the upload accepts right now, e.g. ['.pdf', '.png']. */
  acceptedExtensions: string[];
}

// ---------- media ----------

export const MediaKind = z.enum(['pdf', 'pptx', 'image', 'video']);
export type MediaKind = z.infer<typeof MediaKind>;

export const MediaStatus = z.enum(['processing', 'ready', 'failed']);
export type MediaStatus = z.infer<typeof MediaStatus>;

/** Why processing failed; the admin UI translates these. */
export const MediaErrorCode = z.enum([
  'pptx_unavailable',
  'pptx_conversion',
  'video_codec',
  'no_pages',
  'corrupt',
  'timeout',
  'interrupted',
  'unknown',
]);
export type MediaErrorCode = z.infer<typeof MediaErrorCode>;

export interface MediaPage {
  pageNo: number;
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
}

export interface Media {
  id: number;
  /** null = university (shared) media. */
  facultyId: number | null;
  facultyName: string | null;
  kind: MediaKind;
  originalName: string;
  size: number;
  status: MediaStatus;
  error: MediaErrorCode | null;
  thumbUrl: string | null;
  videoUrl: string | null;
  durationSec: number | null;
  pageCount: number;
  uploadedBy: string | null;
  createdAt: string;
  /** True when the caller can see but not change it (university media for a faculty user). */
  readOnly: boolean;
}

export interface MediaDetail extends Media {
  pages: MediaPage[];
  usedIn: NamedRef[];
}

/** `owner`: 'university', a faculty id, or omitted for everything visible. */
export const ListMediaQuery = z.object({
  owner: z.union([z.literal('university'), z.coerce.number().int().positive()]).optional(),
});

/** Super admin only: upload target. Omitted = university media. */
export const UploadMediaQuery = z.object({
  facultyId: z.coerce.number().int().positive().optional(),
});

export const UpdateMediaRequest = z.object({
  originalName: z.string().trim().min(1).max(255),
});
export type UpdateMediaRequest = z.infer<typeof UpdateMediaRequest>;

// ---------- playlists ----------

export const Transition = z.enum(['none', 'fade']);
export type Transition = z.infer<typeof Transition>;

const PlaylistName = z.string().trim().min(1).max(200);
const DurationSec = z.number().int().min(1).max(86400);

export interface Playlist {
  id: number;
  /** null = university playlist. */
  facultyId: number | null;
  facultyName: string | null;
  name: string;
  defaultDurationSec: number;
  transition: Transition;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlaylistItemMedia {
  kind: MediaKind;
  originalName: string;
  status: MediaStatus;
  thumbUrl: string | null;
  pageCount: number;
  durationSec: number | null;
}

export interface PlaylistItem {
  id: number;
  position: number;
  mediaId: number;
  media: PlaylistItemMedia;
  /** null = playlist default (per page for PDF/PPTX; video plays to its end). */
  durationSec: number | null;
  pageFrom: number | null;
  pageTo: number | null;
}

export interface PlaylistDetail extends Playlist {
  items: PlaylistItem[];
}

export const CreatePlaylistRequest = z.object({
  name: PlaylistName,
  defaultDurationSec: DurationSec.default(10),
  transition: Transition.default('fade'),
  /** Super admin only: owner faculty; null or omitted = university playlist. */
  facultyId: z.number().int().positive().nullable().optional(),
});
export type CreatePlaylistRequest = z.input<typeof CreatePlaylistRequest>;

export const UpdatePlaylistRequest = z.object({
  name: PlaylistName.optional(),
  defaultDurationSec: DurationSec.optional(),
  transition: Transition.optional(),
});
export type UpdatePlaylistRequest = z.infer<typeof UpdatePlaylistRequest>;

export const PlaylistItemInput = z
  .object({
    mediaId: Id,
    durationSec: DurationSec.nullable().optional(),
    pageFrom: z.number().int().min(1).nullable().optional(),
    pageTo: z.number().int().min(1).nullable().optional(),
  })
  .refine((i) => i.pageFrom == null || i.pageTo == null || i.pageFrom <= i.pageTo, {
    message: 'pageFrom must be <= pageTo',
    path: ['pageTo'],
  });
export type PlaylistItemInput = z.input<typeof PlaylistItemInput>;

export const PutPlaylistItemsRequest = z.object({
  items: z.array(PlaylistItemInput).max(500),
});
export type PutPlaylistItemsRequest = z.input<typeof PutPlaylistItemsRequest>;

// ---------- playback ----------

/** One step of the flat loop a display plays. PDF/PPTX pages are already expanded. */
export interface ManifestItem {
  type: 'image' | 'video';
  url: string;
  /** Seconds on screen; null for a video = play to its end. */
  durationSec: number | null;
  mediaId: number;
  pageNo: number | null;
}

export interface PlaylistPreview {
  playlistId: number;
  transition: Transition;
  items: ManifestItem[];
}

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
