import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Display, Playlist, Schedule } from '@slidecast/shared';
import { api } from '../api.js';
import { errorText } from '../errors.js';

const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];
const WORKDAYS = [1, 2, 3, 4, 5];

/** Short weekday names in the UI language (2 March 2026 is a Monday). */
export function useWeekdayNames(): (d: number) => string {
  const { i18n } = useTranslation();
  return useMemo(() => {
    const f = new Intl.DateTimeFormat(i18n.language, { weekday: 'short', timeZone: 'UTC' });
    const names = ALL_DAYS.map((d) => f.format(new Date(Date.UTC(2026, 2, 1 + d))));
    return (d: number) => names[d - 1] ?? String(d);
  }, [i18n.language]);
}

export function formatDays(days: number[], name: (d: number) => string, t: (k: string) => string) {
  const key = days.join(',');
  if (key === ALL_DAYS.join(',')) return t('schedules.everyDay');
  if (key === WORKDAYS.join(',')) return t('schedules.workdays');
  return days.map(name).join(', ');
}

interface Draft {
  id: number | null;
  playlistId: number;
  weekdays: number[];
  startTime: string;
  endTime: string;
  dateFrom: string;
  dateTo: string;
  priority: string;
}

const emptyDraft = (playlistId: number): Draft => ({
  id: null,
  playlistId,
  weekdays: WORKDAYS,
  startTime: '08:00',
  endTime: '16:00',
  dateFrom: '',
  dateTo: '',
  priority: '0',
});

export function ScheduleDialog({
  display,
  playlists,
  onClose,
}: {
  display: Display;
  /** Playlists this display may use. */
  playlists: Playlist[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const dayName = useWeekdayNames();
  const [items, setItems] = useState<Schedule[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .schedules(display.id)
      .then(setItems)
      .catch((e: unknown) => setError(errorText(t, e)));
  }, [display.id, t]);
  useEffect(load, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const toggleDay = (d: number) =>
    setDraft((cur) =>
      cur
        ? {
            ...cur,
            weekdays: cur.weekdays.includes(d)
              ? cur.weekdays.filter((x) => x !== d)
              : [...cur.weekdays, d].sort((a, b) => a - b),
          }
        : cur,
    );

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    setError(null);
    const body = {
      playlistId: draft.playlistId,
      weekdays: draft.weekdays,
      startTime: draft.startTime,
      endTime: draft.endTime,
      dateFrom: draft.dateFrom || null,
      dateTo: draft.dateTo || null,
      priority: Number(draft.priority || 0),
    };
    try {
      if (draft.id == null) await api.createSchedule(display.id, body);
      else await api.updateSchedule(draft.id, body);
      setDraft(null);
      load();
    } catch (err) {
      setError(errorText(t, err));
    }
  };

  const remove = async (s: Schedule) => {
    if (!confirm(t('schedules.deleteConfirm'))) return;
    try {
      await api.deleteSchedule(s.id);
      load();
    } catch (err) {
      setError(errorText(t, err));
    }
  };

  const crossesMidnight = draft && draft.endTime <= draft.startTime;

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <h2>{t('schedules.title', { name: display.name })}</h2>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ×
          </button>
        </div>
        <p className="small muted">{t('schedules.intro')}</p>

        {items === null ? (
          <p className="muted">{t('common.loading')}</p>
        ) : items.length === 0 ? (
          <p className="muted">{t('schedules.empty')}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('schedules.when')}</th>
                  <th>{t('schedules.playlist')}</th>
                  <th>{t('schedules.priority')}</th>
                  <th>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((s) => (
                  <tr key={s.id} className={s.id === display.playing.scheduleId ? 'winning' : ''}>
                    <td>
                      <strong>{formatDays(s.weekdays, dayName, t)}</strong> {s.startTime}–
                      {s.endTime}
                      {(s.dateFrom || s.dateTo) && (
                        <div className="small muted">
                          {t('schedules.dates', { from: s.dateFrom ?? '…', to: s.dateTo ?? '…' })}
                        </div>
                      )}
                      {s.activeNow && <span className="badge on">{t('schedules.activeNow')}</span>}
                    </td>
                    <td>{s.playlistName}</td>
                    <td>{s.priority}</td>
                    <td className="actions">
                      <button
                        type="button"
                        onClick={() =>
                          setDraft({
                            id: s.id,
                            playlistId: s.playlistId,
                            weekdays: s.weekdays,
                            startTime: s.startTime,
                            endTime: s.endTime,
                            dateFrom: s.dateFrom ?? '',
                            dateTo: s.dateTo ?? '',
                            priority: String(s.priority),
                          })
                        }
                      >
                        {t('common.edit')}
                      </button>
                      <button type="button" className="danger" onClick={() => void remove(s)}>
                        {t('common.delete')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!draft ? (
          <div className="row">
            <button
              type="button"
              className="primary"
              disabled={playlists.length === 0}
              onClick={() => setDraft(emptyDraft(playlists[0]?.id ?? 0))}
            >
              + {t('schedules.add')}
            </button>
            {playlists.length === 0 && (
              <span className="small muted">{t('schedules.noPlaylists')}</span>
            )}
          </div>
        ) : (
          <form className="card inline-form schedule-form" onSubmit={save}>
            <h2 className="full">{draft.id == null ? t('schedules.add') : t('schedules.edit')}</h2>
            <label>
              {t('schedules.playlist')}
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
            <fieldset className="full days">
              <legend>{t('schedules.days')}</legend>
              {ALL_DAYS.map((d) => (
                <label key={d} className="day">
                  <input
                    type="checkbox"
                    checked={draft.weekdays.includes(d)}
                    onChange={() => toggleDay(d)}
                  />
                  {dayName(d)}
                </label>
              ))}
              <button type="button" className="chip" onClick={() => set({ weekdays: WORKDAYS })}>
                {t('schedules.workdays')}
              </button>
              <button type="button" className="chip" onClick={() => set({ weekdays: ALL_DAYS })}>
                {t('schedules.everyDay')}
              </button>
            </fieldset>
            <label>
              {t('schedules.from')}
              <input
                type="time"
                required
                value={draft.startTime}
                onChange={(e) => set({ startTime: e.target.value })}
              />
            </label>
            <label>
              {t('schedules.to')}
              <input
                type="time"
                required
                value={draft.endTime}
                onChange={(e) => set({ endTime: e.target.value })}
              />
            </label>
            <label>
              {t('schedules.dateFrom')}
              <input
                type="date"
                value={draft.dateFrom}
                onChange={(e) => set({ dateFrom: e.target.value })}
              />
            </label>
            <label>
              {t('schedules.dateTo')}
              <input
                type="date"
                value={draft.dateTo}
                onChange={(e) => set({ dateTo: e.target.value })}
              />
            </label>
            <label>
              {t('schedules.priority')}
              <input
                type="number"
                min={-100}
                max={100}
                value={draft.priority}
                onChange={(e) => set({ priority: e.target.value })}
              />
            </label>
            <p className="small muted full">
              {crossesMidnight
                ? draft.startTime === draft.endTime
                  ? t('schedules.allDayHint')
                  : t('schedules.overnightHint')
                : t('schedules.priorityHint')}
            </p>
            {error && (
              <p className="error full" role="alert">
                {error}
              </p>
            )}
            <div className="row full">
              <button type="submit" className="primary" disabled={draft.weekdays.length === 0}>
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
      </div>
    </div>
  );
}
