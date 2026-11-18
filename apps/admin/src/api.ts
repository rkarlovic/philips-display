import type {
  ApiError,
  CreateFacultyRequest,
  CreateUserRequest,
  ErrorCode,
  Faculty,
  LoginRequest,
  Me,
  UpdateFacultyRequest,
  UpdateMeRequest,
  UpdateUserRequest,
  User,
} from '@slidecast/shared';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
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
  if (!res.ok) {
    const err = (data ?? {}) as Partial<ApiError>;
    throw new ApiRequestError(res.status, err.error ?? 'internal', err.message ?? res.statusText);
  }
  return data as T;
}

export const api = {
  login: (body: LoginRequest) => request<Me>('POST', '/api/auth/login', body),
  logout: () => request<void>('POST', '/api/auth/logout'),
  me: () => request<Me>('GET', '/api/auth/me'),
  updateMe: (body: UpdateMeRequest) => request<Me>('PATCH', '/api/auth/me', body),

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
};
