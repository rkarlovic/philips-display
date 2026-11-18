import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Capabilities, Faculty, Me, Media, MediaDetail } from '@slidecast/shared';
import { api } from '../api.js';
import { errorText } from '../errors.js';
import { formatBytes, formatDuration } from '../format.js';
import { OwnerBadge, OwnerSelect } from '../components/OwnerSelect.js';

interface UploadState {
  key: string;
  name: string;
  progress: number;
  error: string | null;
}

export function MediaThumb({ thumbUrl, kind }: { thumbUrl: string | null; kind: string }) {
  return thumbUrl ? (
    <img className="thumb" src={thumbUrl} alt="" loading="lazy" />
  ) : (
    <div className="thumb placeholder">{kind.toUpperCase()}</div>
  );
}

export function MediaMeta({ m }: { m: Pick<Media, 'kind' | 'pageCount' | 'durationSec'> }) {
  const { t } = useTranslation();
  return (
    <span className="muted small">
      {t(`kinds.${m.kind}`)}
      {(m.kind === 'pdf' || m.kind === 'pptx') &&
        m.pageCount > 0 &&
        ` · ${t('media.pages', { n: m.pageCount })}`}
      {m.kind === 'video' && m.durationSec != null && ` · ${formatDuration(m.durationSec)}`}
    </span>
  );
}

