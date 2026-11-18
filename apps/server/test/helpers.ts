import type { FastifyInstance } from 'fastify';
import type { Config } from '../src/config.js';
import { openDb, type Db } from '../src/db/index.js';
import { buildApp } from '../src/app.js';
import { createEmailAuthProvider, ensureSuperAdmin } from '../src/auth/email-provider.js';
import { insertFaculty } from '../src/db/repos/faculties.js';
import { insertFacultyUser } from '../src/db/repos/users.js';

export const SUPER_EMAIL = 'it@uni.test';
export const SUPER_PASSWORD = 'super-secret-pw';

export function testConfig(): Config {
  return {
    port: 0,
    host: '127.0.0.1',
    dataDir: '/nonexistent',
    sessionSecret: 'test-session-secret-0123456789',
    superAdminEmail: SUPER_EMAIL,
    superAdminPassword: SUPER_PASSWORD,
    timezone: 'Europe/Zagreb',
    maxUploadMb: 500,
    pdfDpi: 150,
    sofficePath: undefined,
    adminDistDir: '/nonexistent-admin-dist',
  };
}

export interface TestApp {
  app: FastifyInstance;
  db: Db;
  clock: { now: Date };
}

export async function createTestApp(): Promise<TestApp> {
  const config = testConfig();
  const db = openDb(':memory:');
  await ensureSuperAdmin(db, config.superAdminEmail, config.superAdminPassword);
  const clock = { now: new Date('2026-03-01T10:00:00Z') };
  const app = await buildApp({
    config,
    db,
    auth: createEmailAuthProvider(db),
    now: () => clock.now,
  });
  return { app, db, clock };
}

/** Logs in and returns the Cookie header value. */
export async function login(
  app: FastifyInstance,
  email: string,
  password?: string,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password },
  });
  if (res.statusCode !== 200)
    throw new Error(`login ${email} failed: ${res.statusCode} ${res.body}`);
  const cookie = res.cookies.find((c) => c.name === 'sid');
  if (!cookie) throw new Error('no session cookie');
  return `sid=${cookie.value}`;
}

/** Two faculties with one user each, plus logged-in cookies for everyone. */
export async function seedTwoFaculties(t: TestApp) {
  const facA = insertFaculty(t.db, { name: 'Faculty A', storageQuotaMb: null });
  const facB = insertFaculty(t.db, { name: 'Faculty B', storageQuotaMb: 1000 });
  const userA = insertFacultyUser(t.db, {
    email: 'a@uni.test',
    displayName: 'A',
    facultyId: facA,
    locale: 'hr',
  });
  const userB = insertFacultyUser(t.db, {
    email: 'b@uni.test',
    displayName: 'B',
    facultyId: facB,
    locale: 'en',
  });
  return {
    facA,
    facB,
    userA,
    userB,
    cookieA: await login(t.app, 'a@uni.test'),
    cookieB: await login(t.app, 'b@uni.test'),
    cookieSuper: await login(t.app, SUPER_EMAIL, SUPER_PASSWORD),
  };
}
