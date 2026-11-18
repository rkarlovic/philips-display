import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  Announcement,
  AnnouncementMode,
  AnnouncementTarget,
  Display,
  Faculty,
  Playlist,
} from '@slidecast/shared';
import { api } from '../api.js';
import { errorText } from '../errors.js';

type TargetKind = AnnouncementTarget['kind'];

interface Draft {
  id: number | null;
  title: string;
  playlistId: number;
  mode: AnnouncementMode;
  mixEvery: string;
  targetKind: TargetKind;
  facultyIds: number[];
  displayIds: number[];
  startsAt: string;
  endsAt: string;
}

/** 'YYYY-MM-DDTHH:MM' for now (browser clock; admins are on campus, same zone as TZ). */
function nowLocal(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const show = (local: string | null) => (local ? local.replace('T', ' ') : '');

export function Announcements() {
  const { t } = useTranslation();
  const [items, setItems] = useState<Announcement[] | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [faculties, setFaculties] = useState<Faculty[]>([]);
  const [displays, setDisplays] = useState<Display[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .announcements()
      .then(setItems)
      .catch((e: unknown) => setError(errorText(t, e)));
  }, [t]);

  useEffect(() => {
    load();
    api
      .playlists()
      .then((list) => setPlaylists(list.filter((p) => p.facultyId == null)))
      .catch(console.error);
    api.faculties().then(setFaculties).catch(console.error);
    api.displays().then(setDisplays).catch(console.error);
  }, [load]);

  const facultyName = useMemo(() => new Map(faculties.map((f) => [f.id, f.name])), [faculties]);
  const displayName = useMemo(() => new Map(displays.map((d) => [d.id, d.name])), [displays]);

  const targetText = (target: AnnouncementTarget) =>
    target.kind === 'all'
      ? t('announcements.targetAll')
      : target.kind === 'faculties'
        ? target.facultyIds.map((id) => facultyName.get(id) ?? `#${id}`).join(', ')
        : target.displayIds.map((id) => displayName.get(id) ?? `#${id}`).join(', ');

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const toggle = (key: 'facultyIds' | 'displayIds', id: number) =>
    setDraft((d) =>
      d
        ? {
            ...d,
            [key]: d[key].includes(id) ? d[key].filter((x) => x !== id) : [...d[key], id],
          }
        : d,
    );

  const startNew = () =>
    setDraft({
      id: null,
      title: '',
      playlistId: playlists[0]?.id ?? 0,
      mode: 'mix',
      mixEvery: '',
      targetKind: 'all',
      facultyIds: [],
      displayIds: [],
      startsAt: nowLocal(),
      endsAt: '',
    });

  const edit = (a: Announcement) =>
    setDraft({
      id: a.id,
      title: a.title,
      playlistId: a.playlistId,
      mode: a.mode,
      mixEvery: a.mixEveryNItems?.toString() ?? '',
      targetKind: a.target.kind,
      facultyIds: a.target.kind === 'faculties' ? a.target.facultyIds : [],
      displayIds: a.target.kind === 'displays' ? a.target.displayIds : [],
      startsAt: a.startsAtLocal,
      endsAt: a.endsAtLocal ?? '',
    });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    setError(null);
    const target: AnnouncementTarget =
      draft.targetKind === 'all'
        ? { kind: 'all' }
        : draft.targetKind === 'faculties'
          ? { kind: 'faculties', facultyIds: draft.facultyIds }
          : { kind: 'displays', displayIds: draft.displayIds };
    const body = {
      title: draft.title,
      playlistId: draft.playlistId,
      mode: draft.mode,
      target,
      startsAt: draft.startsAt,
      endsAt: draft.endsAt || null,
      mixEveryNItems: draft.mode === 'mix' && draft.mixEvery ? Number(draft.mixEvery) : null,
    };
    try {
      if (draft.id == null) await api.createAnnouncement(body);
      else await api.updateAnnouncement(draft.id, body);
      setDraft(null);
      load();
    } catch (err) {
      setError(errorText(t, err));
    }
  };

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      load();
    } catch (err) {
      setError(errorText(t, err));
    }
  };

  const targetOk =
    draft &&
    (draft.targetKind === 'all' ||
      (draft.targetKind === 'faculties' && draft.facultyIds.length > 0) ||
      (draft.targetKind === 'displays' && draft.displayIds.length > 0));

  return (
    <section>
      <h1>{t('announcements.title')}</h1>
      <p className="muted small">{t('announcements.intro')}</p>

      {!draft && (
        <div className="row">
          <button
            type="button"
            className="primary"
            onClick={startNew}
            disabled={playlists.length === 0}
          >
            + {t('announcements.new')}
          </button>
          {playlists.length === 0 && (
            <span className="small muted">{t('announcements.needPlaylist')}</span>
          )}
        </div>
      )}

      {draft && (
        <form className="card inline-form announcement-form" onSubmit={save}>
          <h2 className="full">
            {draft.id == null ? t('announcements.new') : t('announcements.edit')}
          </h2>
          <label>
            {t('announcements.name')}
            <input required value={draft.title} onChange={(e) => set({ title: e.target.value })} />
          </label>
          <label>
            {t('announcements.playlist')}
            <select
              value={draft.playlistId}
              onChange={(e) => set({ playlistId: Number(e.target.value) })}
            >
              {playlists.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="full choice">
            <legend>{t('announcements.mode')}</legend>
            {(['mix', 'takeover'] as const).map((m) => (
              <label key={m} className="radio">
                <input
                  type="radio"
                  name="mode"
                  checked={draft.mode === m}
                  onChange={() => set({ mode: m })}
                />
                <span>
                  <strong>{t(`announcements.modes.${m}`)}</strong>
                  <span className="small muted"> — {t(`announcements.modeHelp.${m}`)}</span>
                </span>
              </label>
            ))}
            {draft.mode === 'mix' && (
              <label className="inline">
                {t('announcements.mixEvery')}
                <input
                  type="number"
                  min={1}
                  max={1000}
                  placeholder={t('announcements.oncePerLoop')}
                  value={draft.mixEvery}
                  onChange={(e) => set({ mixEvery: e.target.value })}
                />
              </label>
            )}
          </fieldset>

          <fieldset className="full choice">
            <legend>{t('announcements.target')}</legend>
            {(['all', 'faculties', 'displays'] as const).map((k) => (
              <label key={k} className="radio">
                <input
                  type="radio"
                  name="target"
                  checked={draft.targetKind === k}
                  onChange={() => set({ targetKind: k })}
                />
                {t(`announcements.targets.${k}`)}
              </label>
            ))}
            {draft.targetKind === 'faculties' && (
              <div className="checks">
                {faculties.map((f) => (
                  <label key={f.id} className="check">
                    <input
                      type="checkbox"
                      checked={draft.facultyIds.includes(f.id)}
                      onChange={() => toggle('facultyIds', f.id)}
                    />
                    {f.name}
                  </label>
                ))}
              </div>
            )}
            {draft.targetKind === 'displays' && (
              <div className="checks">
                {displays.map((d) => (
                  <label key={d.id} className="check">
                    <input
                      type="checkbox"
                      checked={draft.displayIds.includes(d.id)}
                      onChange={() => toggle('displayIds', d.id)}
                    />
                    {d.name} <span className="muted small">({d.facultyName})</span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          <label>
            {t('announcements.startsAt')}
            <input
              type="datetime-local"
              required
              value={draft.startsAt}
              onChange={(e) => set({ startsAt: e.target.value })}
            />
          </label>
          <label>
            {t('announcements.endsAt')}
            <input
              type="datetime-local"
              value={draft.endsAt}
              onChange={(e) => set({ endsAt: e.target.value })}
            />
          </label>
          <p className="small muted full">{t('announcements.timeHint')}</p>

          {error && (
            <p className="error full" role="alert">
              {error}
            </p>
          )}
          <div className="row full">
            <button type="submit" className="primary" disabled={!targetOk || !draft.playlistId}>
              {t('common.save')}
            </button>
            <button type="button" onClick={() => setDraft(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}

      {!draft && error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {items === null ? (
        <p className="muted">{t('common.loading')}</p>
      ) : items.length === 0 ? (
        <p className="muted">{t('announcements.empty')}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('announcements.name')}</th>
                <th>{t('announcements.mode')}</th>
                <th>{t('announcements.target')}</th>
                <th>{t('announcements.when')}</th>
                <th>{t('users.status')}</th>
                <th>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id} className={a.status === 'ended' ? 'inactive' : ''}>
                  <td>
                    <strong>{a.title}</strong>
                    <div className="small muted">{a.playlistName}</div>
                  </td>
                  <td>
                    <span className={`badge ${a.mode === 'takeover' ? 'takeover' : ''}`}>
                      {t(`announcements.modes.${a.mode}`)}
                    </span>
                    {a.mode === 'mix' && (
                      <div className="small muted">
                        {a.mixEveryNItems
                          ? t('announcements.everyN', { n: a.mixEveryNItems })
                          : t('announcements.oncePerLoop')}
                      </div>
                    )}
                  </td>
                  <td>
                    {targetText(a.target)}
                    <div className="small muted">
                      {t('announcements.displayCount', { n: a.displayCount })}
                    </div>
                  </td>
                  <td className="small">
                    {show(a.startsAtLocal)} →{' '}
                    {a.endsAtLocal ? show(a.endsAtLocal) : t('announcements.untilEnded')}
                  </td>
                  <td>
                    <span className={`badge ${a.status === 'active' ? 'on' : ''}`}>
                      {t(`announcements.status.${a.status}`)}
                    </span>
                  </td>
                  <td className="actions">
                    <button type="button" onClick={() => edit(a)}>
                      {t('common.edit')}
                    </button>
                    {a.status === 'active' && (
                      <button
                        type="button"
                        onClick={() =>
                          confirm(t('announcements.endConfirm', { name: a.title })) &&
                          void run(() => api.endAnnouncement(a.id))
                        }
                      >
                        {t('announcements.endNow')}
                      </button>
                    )}
                    <button
                      type="button"
                      className="danger"
                      onClick={() =>
                        confirm(t('announcements.deleteConfirm', { name: a.title })) &&
                        void run(() => api.deleteAnnouncement(a.id))
                      }
                    >
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