export function MediaLibrary({ me }: { me: Me }) {
  const { t, i18n } = useTranslation();
  const isSuper = me.role === 'super_admin';
  const [items, setItems] = useState<Media[] | null>(null);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [faculties, setFaculties] = useState<Faculty[]>([]);
  const [target, setTarget] = useState<number | null>(null);
  const [filter, setFilter] = useState<'all' | 'university' | number>('all');
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api
      .media()
      .then(setItems)
      .catch((e: unknown) => setError(errorText(t, e)));
    (isSuper ? api.faculties() : api.myFaculties()).then(setFaculties).catch(console.error);
  }, [t, isSuper]);

  useEffect(load, [load]);
  useEffect(() => {
    api.capabilities().then(setCaps).catch(console.error);
  }, []);

  // Refresh while anything is still processing.
  const processing = items?.some((m) => m.status === 'processing') ?? false;
  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, [processing, load]);

  const startUploads = (files: FileList | File[]) => {
    setError(null);
    for (const file of Array.from(files)) {
      const key = `${file.name}-${file.size}-${Math.random()}`;
      setUploads((u) => [...u, { key, name: file.name, progress: 0, error: null }]);
      const update = (patch: Partial<UploadState>) =>
        setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...patch } : x)));
      api
        .uploadMedia(file, isSuper ? target : null, (progress) => update({ progress }))
        .then(() => {
          setUploads((u) => u.filter((x) => x.key !== key));
          load();
        })
        .catch((e: unknown) => update({ error: errorText(t, e) }));
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) startUploads(e.dataTransfer.files);
  };

  const own = !isSuper ? faculties.find((f) => f.id === me.facultyId) : undefined;
  const shown =
    items?.filter((m) =>
      filter === 'all'
        ? true
        : filter === 'university'
          ? m.facultyId == null
          : m.facultyId === filter,
    ) ?? null;

  return (
    <section>
      <h1>{t('media.title')}</h1>

      <div
        className={`card dropzone${dragging ? ' dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <div className="row between">
          <div>
            <h2>{t('media.upload')}</h2>
            <p className="muted small">
              {t('media.dropHint')}{' '}
              {caps &&
                t('media.accepted', {
                  list: caps.acceptedExtensions.join(', '),
                  max: caps.maxUploadMb,
                })}
            </p>
            {caps && !caps.pptx && <p className="warn small">{t('media.noLibreOffice')}</p>}
            {own && (
              <p className="muted small" data-testid="usage">
                {own.storageQuotaMb == null
                  ? t('media.usageUnlimited', { used: formatBytes(own.usedBytes, i18n.language) })
                  : t('media.usage', {
                      used: formatBytes(own.usedBytes, i18n.language),
                      quota: formatBytes(own.storageQuotaMb * 1024 * 1024, i18n.language),
                    })}
              </p>
            )}
          </div>
          <div className="row">
            {isSuper && (
              <OwnerSelect
                faculties={faculties}
                value={target}
                onChange={setTarget}
                label={t('media.uploadTo')}
              />
            )}
            <button type="button" className="primary" onClick={() => fileInput.current?.click()}>
              {t('media.chooseFiles')}
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              accept={caps?.acceptedExtensions.join(',')}
              onChange={(e) => {
                if (e.target.files) startUploads(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
        </div>
        {uploads.map((u) => (
          <div key={u.key} className="upload-row">
            <span className="small">{u.name}</span>
            {u.error ? (
              <span className="error small">
                {u.error}{' '}
                <button
                  type="button"
                  onClick={() => setUploads((list) => list.filter((x) => x.key !== u.key))}
                >
                  ×
                </button>
              </span>
            ) : (
              <progress value={u.progress} max={1} />
            )}
          </div>
        ))}
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {isSuper && (
        <div className="row">
          <label className="row">
            {t('media.show')}
            <select
              value={String(filter)}
              onChange={(e) => {
                const v = e.target.value;
                setFilter(v === 'all' || v === 'university' ? v : Number(v));
              }}
            >
              <option value="all">{t('media.showAll')}</option>
              <option value="university">{t('owner.university')}</option>
              {faculties.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {shown === null ? (
        <p className="muted">{t('common.loading')}</p>
      ) : shown.length === 0 ? (
        <p className="muted">{t('media.empty')}</p>
      ) : (
        <div className="media-grid">
          {shown.map((m) => (
            <button
              type="button"
              key={m.id}
              className={`media-card status-${m.status}`}
              onClick={() => setOpenId(m.id)}
            >
              <MediaThumb thumbUrl={m.thumbUrl} kind={m.kind} />
              <span className="name" title={m.originalName}>
                {m.originalName}
              </span>
              <MediaMeta m={m} />
              <span className="row small">
                {m.status === 'processing' && (
                  <span className="muted">{t('media.processing')}</span>
                )}
                {m.status === 'failed' && (
                  <span className="error">{t(`mediaErrors.${m.error ?? 'unknown'}`)}</span>
                )}
                {(isSuper || m.facultyId == null) && <OwnerBadge name={m.facultyName} />}
              </span>
            </button>
          ))}
        </div>
      )}

      {openId != null && (
        <MediaDialog
          id={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => {
            setOpenId(null);
            load();
          }}
        />
      )}
    </section>
  );
}

function MediaDialog({
  id,
  onClose,
  onChanged,
}: {
  id: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [m, setM] = useState<MediaDetail | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .mediaDetail(id)
      .then((d) => {
        setM(d);
        setName(d.originalName);
      })
      .catch((e: unknown) => setError(errorText(t, e)));
  }, [id, t]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rename = async () => {
    try {
      await api.renameMedia(id, name);
      onChanged();
    } catch (e) {
      setError(errorText(t, e));
    }
  };

  const remove = async () => {
    if (!m || !confirm(t('media.deleteConfirm', { name: m.originalName }))) return;
    try {
      await api.deleteMedia(id);
      onChanged();
    } catch (e) {
      setError(errorText(t, e));
    }
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        {!m ? (
          <p className="muted">{error ?? t('common.loading')}</p>
        ) : (
          <>
            <div className="row between">
              <h2>{m.originalName}</h2>
              <button type="button" onClick={onClose} aria-label={t('common.close')}>
                ×
              </button>
            </div>
            <p className="muted small">
              <MediaMeta m={m} /> · {formatBytes(m.size, i18n.language)}
              {m.uploadedBy && ` · ${m.uploadedBy}`} · <OwnerBadge name={m.facultyName} />
            </p>
            {m.status === 'failed' && (
              <p className="error">{t(`mediaErrors.${m.error ?? 'unknown'}`)}</p>
            )}
            {m.status === 'processing' && <p className="muted">{t('media.processing')}</p>}

            {m.kind === 'video' && m.videoUrl && (
              <video className="preview-video" src={m.videoUrl} controls muted playsInline />
            )}
            {m.pages.length > 0 && (
              <>
                {(m.kind === 'pdf' || m.kind === 'pptx') && (
                  <p className="small muted">{t('media.checkPages')}</p>
                )}
                <div className="page-grid">
                  {m.pages.map((p) => (
                    <a key={p.pageNo} href={p.url} target="_blank" rel="noreferrer">
                      <img src={p.thumbUrl} alt={t('media.page', { n: p.pageNo })} loading="lazy" />
                      {m.pages.length > 1 && <span className="small muted">{p.pageNo}</span>}
                    </a>
                  ))}
                </div>
              </>
            )}

            <p className="small">
              {m.usedIn.length
                ? `${t('media.usedIn')} ${m.usedIn.map((p) => p.name).join(', ')}`
                : t('media.notUsed')}
            </p>

            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}

            {m.readOnly ? (
              <p className="muted small">{t('media.readOnly')}</p>
            ) : (
              <div className="row">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  aria-label={t('media.name')}
                />
                <button
                  type="button"
                  onClick={rename}
                  disabled={!name.trim() || name === m.originalName}
                >
                  {t('media.rename')}
                </button>
                <div className="spacer" />
                <button type="button" className="danger" onClick={remove}>
                  {t('common.delete')}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
