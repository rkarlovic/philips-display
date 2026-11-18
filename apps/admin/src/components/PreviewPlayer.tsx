import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PlaylistPreview } from '@slidecast/shared';
import { api } from '../api.js';
import { errorText } from '../errors.js';

/**
 * Plays the flat loop from /api/playlists/:id/preview, the same steps a display will play:
 * every image stays `durationSec`, videos play to their end (or `durationSec`),
 * and after the last step it starts again from the first.
 */
export function PreviewPlayer({
  playlistId,
  onClose,
}: {
  playlistId: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<PlaylistPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [loops, setLoops] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    api
      .playlistPreview(playlistId)
      .then(setPreview)
      .catch((e: unknown) => setError(errorText(t, e)));
  }, [playlistId, t]);

  const count = preview?.items.length ?? 0;
  const next = useCallback(() => {
    if (!count) return;
    setIndex((i) => {
      if (i + 1 >= count) setLoops((l) => l + 1);
      return (i + 1) % count;
    });
  }, [count]);
  const prev = () => count && setIndex((i) => (i - 1 + count) % count);

  const item = preview?.items[index];

  // Timer for images (and videos with an explicit duration).
  useEffect(() => {
    if (!item || paused || item.durationSec == null) return;
    const timer = setTimeout(next, item.durationSec * 1000);
    return () => clearTimeout(timer);
  }, [item, index, paused, next]);

  // Preload the next image.
  useEffect(() => {
    const n = preview?.items[(index + 1) % (count || 1)];
    if (n?.type === 'image') new Image().src = n.url;
  }, [preview, index, count]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
      if (e.key === ' ') setPaused((p) => !p);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (paused) v.pause();
    else void v.play().catch(() => {});
  }, [paused, index]);

  const fade = preview?.transition === 'fade' ? ' fade' : '';

  return (
    <div className="player-overlay" role="dialog" aria-modal="true">
      <div className="player-stage">
        {error && <p className="error">{error}</p>}
        {preview && count === 0 && <p className="player-empty">{t('preview.empty')}</p>}
        {item?.type === 'image' && (
          <img key={`${index}-${loops}`} className={`player-media${fade}`} src={item.url} alt="" />
        )}
        {item?.type === 'video' && (
          <video
            ref={videoRef}
            key={`${index}-${loops}`}
            className={`player-media${fade}`}
            src={item.url}
            muted
            playsInline
            autoPlay
            onEnded={() => item.durationSec == null && !paused && next()}
            onError={next}
          />
        )}
      </div>
      <div className="player-bar">
        <span>
          {count > 0 &&
            t('preview.step', {
              n: index + 1,
              total: count,
              time:
                item?.durationSec == null
                  ? t('preview.toEnd')
                  : t('preview.seconds', { n: item.durationSec }),
            })}
          {loops > 0 && ` · ${t('preview.loops', { n: loops })}`}
        </span>
        <div className="spacer" />
        <button type="button" onClick={prev} aria-label={t('preview.prev')}>
          ⏮
        </button>
        <button type="button" onClick={() => setPaused((p) => !p)}>
          {paused ? `▶ ${t('preview.resume')}` : `⏸ ${t('preview.pause')}`}
        </button>
        <button type="button" onClick={next} aria-label={t('preview.next')}>
          ⏭
        </button>
        <button type="button" onClick={onClose}>
          {t('common.close')}
        </button>
      </div>
    </div>
  );
}
