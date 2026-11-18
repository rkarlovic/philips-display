import type {
  ApiError,
  Capabilities,
  CreateFacultyRequest,
  CreatePlaylistRequest,
  CreateUserRequest,
  Display,
  DisplayCommand,
  DisplayCommandResult,
  DisplaySetup,
  ErrorCode,
  PairDisplayRequest,
  PendingDisplay,
  UpdateDisplayRequest,
  Faculty,
  LoginRequest,
  Me,
  Media,
  MediaDetail,
  NamedRef,
  Playlist,
  PlaylistDetail,
  PlaylistPreview,
  PutPlaylistItemsRequest,
  UpdateFacultyRequest,
  UpdateMeRequest,
  UpdatePlaylistRequest,
  UpdateUserRequest,
  User,
} from '@slidecast/shared';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly usedIn: NamedRef[] = [],
  ) {
    super(message);
  }
}

function toError(status: number, data: unknown, fallback: string): ApiRequestError {
  const err = (data ?? {}) as Partial<ApiError>;
  return new ApiRequestError(status, err.error ?? 'internal', err.message ?? fallback, err.usedIn);
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) throw toError(res.status, data, res.statusText);
  return data as T;
}

/** Upload with progress (fetch has no upload progress). `onProgress` gets 0..1. */
function uploadFile(
  file: File,
  facultyId: number | null,
  onProgress: (fraction: number) => void,
): Promise<Media> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const q = facultyId ? `?facultyId=${facultyId}` : '';
    xhr.open('POST', `/api/media${q}`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let data: unknown = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        // not JSON
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as Media);
      else reject(toError(xhr.status, data, xhr.statusText));
    };
    xhr.onerror = () => reject(new TypeError('network'));
    const form = new FormData();
    form.append('file', file, file.name);
    xhr.send(form);
  });
}

export const api = {
  login: (body: LoginRequest) => request<Me>('POST', '/api/auth/login', body),
  logout: () => request<void>('POST', '/api/auth/logout'),
  me: () => request<Me>('GET', '/api/auth/me'),
  updateMe: (body: UpdateMeRequest) => request<Me>('PATCH', '/api/auth/me', body),
  capabilities: () => request<Capabilities>('GET', '/api/capabilities'),

  myFaculties: () => request<Faculty[]>('GET', '/api/faculties'),

  faculties: () => request<Faculty[]>('GET', '/api/admin/faculties'),
  createFaculty: (body: CreateFacultyRequest) =>
    request<Faculty>('POST', '/api/admin/faculties', body),
  updateFaculty: (id: number, body: UpdateFacultyRequest) =>
    request<Faculty>('PATCH', `/api/admin/faculties/${id}`, body),
  deleteFaculty: (id: number) => request<void>('DELETE', `/api/admin/faculties/${id}`),

  users: () => request<User[]>('GET', '/api/admin/users'),
  createUser: (body: CreateUserRequest) => request<User>('POST', '/api/admin/users', body),
  updateUser: (id: number, body: UpdateUserRequest) =>
    request<User>('PATCH', `/api/admin/users/${id}`, body),

  media: () => request<Media[]>('GET', '/api/media'),
  mediaDetail: (id: number) => request<MediaDetail>('GET', `/api/media/${id}`),
  uploadMedia: uploadFile,
  renameMedia: (id: number, originalName: string) =>
    request<Media>('PATCH', `/api/media/${id}`, { originalName }),
  deleteMedia: (id: number) => request<void>('DELETE', `/api/media/${id}`),

  playlists: () => request<Playlist[]>('GET', '/api/playlists'),
  playlist: (id: number) => request<PlaylistDetail>('GET', `/api/playlists/${id}`),
  createPlaylist: (body: CreatePlaylistRequest) =>
    request<PlaylistDetail>('POST', '/api/playlists', body),
  updatePlaylist: (id: number, body: UpdatePlaylistRequest) =>
    request<PlaylistDetail>('PATCH', `/api/playlists/${id}`, body),
  putPlaylistItems: (id: number, body: PutPlaylistItemsRequest) =>
    request<PlaylistDetail>('PUT', `/api/playlists/${id}/items`, body),
  deletePlaylist: (id: number) => request<void>('DELETE', `/api/playlists/${id}`),
  playlistPreview: (id: number) => request<PlaylistPreview>('GET', `/api/playlists/${id}/preview`),

  displays: () => request<Display[]>('GET', '/api/displays'),
  updateDisplay: (id: number, body: UpdateDisplayRequest) =>
    request<Display>('PATCH', `/api/displays/${id}`, body),
  displayCommand: (id: number, command: DisplayCommand) =>
    request<DisplayCommandResult>('POST', `/api/displays/${id}/command`, { command }),
  pendingDisplays: () => request<PendingDisplay[]>('GET', '/api/admin/displays/pending'),
  pairDisplay: (body: PairDisplayRequest) =>
    request<DisplaySetup>('POST', '/api/admin/displays/pair', body),
  newDisplayToken: (id: number) => request<DisplaySetup>('POST', `/api/admin/displays/${id}/token`),
  revokeDisplay: (id: number) => request<void>('DELETE', `/api/admin/displays/${id}`),
};
