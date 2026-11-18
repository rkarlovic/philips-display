import type { TFunction } from 'i18next';
import { ApiRequestError } from './api.js';

/** Turns any thrown error into a translated message. */
export function errorText(t: TFunction, err: unknown): string {
  if (err instanceof ApiRequestError) return t(`errors.${err.code}`);
  return t('errors.network');
}
