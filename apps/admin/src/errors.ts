import type { TFunction } from 'i18next';
import { ApiRequestError } from './api.js';

/** Turns any thrown error into a translated message. */
export function errorText(t: TFunction, err: unknown): string {
  if (err instanceof ApiRequestError) {
    const base = t(`errors.${err.code}`);
    return err.usedIn.length ? `${base} ${err.usedIn.map((p) => p.name).join(', ')}` : base;
  }
  return t('errors.network');
}
