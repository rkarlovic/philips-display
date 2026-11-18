import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { LOCALES, type Faculty, type Locale, type User } from '@slidecast/shared';
import { api } from '../api.js';
import { errorText } from '../errors.js';

export function Users() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<User[] | null>(null);
  const [faculties, setFaculties] = useState<Faculty[]>([]);
  const [filter, setFilter] = useState<number | 0>(0);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [facultyId, setFacultyId] = useState<number | 0>(0);
  const [locale, setLocale] = useState<Locale>('hr');

  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editFaculty, setEditFaculty] = useState(0);

  const load = useCallback(() => {
    Promise.all([api.users(), api.faculties()])
      .then(([u, f]) => {
        setUsers(u);
        setFaculties(f);
        setFacultyId((cur) => cur || f[0]?.id || 0);
      })
      .catch((e: unknown) => setError(errorText(t, e)));
  }, [t]);

  useEffect(load, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      load();
      return true;
    } catch (e) {
      setError(errorText(t, e));
      return false;
    }
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!facultyId) return;
    const ok = await run(() => api.createUser({ email, displayName, facultyId, locale }));
    if (ok) {
      setEmail('');
      setDisplayName('');
    }
  };

  const save = async (id: number) => {
    const ok = await run(() =>
      api.updateUser(id, { displayName: editName, facultyId: editFaculty }),
    );
    if (ok) setEditId(null);
  };

  const shown = users?.filter((u) => !filter || u.facultyId === filter) ?? null;

  return (
    <section>
      <h1>{t('users.title')}</h1>

      {faculties.length === 0 && users !== null ? (
        <p className="muted">{t('users.needFaculty')}</p>
      ) : (
        <form className="card inline-form" onSubmit={create}>
          <h2>{t('users.new')}</h2>
          <label>
            {t('users.email')}
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            {t('users.displayName')}
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </label>
          <label>
            {t('users.faculty')}
            <select value={facultyId} onChange={(e) => setFacultyId(Number(e.target.value))}>
              {faculties.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('users.locale')}
            <select value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
              {LOCALES.map((l) => (
                <option key={l} value={l}>
                  {t(`lang.${l}`)}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="primary">
            {t('common.add')}
          </button>
        </form>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="row">
        <label className="row">
          {t('users.faculty')}
          <select value={filter} onChange={(e) => setFilter(Number(e.target.value))}>
            <option value={0}>{t('users.allFaculties')}</option>
            {faculties.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {shown === null ? (
        <p className="muted">{t('common.loading')}</p>
      ) : shown.length === 0 ? (
        <p className="muted">{t('users.empty')}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('users.email')}</th>
                <th>{t('users.displayName')}</th>
                <th>{t('users.faculty')}</th>
                <th>{t('users.status')}</th>
                <th>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => (
                <tr key={u.id} className={u.active ? '' : 'inactive'}>
                  <td>{u.email}</td>
                  {editId === u.id ? (
                    <>
                      <td>
                        <input value={editName} onChange={(e) => setEditName(e.target.value)} />
                      </td>
                      <td>
                        <select
                          value={editFaculty}
                          onChange={(e) => setEditFaculty(Number(e.target.value))}
                        >
                          {faculties.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.name}
                            </option>
                          ))}
                        </select>
                      </td>
                    </>
                  ) : (
                    <>
                      <td>{u.displayName}</td>
                      <td>{u.facultyName}</td>
                    </>
                  )}
                  <td>{u.active ? t('users.active') : t('users.inactive')}</td>
                  <td className="actions">
                    {editId === u.id ? (
                      <>
                        <button type="button" className="primary" onClick={() => save(u.id)}>
                          {t('common.save')}
                        </button>
                        <button type="button" onClick={() => setEditId(null)}>
                          {t('common.cancel')}
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setEditId(u.id);
                            setEditName(u.displayName);
                            setEditFaculty(u.facultyId ?? 0);
                          }}
                        >
                          {t('common.edit')}
                        </button>
                        <button
                          type="button"
                          className={u.active ? 'danger' : ''}
                          onClick={() =>
                            void run(() => api.updateUser(u.id, { active: !u.active }))
                          }
                        >
                          {u.active ? t('users.deactivate') : t('users.activate')}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
