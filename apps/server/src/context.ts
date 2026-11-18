import type { Db } from './db/index.js';
import type { AuthProvider } from './auth/provider.js';
import type { Config } from './config.js';

/** Dependencies handed to every route module. `now` is injectable for tests. */
export interface AppContext {
  config: Config;
  db: Db;
  auth: AuthProvider;
  now: () => Date;
}
