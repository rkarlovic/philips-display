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
  'pairing_code_invalid',
  'playlist_not_found',
  'playlist_in_use',
  'university_playlist_required',
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
  /**
   * For `media_in_use`: the playlists (visible to the caller) that use the media.
   * For `playlist_in_use`: the displays that use the playlist.
   */
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
  /** IANA zone all schedules use (TZ). */
  timezone: string;
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

export const Rotation = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]);
export type Rotation = z.infer<typeof Rotation>;

export const Fit = z.enum(['contain', 'cover']);
export type Fit = z.infer<typeof Fit>;

/** Everything a display needs to play. The server decides; the player just plays it. */
export interface Manifest {
  /** Changes whenever anything below changes. */
  version: string;
  displayId: number;
  displayName: string;
  facultyName: string;
  rotation: Rotation;
  fit: Fit;
  transition: Transition;
  /** IANA zone for the idle-screen clock. */
  timezone: string;
  /** Why this content (see PlaybackSource). */
  source: PlaybackSource;
  scheduleId: number | null;
  /** Takeover announcement being shown, if any. */
  announcementId: number | null;
  playlistId: number | null;
  playlistName: string | null;
  /** Includes mixed-in announcement items. */
  items: ManifestItem[];
}

/**
 * - takeover: a university announcement replaces everything
 * - schedule / default: the faculty's own content (possibly with mix-ins)
 * - mix: no own content, only mixed-in university announcements
 * - idle: nothing to show (faculty name + clock)
 */
export type PlaybackSource = 'takeover' | 'schedule' | 'default' | 'mix' | 'idle';

export interface AnnouncementRef {
  id: number;
  title: string;
  mode: AnnouncementMode;
  endsAt: string | null;
}

/** What a display is set to play right now, and when that changes next. */
export interface Playing {
  source: PlaybackSource;
  scheduleId: number | null;
  playlistId: number | null;
  playlistName: string | null;
  /** When the active schedule or takeover ends (null: open-ended / not timed). */
  until: string | null;
  /** Next schedule/announcement start or end for this display (null: none within a week). */
  nextChangeAt: string | null;
  /** Active takeover (faculty users can see it but not change it). */
  takeover: AnnouncementRef | null;
  /** Active mix-in announcements. */
  mixIns: AnnouncementRef[];
}

// ---------- announcements (super admin) ----------

export const AnnouncementMode = z.enum(['mix', 'takeover']);
export type AnnouncementMode = z.infer<typeof AnnouncementMode>;

export const AnnouncementTarget = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }),
  z.object({
    kind: z.literal('faculties'),
    facultyIds: z.array(Id).min(1).max(500),
  }),
  z.object({
    kind: z.literal('displays'),
    displayIds: z.array(Id).min(1).max(500),
  }),
]);
export type AnnouncementTarget = z.infer<typeof AnnouncementTarget>;

/** Local date-time in the server's zone (TZ), e.g. '2026-03-02T08:00'. */
export const LocalDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/, 'YYYY-MM-DDTHH:MM')
  .refine((s) => !Number.isNaN(Date.parse(`${s}:00Z`)), 'invalid date');

export type AnnouncementStatus = 'scheduled' | 'active' | 'ended';

export interface Announcement {
  id: number;
  title: string;
  playlistId: number;
  playlistName: string;
  mode: AnnouncementMode;
  target: AnnouncementTarget;
  /** UTC instants. */
  startsAt: string;
  endsAt: string | null;
  /** The same, as local date-time in TZ (for editing). */
  startsAtLocal: string;
  endsAtLocal: string | null;
  mixEveryNItems: number | null;
  status: AnnouncementStatus;
  /** Paired displays it currently targets. */
  displayCount: number;
  createdAt: string;
}

const AnnouncementTitle = z.string().trim().min(1).max(200);
const MixEvery = z.number().int().min(1).max(1000).nullable();

export const CreateAnnouncementRequest = z
  .object({
    title: AnnouncementTitle,
    playlistId: Id,
    mode: AnnouncementMode,
    target: AnnouncementTarget,
    startsAt: LocalDateTime,
    endsAt: LocalDateTime.nullable().default(null),
    mixEveryNItems: MixEvery.default(null),
  })
  .refine((a) => a.endsAt == null || a.endsAt > a.startsAt, {
    message: 'endsAt must be after startsAt',
    path: ['endsAt'],
  });
