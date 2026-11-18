import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Faculty } from '@slidecast/shared';
import { api } from '../api.js';
import { errorText } from '../errors.js';

const parseQuota = (s: string): number | null => (s.trim() === '' ? null : Number(s));

export function Faculties() {
  const { t } = useTranslation();
  const [items, setItems] = useState<Faculty[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [quota, setQuota] = useState('');
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editQuota, setEditQuota] = useState('');

  const load = useCallback(() => {
    api
      .faculties()
      .then(setItems)
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
    const ok = await run(() => api.createFaculty({ name, storageQuotaMb: parseQuota(quota) }));
    if (ok) {
      setName('');
      setQuota('');
    }
  };

  const save = async (id: number) => {
    const ok = await run(() =>
      api.updateFaculty(id, { name: editName, storageQuotaMb: parseQuota(editQuota) }),
    );
    if (ok) setEditId(null);
  };

  const remove = (f: Faculty) => {
    if (!confirm(t('faculties.deleteConfirm', { name: f.name }))) return;
    void run(() => api.deleteFaculty(f.id));
  };

  return (
    <section>
      <h1>{t('faculties.title')}</h1>

      <form className="card inline-form" onSubmit={create}>
        <h2>{t('faculties.new')}</h2>
        <label>
          {t('faculties.name')}
          <input required value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          {t('faculties.quota')}
          <input
            type="number"
            min={1}
            placeholder={t('faculties.quotaHint')}
            value={quota}
            onChange={(e) => setQuota(e.target.value)}
          />
        </label>
        <button type="submit" className="primary">
          {t('common.add')}
        </button>
      </form>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {items === null ? (
        <p className="muted">{t('common.loading')}</p>
      ) : items.length === 0 ? (
        <p className="muted">{t('faculties.empty')}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('faculties.name')}</th>
                <th>{t('faculties.quota')}</th>
                <th>{t('faculties.users')}</th>
                <th>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((f) =>
                editId === f.id ? (
                  <tr key={f.id}>
                    <td>
                      <input value={editName} onChange={(e) => setEditName(e.target.value)} />
                    </td>
                    <td>
                      <input
                        type="number"
                        min={1}
                        placeholder={t('faculties.quotaHint')}
                        value={editQuota}
                        onChange={(e) => setEditQuota(e.target.value)}
                      />
                    </td>
                    <td>{f.userCount}</td>
                    <td className="actions">
                      <button type="button" className="primary" onClick={() => save(f.id)}>
                        {t('common.save')}
                      </button>
                      <button type="button" onClick={() => setEditId(null)}>
                        {t('common.cancel')}
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr key={f.id}>
                    <td>{f.name}</td>
                    <td>{f.storageQuotaMb ?? t('faculties.unlimited')}</td>
                    <td>{f.userCount}</td>
                    <td className="actions">
                      <button
                        type="button"
                        onClick={() => {
                          setEditId(f.id);
                          setEditName(f.name);
                          setEditQuota(f.storageQuotaMb?.toString() ?? '');
                        }}
                      >
                        {t('common.edit')}
                      </button>
                      <button type="button" className="danger" onClick={() => remove(f)}>
                        {t('common.delete')}
                      </button>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
