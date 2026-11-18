import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AuditEntry, Faculty, User } from '@slidecast/shared';
import type { AuditFilter } from '../api.js';
import { api } from '../api.js';
import { errorText } from '../errors.js';

const PAGE = 100;

export function Audit() {
  const { t, i18n } = useTranslation();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [nextBeforeId, setNextBeforeId] = useState<number | null>(null);
  const [entities, setEntities] = useState<string[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [faculties, setFaculties] = useState<Faculty[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [filter, setFilter] = useState<AuditFilter>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (beforeId?: number) => {
      setError(null);
      api
        .audit({ ...filter, limit: PAGE, beforeId })
        .then((page) => {
          setEntries((cur) => (beforeId && cur ? [...cur, ...page.entries] : page.entries));
          setNextBeforeId(page.nextBeforeId);
          setEntities(page.entities);
          setActions(page.actions);
        })
        .catch((e: unknown) => setError(errorText(t, e)));
    },
    [filter, t],
  );

  useEffect(() => load(), [load]);
  useEffect(() => {
    api.faculties().then(setFaculties).catch(console.error);
    api.users().then(setUsers).catch(console.error);
  }, []);

  const label = (group: 'entities' | 'actions', v: string) =>
    t(`audit.${group}.${v}`, { defaultValue: v });
  const when = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'medium' }).format(
      new Date(iso),
    );
  const setF = (patch: Partial<AuditFilter>) => setFilter((f) => ({ ...f, ...patch }));
  const num = (v: string) => (v ? Number(v) : undefined);

  return (
    <section>
      <h1>{t('audit.title')}</h1>
      <p className="muted small">{t('audit.intro')}</p>

      <div className="card inline-form">
        <label>
          {t('audit.entity')}
          <select
            value={filter.entity ?? ''}
            onChange={(e) => setF({ entity: e.target.value || undefined })}
          >
            <option value="">{t('audit.any')}</option>
            {entities.map((v) => (
              <option key={v} value={v}>
                {label('entities', v)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('audit.action')}
          <select
            value={filter.action ?? ''}
            onChange={(e) => setF({ action: e.target.value || undefined })}
          >
            <option value="">{t('audit.any')}</option>
            {actions.map((v) => (
              <option key={v} value={v}>
                {label('actions', v)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('users.faculty')}
          <select
            value={filter.facultyId ?? ''}
            onChange={(e) => setF({ facultyId: num(e.target.value) })}
          >
            <option value="">{t('audit.any')}</option>
            {faculties.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('audit.user')}
          <select
            value={filter.userId ?? ''}
            onChange={(e) => setF({ userId: num(e.target.value) })}
          >
            <option value="">{t('audit.any')}</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.email}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {entries === null ? (
        <p className="muted">{t('common.loading')}</p>
      ) : entries.length === 0 ? (
        <p className="muted">{t('audit.empty')}</p>
      ) : (
        <div className="table-wrap">
          <table className="audit">
            <thead>
              <tr>
                <th>{t('audit.when')}</th>
                <th>{t('audit.user')}</th>
                <th>{t('users.faculty')}</th>
                <th>{t('audit.what')}</th>
                <th>{t('audit.details')}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="nowrap small">{when(e.at)}</td>
                  <td className="small">{e.userEmail ?? '—'}</td>
                  <td className="small">{e.facultyName ?? '—'}</td>
                  <td>
                    {label('actions', e.action)} · {label('entities', e.entity)}
                    {e.entityId && <span className="muted small"> #{e.entityId}</span>}
                  </td>
                  <td className="small">
                    {e.details != null && (
                      <details>
                        <summary>{t('audit.show')}</summary>
                        <pre>{JSON.stringify(e.details, null, 2)}</pre>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {nextBeforeId != null && (
        <div className="row">
          <button type="button" onClick={() => load(nextBeforeId)}>
            {t('audit.more')}
          </button>
        </div>
      )}
    </section>
  );
}