export type CreateAnnouncementRequest = z.input<typeof CreateAnnouncementRequest>;

export const UpdateAnnouncementRequest = z.object({
  title: AnnouncementTitle.optional(),
  playlistId: Id.optional(),
  mode: AnnouncementMode.optional(),
  target: AnnouncementTarget.optional(),
  startsAt: LocalDateTime.optional(),
  endsAt: LocalDateTime.nullable().optional(),
  mixEveryNItems: MixEvery.optional(),
});
export type UpdateAnnouncementRequest = z.input<typeof UpdateAnnouncementRequest>;

// ---------- schedules ----------

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export const Weekday = z.number().int().min(1).max(7);
const TimeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');
const LocalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), 'invalid date');

export interface Schedule {
  id: number;
  displayId: number;
  playlistId: number;
  playlistName: string;
  weekdays: number[];
  startTime: string;
  endTime: string;
  dateFrom: string | null;
  dateTo: string | null;
  priority: number;
  createdAt: string;
  /** Active right now (not necessarily the winner if several overlap). */
  activeNow: boolean;
}

const scheduleFields = {
  playlistId: Id,
  weekdays: z
    .array(Weekday)
    .min(1)
    .max(7)
    .transform((w) => [...new Set(w)].sort((a, b) => a - b)),
  /** End ≤ start crosses midnight; start = end is a full 24 h (00:00–00:00 = all day). */
  startTime: TimeOfDay,
  endTime: TimeOfDay,
  dateFrom: LocalDate.nullable(),
  dateTo: LocalDate.nullable(),
  priority: z.number().int().min(-100).max(100),
};

const datesInOrder = (s: { dateFrom?: string | null; dateTo?: string | null }) =>
  !s.dateFrom || !s.dateTo || s.dateFrom <= s.dateTo;

export const CreateScheduleRequest = z
  .object({
    ...scheduleFields,
    dateFrom: scheduleFields.dateFrom.default(null),
    dateTo: scheduleFields.dateTo.default(null),
    priority: scheduleFields.priority.default(0),
  })
  .refine(datesInOrder, { message: 'dateFrom must be <= dateTo', path: ['dateTo'] });
export type CreateScheduleRequest = z.input<typeof CreateScheduleRequest>;

export const UpdateScheduleRequest = z
  .object({
    playlistId: scheduleFields.playlistId.optional(),
    weekdays: scheduleFields.weekdays.optional(),
    startTime: scheduleFields.startTime.optional(),
    endTime: scheduleFields.endTime.optional(),
    dateFrom: scheduleFields.dateFrom.optional(),
    dateTo: scheduleFields.dateTo.optional(),
    priority: scheduleFields.priority.optional(),
  })
  .refine(datesInOrder, { message: 'dateFrom must be <= dateTo', path: ['dateTo'] });
export type UpdateScheduleRequest = z.input<typeof UpdateScheduleRequest>;

// ---------- displays ----------

/** What the player last reported about itself. */
export const DisplayState = z.object({
  manifestVersion: z.string().max(64).nullable(),
  itemIndex: z.number().int().min(0).nullable(),
  itemCount: z.number().int().min(0),
  mediaId: z.number().int().positive().nullable(),
  pageNo: z.number().int().positive().nullable(),
  paused: z.boolean(),
  /** Recent playback errors (short messages), newest last. */
  errors: z.array(z.string().max(200)).max(5),
  screen: z.object({ width: z.number().int(), height: z.number().int() }).nullable(),
});
export type DisplayState = z.infer<typeof DisplayState>;

export interface Display {
  id: number;
  facultyId: number;
  facultyName: string;
  name: string;
  location: string;
  rotation: Rotation;
  fit: Fit;
  defaultPlaylistId: number | null;
  defaultPlaylistName: string | null;
  online: boolean;
  lastSeenAt: string | null;
  pairedAt: string | null;
  state: DisplayState | null;
  /** Derived from `state`: what is on screen right now. */
  nowPlaying: { mediaName: string; pageNo: number | null } | null;
  /** What the server says it should play now (schedule / default / idle). */
  playing: Playing;
  scheduleCount: number;
}

