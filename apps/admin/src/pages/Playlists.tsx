import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Faculty, Me, Playlist } from '@slidecast/shared';
import { api } from '../api.js';
import { errorText } from '../errors.js';
import { OwnerBadge, OwnerSelect } from '../components/OwnerSelect.js';

export function Playlists({ me }: { me: Me }) {
  const { t } = useTranslation();
  const isSuper = me.role === 'super_admin';
  const [items, setItems] = useState<Playlist[] | null>(null);
  const [faculties, setFaculties] = useState<Faculty[]>([]);
  const [name, setName] = useState('');
  const [owner, setOwner] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .playlists()
      .then(setItems)
      .catch((e: unknown) => setError(errorText(t, e)));
  }, [t]);

  useEffect(load, [load]);
  useEffect(() => {
    if (isSuper) api.faculties().then(setFaculties).catch(console.error);
  }, [isSuper]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const p = await api.createPlaylist({ name, facultyId: isSuper ? owner : undefined });
      location.hash = `#playlists/${p.id}`;
    } catch (err) {
      setError(errorText(t, err));
    }
  };

  const remove = async (p: Playlist) => {
    if (!confirm(t('playlists.deleteConfirm', { name: p.name }))) return;
    try {
      await api.deletePlaylist(p.id);
      load();
    } catch (err) {
      setError(errorText(t, err));
    }
  };

  return (
    <section>
      <h1>{t('playlists.title')}</h1>
      <p className="muted small">{t('playlists.intro')}</p>

      <form className="card inline-form" onSubmit={create}>
        <h2>{t('playlists.new')}</h2>
        <label>
          {t('playlists.name')}
          <input required value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {isSuper && (
          <OwnerSelect
            faculties={faculties}
            value={owner}
            onChange={setOwner}
            label={t('playlists.owner')}
          />
        )}
        <button type="submit" className="primary">
          {t('playlists.create')}
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
        <p className="muted">{t('playlists.empty')}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('playlists.name')}</th>
                {isSuper && <th>{t('playlists.owner')}</th>}
                <th>{t('playlists.items')}</th>
                <th>{t('playlists.defaultDuration')}</th>
                <th>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id}>
                  <td>
                    <a href={`#playlists/${p.id}`}>{p.name}</a>
                  </td>
                  {isSuper && (
                    <td>
                      <OwnerBadge name={p.facultyName} />
                    </td>
                  )}
                  <td>{p.itemCount}</td>
                  <td>{t('playlists.seconds', { n: p.defaultDurationSec })}</td>
                  <td className="actions">
                    <a className="button" href={`#playlists/${p.id}`}>
                      {t('common.edit')}
                    </a>
                    <button type="button" className="danger" onClick={() => remove(p)}>
                      {t('common.delete')}
                    </button>
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
