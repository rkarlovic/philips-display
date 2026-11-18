import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  Display,
  DisplayCommand,
  Faculty,
  Fit,
  Me,
  PendingDisplay,
  Playlist,
  Rotation,
  ServerToAdmin,
} from '@slidecast/shared';
import { api } from '../api.js';
import { errorText } from '../errors.js';
import { useLive } from '../live.js';
import { OwnerBadge } from '../components/OwnerSelect.js';
import { ScheduleDialog } from '../components/ScheduleDialog.js';

const ROTATIONS: Rotation[] = [0, 90, 180, 270];

function useRelativeTime() {
  const { t, i18n } = useTranslation();
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 15_000);
    return () => clearInterval(timer);
  }, []);
  return (iso: string | null) => {
    if (!iso) return t('displays.never');
    const sec = Math.round((Date.parse(iso) - Date.now()) / 1000);
    const rtf = new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' });
    const abs = Math.abs(sec);
    if (abs < 60) return rtf.format(sec, 'second');
    if (abs < 3600) return rtf.format(Math.round(sec / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(sec / 3600), 'hour');
    return rtf.format(Math.round(sec / 86400), 'day');
  };
}

const fullUrl = (path: string) => `${location.protocol}//${location.host}${path}`;

export function Displays({ me }: { me: Me }) {
  const { t } = useTranslation();
  const isSuper = me.role === 'super_admin';
  const [displays, setDisplays] = useState<Display[] | null>(null);
  const [pending, setPending] = useState<PendingDisplay[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [faculties, setFaculties] = useState<Faculty[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<Display | null>(null);
  const [schedulingId, setSchedulingId] = useState<number | null>(null);
  const [timezone, setTimezone] = useState<string | undefined>(undefined);
  const { i18n } = useTranslation();
  const [setupUrl, setSetupUrl] = useState<{ name: string; url: string } | null>(null);
  const ago = useRelativeTime();

  useEffect(() => {
    api
      .capabilities()
      .then((c) => setTimezone(c.timezone))
      .catch(console.error);
  }, []);

  /** Times are shown in the server's zone (TZ), where the schedules apply. */
  const fmtTime = (iso: string | null, withDay = false) => {
    if (!iso) return '';
    const opts: Intl.DateTimeFormatOptions = {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone,
    };
    if (withDay) opts.weekday = 'short';
    try {
      return new Intl.DateTimeFormat(i18n.language, opts).format(new Date(iso));
    } catch {
      return new Date(iso).toLocaleString();
    }
  };

  const loadPending = useCallback(() => {
    if (isSuper) api.pendingDisplays().then(setPending).catch(console.error);
  }, [isSuper]);

  const load = useCallback(() => {
    api
      .displays()
      .then(setDisplays)
      .catch((e: unknown) => setError(errorText(t, e)));
    api.playlists().then(setPlaylists).catch(console.error);
    if (isSuper) api.faculties().then(setFaculties).catch(console.error);
    loadPending();
  }, [t, isSuper, loadPending]);

  useEffect(load, [load]);

  useLive((msg: ServerToAdmin) => {
    if (msg.type === 'display') {
      setDisplays((list) => {
        if (!list) return list;
        const i = list.findIndex((d) => d.id === msg.display.id);
        if (i === -1) return [...list, msg.display];
        const next = [...list];
        next[i] = msg.display;
        return next;
      });
    } else if (msg.type === 'display_removed') {
      setDisplays((list) => list?.filter((d) => d.id !== msg.id) ?? list);
    } else if (msg.type === 'pending_changed') {
      loadPending();
    }
  }, load);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(errorText(t, e));
      return false;
    }
  };

  const command = (d: Display, c: DisplayCommand) =>
    run(async () => {
      const res = await api.displayCommand(d.id, c);
      if (!res.delivered) setNotice(t('displays.offlineCommand', { name: d.name }));
    });

  const setDefault = (d: Display, value: string) =>
    run(async () => {
      const updated = await api.updateDisplay(d.id, {
        defaultPlaylistId: value ? Number(value) : null,
      });
      setDisplays((list) => list?.map((x) => (x.id === d.id ? updated : x)) ?? list);
    });

  const playlistsFor = (d: Display) =>
    playlists.filter((p) => p.facultyId === d.facultyId || p.facultyId == null);

  return (
    <section>
      <h1>{t('displays.title')}</h1>

      {isSuper && (
        <PairForm
          faculties={faculties}
          pending={pending}
          ago={ago}
          onPaired={(name, path) => {
            setSetupUrl({ name, url: fullUrl(path) });
            load();
          }}
        />
      )}

      {setupUrl && (
        <div className="card notice" role="status">
          <p>{t('displays.paired', { name: setupUrl.name })}</p>
          <p className="small muted">{t('displays.setupUrlHint')}</p>
          <code className="setup-url">{setupUrl.url}</code>
          <div className="row">
            <button type="button" onClick={() => void navigator.clipboard?.writeText(setupUrl.url)}>
              {t('displays.copy')}
            </button>
            <button type="button" onClick={() => setSetupUrl(null)}>
              {t('common.close')}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="warn">{notice}</p>}

      {displays === null ? (
        <p className="muted">{t('common.loading')}</p>
      ) : displays.length === 0 ? (
        <p className="muted">{isSuper ? t('displays.emptySuper') : t('displays.empty')}</p>
      ) : (
        <div className="display-grid">
          {displays.map((d) => (
            <article key={d.id} className={`card display-card${d.online ? ' online' : ''}`}>
              <div className="row between">
                <h2>
                  <span className={`dot ${d.online ? 'on' : 'off'}`} aria-hidden="true" />
                  {d.name}
                </h2>
                {isSuper && <OwnerBadge name={d.facultyName} />}
              </div>
              <p className="muted small">
                {d.location && `${d.location} · `}
                {d.online
                  ? t('displays.online')
                  : t('displays.offline', { ago: ago(d.lastSeenAt) })}
                {d.rotation !== 0 && ` · ${d.rotation}°`}
              </p>

              <p className="small now-playing">
                {d.state?.paused && <span className="badge">{t('displays.paused')}</span>}{' '}
                {d.nowPlaying
                  ? t('displays.nowPlaying', {
                      name: d.nowPlaying.mediaName,
                      page: d.nowPlaying.pageNo
                        ? ` · ${t('media.page', { n: d.nowPlaying.pageNo })}`
                        : '',
                      n: (d.state?.itemIndex ?? 0) + 1,
                      total: d.state?.itemCount ?? 0,
                    })
                  : d.state && d.state.itemCount === 0
                    ? t('displays.idle')
                    : '—'}
              </p>
              <p className="small source">
                {d.playing.source === 'takeover' && d.playing.takeover
                  ? `📢 ${t('displays.byTakeover', {
                      name: d.playing.takeover.title,
                      until: d.playing.until
                        ? fmtTime(d.playing.until, true)
                        : t('displays.untilEnded'),
                    })}`
                  : d.playing.source === 'schedule'
                    ? t('displays.bySchedule', {
                        name: d.playing.playlistName,
                        until: fmtTime(d.playing.until),
                      })
                    : d.playing.source === 'default'
                      ? t('displays.byDefault', { name: d.playing.playlistName })
                      : d.playing.source === 'mix'
                        ? t('displays.byMixOnly')
                        : t('displays.byIdle')}
                {d.playing.nextChangeAt &&
                  ` · ${t('displays.nextChange', { at: fmtTime(d.playing.nextChangeAt, true) })}`}
              </p>
              {d.playing.mixIns.length > 0 && (
                <p className="small mixins">
                  📢{' '}
                  {t('displays.mixIns', { names: d.playing.mixIns.map((m) => m.title).join(', ') })}
                </p>
              )}
              {d.state && d.state.errors.length > 0 && (
                <details className="small">
                  <summary className="warn">
                    {t('displays.errors', { n: d.state.errors.length })}
                  </summary>
                  <ul>
                    {d.state.errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </details>
              )}

              <label className="small">
                {t('displays.defaultPlaylist')}
                <select
                  value={d.defaultPlaylistId ?? ''}
                  onChange={(e) => void setDefault(d, e.target.value)}
                >
                  <option value="">{t('displays.noPlaylist')}</option>
                  {playlistsFor(d).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.facultyId == null ? ` (${t('owner.university')})` : ''}
                    </option>
                  ))}
                </select>
              </label>

              <button type="button" className="schedule-btn" onClick={() => setSchedulingId(d.id)}>
                🗓 {t('displays.schedule', { n: d.scheduleCount })}
              </button>

              <div className="row controls">
                <button
                  type="button"
                  onClick={() => void command(d, 'prev')}
                  title={t('displays.cmd.prev')}
                >
                  ⏮
                </button>
                {d.state?.paused ? (
                  <button type="button" onClick={() => void command(d, 'resume')}>
                    ▶ {t('displays.cmd.resume')}
                  </button>
                ) : (
                  <button type="button" onClick={() => void command(d, 'pause')}>
                    ⏸ {t('displays.cmd.pause')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void command(d, 'next')}
                  title={t('displays.cmd.next')}
                >
                  ⏭
                </button>
                <button type="button" onClick={() => void command(d, 'reload')}>
                  ⟳ {t('displays.cmd.reload')}
                </button>
              </div>

              {isSuper && (
                <div className="row">
                  <button type="button" onClick={() => setEditing(d)}>
                    {t('common.edit')}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      confirm(t('displays.newTokenConfirm', { name: d.name })) &&
                      void run(async () => {
                        const res = await api.newDisplayToken(d.id);
                        setSetupUrl({ name: d.name, url: fullUrl(res.setupPath) });
                      })
                    }
                  >
                    {t('displays.newToken')}
                  </button>
                  <div className="spacer" />
                  <button
                    type="button"
                    className="danger"
                    onClick={() =>
                      confirm(t('displays.revokeConfirm', { name: d.name })) &&
                      void run(() => api.revokeDisplay(d.id))
                    }
                  >
                    {t('displays.revoke')}
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {schedulingId != null &&
        (() => {
          const d = displays?.find((x) => x.id === schedulingId);
          return d ? (
            <ScheduleDialog
              display={d}
              playlists={playlistsFor(d).filter((p) => isSuper || p.facultyId != null)}
              onClose={() => setSchedulingId(null)}
            />
          ) : null;
        })()}

      {editing && (
        <EditDisplayDialog
          display={editing}
          faculties={faculties}
          onClose={() => setEditing(null)}
          onSaved={(d) => {
            setDisplays((list) => list?.map((x) => (x.id === d.id ? d : x)) ?? list);
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}

function PairForm({
  faculties,
  pending,
  ago,
  onPaired,
}: {
  faculties: Faculty[];
  pending: PendingDisplay[];
  ago: (iso: string | null) => string;
  onPaired: (name: string, setupPath: string) => void;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [facultyId, setFacultyId] = useState(0);
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [rotation, setRotation] = useState<Rotation>(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!facultyId && faculties[0]) setFacultyId(faculties[0].id);
  }, [faculties, facultyId]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await api.pairDisplay({ code, facultyId, name, location, rotation });
      setCode('');
      setName('');
      setLocation('');
      onPaired(res.display.name, res.setupPath);
    } catch (err) {
      setError(errorText(t, err));
    }
  };

  return (
    <form className="card inline-form" onSubmit={submit}>
      <h2>{t('displays.pairTitle')}</h2>
      <p className="small muted full">{t('displays.pairHint')}</p>
      <label>
        {t('displays.code')}
        <input
          required
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="ABC 123"
          autoComplete="off"
          className="code-input"
        />
      </label>
      <label>
        {t('users.faculty')}
        <select value={facultyId} onChange={(e) => setFacultyId(Number(e.target.value))} required>
          {faculties.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t('displays.name')}
        <input required value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        {t('displays.location')}
        <input value={location} onChange={(e) => setLocation(e.target.value)} />
      </label>
      <label>
        {t('displays.rotation')}
        <select value={rotation} onChange={(e) => setRotation(Number(e.target.value) as Rotation)}>
          {ROTATIONS.map((r) => (
            <option key={r} value={r}>
              {t(`displays.rotations.r${r}`)}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="primary" disabled={faculties.length === 0}>
        {t('displays.pair')}
      </button>
      {error && (
        <p className="error full" role="alert">
          {error}
        </p>
      )}
      {pending.length > 0 && (
        <p className="small muted full">
          {t('displays.waiting')}{' '}
          {pending.map((p) => (
            <button
              type="button"
              key={p.id}
              className="chip"
              onClick={() => setCode(p.code)}
              title={p.userAgent ?? ''}
            >
              {p.code} · {ago(p.lastSeenAt)}
            </button>
          ))}
        </p>
      )}
    </form>
  );
}

function EditDisplayDialog({
  display,
  faculties,
  onClose,
  onSaved,
}: {
  display: Display;
  faculties: Faculty[];
  onClose: () => void;
  onSaved: (d: Display) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(display.name);
  const [location, setLocation] = useState(display.location);
  const [rotation, setRotation] = useState<Rotation>(display.rotation);
  const [fit, setFit] = useState<Fit>(display.fit);
  const [facultyId, setFacultyId] = useState(display.facultyId);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      onSaved(await api.updateDisplay(display.id, { name, location, rotation, fit, facultyId }));
    } catch (err) {
      setError(errorText(t, err));
    }
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <form
        className="dialog inline-form"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        onSubmit={save}
      >
        <h2>{display.name}</h2>
        <label>
          {t('displays.name')}
          <input required value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          {t('displays.location')}
          <input value={location} onChange={(e) => setLocation(e.target.value)} />
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
          {t('displays.rotation')}
          <select
            value={rotation}
            onChange={(e) => setRotation(Number(e.target.value) as Rotation)}
          >
            {ROTATIONS.map((r) => (
              <option key={r} value={r}>
                {t(`displays.rotations.r${r}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('displays.fit')}
          <select value={fit} onChange={(e) => setFit(e.target.value as Fit)}>
            <option value="contain">{t('displays.fits.contain')}</option>
            <option value="cover">{t('displays.fits.cover')}</option>
          </select>
        </label>
        {error && (
          <p className="error full" role="alert">
            {error}
          </p>
        )}
        <div className="row full">
          <button type="submit" className="primary">
            {t('common.save')}
          </button>
          <button type="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </div>
  );
}