export interface PendingDisplay {
  id: number;
  code: string;
  createdAt: string;
  lastSeenAt: string | null;
  userAgent: string | null;
}

const DisplayNameField = z.string().trim().min(1).max(100);
const Location = z.string().trim().max(200);

/** Pairing codes are shown as 6 characters; spaces, dashes and case are ignored. */
export const PairingCode = z
  .string()
  .transform((s) => s.replace(/[\s-]/g, '').toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9]{6}$/));

export const PairDisplayRequest = z.object({
  code: PairingCode,
  facultyId: Id,
  name: DisplayNameField,
  location: Location.default(''),
  rotation: Rotation.default(0),
  fit: Fit.default('contain'),
});
export type PairDisplayRequest = z.input<typeof PairDisplayRequest>;

export interface DisplaySetup {
  display: Display;
  /** Fallback: type this into the display's browser URL setting if localStorage is not kept. */
  setupPath: string;
}

/** Faculty users may only change `defaultPlaylistId`; the rest is super admin only. */
export const UpdateDisplayRequest = z.object({
  name: DisplayNameField.optional(),
  location: Location.optional(),
  rotation: Rotation.optional(),
  fit: Fit.optional(),
  facultyId: Id.optional(),
  defaultPlaylistId: Id.nullable().optional(),
});
export type UpdateDisplayRequest = z.infer<typeof UpdateDisplayRequest>;

export const DisplayCommand = z.enum(['next', 'prev', 'pause', 'resume', 'reload']);
export type DisplayCommand = z.infer<typeof DisplayCommand>;

export const DisplayCommandRequest = z.object({ command: DisplayCommand });

export interface DisplayCommandResult {
  /** False when the display is offline (the command is not queued). */
  delivered: boolean;
}

// ---------- player pairing (no session; the player is not a user) ----------

export interface PairRequestResponse {
  code: string;
  /** Secret the player polls with; whoever holds it receives the device token. */
  claim: string;
}

export type PairStatusResponse =
  { status: 'pending'; code: string } | { status: 'paired'; token: string };

// ---------- WebSocket messages ----------

/** Player → server. The first message must be `hello` with the device token. */
export const PlayerMessage = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hello'),
    token: z.string().min(10).max(200),
    manifestVersion: z.string().max(64).nullable(),
  }),
  z.object({ type: z.literal('status'), state: DisplayState }),
  z.object({ type: z.literal('pong') }),
]);
export type PlayerMessage = z.infer<typeof PlayerMessage>;

/** Server → player. */
export type ServerToPlayer =
  | { type: 'manifest_changed'; version: string }
  | { type: 'command'; command: DisplayCommand }
  | { type: 'ping' };

/** WebSocket close code: the device token is invalid or revoked → show pairing again. */
export const WS_CLOSE_UNAUTHORIZED = 4001;

/** Server → admin UI (live display status). */
export type ServerToAdmin =
  | { type: 'display'; display: Display }
  | { type: 'display_removed'; id: number }
  | { type: 'pending_changed' };

// ---------- audit ----------

export interface AuditEntry {
  id: number;
  at: string;
  userId: number | null;
  userEmail: string | null;
  facultyId: number | null;
  facultyName: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  details: unknown;
}

export interface AuditPage {
  entries: AuditEntry[];
  /** Pass as `beforeId` to load older entries; null = no more. */
  nextBeforeId: number | null;
  /** Distinct values, for the filter dropdowns. */
  entities: string[];
  actions: string[];
}

const AuditWord = z.string().regex(/^[a-z_]{1,40}$/);

export const ListAuditQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  facultyId: z.coerce.number().int().positive().optional(),
  userId: z.coerce.number().int().positive().optional(),
  entity: AuditWord.optional(),
  action: AuditWord.optional(),
  /** Only entries older than this id (paging). */
  beforeId: z.coerce.number().int().positive().optional(),
});
export type ListAuditQuery = z.input<typeof ListAuditQuery>;
