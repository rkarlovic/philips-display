import type { Db } from './db/index.js';
import type { AuthProvider } from './auth/provider.js';
import type { Config } from './config.js';
import type { MediaStore } from './media/store.js';
import type { MediaPipeline } from './media/pipeline.js';
import type { Hub } from './ws/hub.js';

/** Dependencies handed to every route module. `now` is injectable for tests. */
export interface AppContext {
  config: Config;
  db: Db;
  auth: AuthProvider;
  now: () => Date;
  store: MediaStore;
  pipeline: MediaPipeline;
  /** Live connections (created by buildApp). */
  hub: Hub;
}
