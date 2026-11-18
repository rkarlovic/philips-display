import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Me, Media, PlaylistDetail, PlaylistItemMedia, Transition } from '@slidecast/shared';
import { api } from '../api.js';
import { errorText } from '../errors.js';
import { formatDuration } from '../format.js';
import { OwnerBadge } from '../components/OwnerSelect.js';
import { MediaMeta, MediaThumb } from './MediaLibrary.js';
import { PreviewPlayer } from '../components/PreviewPlayer.js';

/** An item being edited (local state until Save). */
interface DraftItem {
  key: string;
  mediaId: number;
  media: PlaylistItemMedia;
  durationSec: string;
  pageFrom: string;
  pageTo: string;
}

let keySeq = 0;
const newKey = () => `k${++keySeq}`;
const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s));

export function PlaylistEditor({ id, me }: { id: number; me: Me }) {
  const { t } = useTranslation();
  const [pl, setPl] = useState<PlaylistDetail | null>(null);
  const [library, setLibrary] = useState<Media[]>([]);
  const [name, setName] = useState('');
  const [defaultDuration, setDefaultDuration] = useState('10');
  const [transition, setTransition] = useState<Transition>('fade');
  const [items, setItems] = useState<DraftItem[]>([]);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const load = useCallback(() => {
    api
      .playlist(id)
      .then((p) => {
        setPl(p);
        setName(p.name);
        setDefaultDuration(String(p.defaultDurationSec));
        setTransition(p.transition);
        setItems(
          p.items.map((i) => ({
            key: newKey(),
            mediaId: i.mediaId,
            media: i.media,
            durationSec: i.durationSec?.toString() ?? '',
            pageFrom: i.pageFrom?.toString() ?? '',
            pageTo: i.pageTo?.toString() ?? '',
          })),
        );
        setDirty(false);
      })
      .catch((e: unknown) => setError(errorText(t, e)));
    api.media().then(setLibrary).catch(console.error);
  }, [id, t]);

  useEffect(load, [load]);

  // Media that may go into this playlist: same faculty, or university media.
  const pickable = useMemo(
    () =>
      library.filter(
        (m) => m.status === 'ready' && (m.facultyId == null || m.facultyId === pl?.facultyId),
      ),
    [library, pl?.facultyId],
  );

  const change = (fn: (list: DraftItem[]) => DraftItem[]) => {
    setItems(fn);
    setDirty(true);
    setSaved(false);
  };

  const add = (m: Media) =>
    change((list) => [
      ...list,
      {
        key: newKey(),
        mediaId: m.id,
        media: {
          kind: m.kind,
          originalName: m.originalName,
          status: m.status,
          thumbUrl: m.thumbUrl,
          pageCount: m.pageCount,
          durationSec: m.durationSec,
        },
        durationSec: '',
        pageFrom: '',
        pageTo: '',
      },
    ]);

  const move = (index: number, delta: number) =>
    change((list) => {
      const next = [...list];
      const [it] = next.splice(index, 1);
      next.splice(index + delta, 0, it!);
      return next;
    });

  const setField = (key: string, field: 'durationSec' | 'pageFrom' | 'pageTo', value: string) =>
    change((list) => list.map((i) => (i.key === key ? { ...i, [field]: value } : i)));

  const save = async () => {
    setError(null);
    try {
      await api.updatePlaylist(id, {
        name,
        defaultDurationSec: Number(defaultDuration),
        transition,
      });
      const updated = await api.putPlaylistItems(id, {
        items: items.map((i) => ({
          mediaId: i.mediaId,
          durationSec: numOrNull(i.durationSec),
          pageFrom: numOrNull(i.pageFrom),
          pageTo: numOrNull(i.pageTo),
        })),
      });
      setPl(updated);
      setDirty(false);
      setSaved(true);
    } catch (e) {
      setError(errorText(t, e));
    }
  };

  // Approximate loop length for the summary line.
  const loopSec = items.reduce((sum, i) => {
    const d = numOrNull(i.durationSec) ?? Number(defaultDuration);
    if (i.media.kind === 'video')
      return sum + (numOrNull(i.durationSec) ?? i.media.durationSec ?? 0);
    if (i.media.kind === 'image') return sum + d;
    const from = numOrNull(i.pageFrom) ?? 1;
    const to = Math.min(numOrNull(i.pageTo) ?? i.media.pageCount, i.media.pageCount);
    return sum + Math.max(0, to - from + 1) * d;
  }, 0);

  if (!pl) return <p className="muted">{error ?? t('common.loading')}</p>;

  return (
    <section>
      <p>
        <a href="#playlists">← {t('playlists.back')}</a>
      </p>
      <div className="row between">
        <h1>{pl.name}</h1>
        {me.role === 'super_admin' && <OwnerBadge name={pl.facultyName} />}
      </div>

      <div className="card inline-form">
        <label>
          {t('playlists.name')}
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setDirty(true);
            }}
          />
        </label>
        <label>
          {t('playlists.defaultDuration')}
          <input
            type="number"
            min={1}
            max={86400}
            value={defaultDuration}
            onChange={(e) => {
              setDefaultDuration(e.target.value);
              setDirty(true);
            }}
          />
        </label>
        <label>
          {t('playlists.transition')}
          <select
            value={transition}
            onChange={(e) => {
              setTransition(e.target.value as Transition);
              setDirty(true);
            }}
          >
            <option value="fade">{t('playlists.transitions.fade')}</option>
            <option value="none">{t('playlists.transitions.none')}</option>
          </select>
        </label>
      </div>

      <div className="row between">
        <h2>
          {t('playlists.items')} ({items.length})
        </h2>
        <span className="muted small">
          {t('playlists.loopLength', { time: formatDuration(loopSec) })}
        </span>
      </div>
      <p className="muted small">{t('playlists.durationHelp')}</p>

      {items.length === 0 && <p className="muted">{t('playlists.noItems')}</p>}
      <ol className="item-list">
        {items.map((i, index) => {
          const doc = i.media.kind === 'pdf' || i.media.kind === 'pptx';
          return (
            <li key={i.key} className="item-row">
              <MediaThumb thumbUrl={i.media.thumbUrl} kind={i.media.kind} />
              <div className="item-main">
                <span className="name">{i.media.originalName}</span>
                <MediaMeta m={i.media} />
                {i.media.status !== 'ready' && (
                  <span className="warn small">{t('playlists.notReady')}</span>
                )}
              </div>
              <label className="small">
                {doc ? t('playlists.secondsPerPage') : t('playlists.secondsLabel')}
                <input
                  type="number"
                  min={1}
                  max={86400}
                  placeholder={i.media.kind === 'video' ? t('playlists.toEnd') : defaultDuration}
                  value={i.durationSec}
                  onChange={(e) => setField(i.key, 'durationSec', e.target.value)}
                />
              </label>
              {doc && (
                <>
                  <label className="small">
                    {t('playlists.pageFrom')}
                    <input
                      type="number"
                      min={1}
                      max={i.media.pageCount}
                      placeholder="1"
                      value={i.pageFrom}
                      onChange={(e) => setField(i.key, 'pageFrom', e.target.value)}
                    />
                  </label>
                  <label className="small">
                    {t('playlists.pageTo')}
                    <input
                      type="number"
                      min={1}
                      max={i.media.pageCount}
                      placeholder={String(i.media.pageCount)}
                      value={i.pageTo}
                      onChange={(e) => setField(i.key, 'pageTo', e.target.value)}
                    />
                  </label>
                </>
              )}
              <div className="item-actions">
                <button
                  type="button"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  aria-label={t('playlists.moveUp')}
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={index === items.length - 1}
                  onClick={() => move(index, 1)}
                  aria-label={t('playlists.moveDown')}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => change((list) => list.filter((x) => x.key !== i.key))}
                  aria-label={t('playlists.remove')}
                >
                  ×
                </button>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="row">
        <button type="button" onClick={() => setPickerOpen((o) => !o)}>
          {pickerOpen ? t('playlists.closePicker') : t('playlists.addMedia')}
        </button>
      </div>
      {pickerOpen &&
        (pickable.length === 0 ? (
          <p className="muted">{t('playlists.noMedia')}</p>
        ) : (
          <div className="media-grid compact">
            {pickable.map((m) => (
              <button type="button" key={m.id} className="media-card" onClick={() => add(m)}>
                <MediaThumb thumbUrl={m.thumbUrl} kind={m.kind} />
                <span className="name" title={m.originalName}>
                  {m.originalName}
                </span>
                <MediaMeta m={m} />
                {m.facultyId == null && <OwnerBadge name={null} />}
              </button>
            ))}
          </div>
        ))}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="row sticky-actions">
        <button type="button" className="primary" onClick={save} disabled={!dirty}>
          {t('common.save')}
        </button>
        {saved && <span className="muted small">{t('common.saved')}</span>}
        {dirty && <span className="warn small">{t('playlists.unsaved')}</span>}
        <div className="spacer" />
        <button type="button" onClick={() => setPreviewing(true)} disabled={dirty}>
          ▶ {t('playlists.preview')}
        </button>
      </div>

      {previewing && <PreviewPlayer playlistId={id} onClose={() => setPreviewing(false)} />}
    </section>
  );
}
