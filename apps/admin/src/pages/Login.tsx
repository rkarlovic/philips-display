import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Locale, Me } from '@slidecast/shared';
import { api, ApiRequestError } from '../api.js';
import { errorText } from '../errors.js';
import { LanguageSwitch } from '../components/LanguageSwitch.js';

export function Login({
  onLoggedIn,
  onLocale,
}: {
  onLoggedIn: (me: Me) => void;
  onLocale: (l: Locale) => void;
}) {
  const { t, i18n } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const me = await api.login({ email, password: needsPassword ? password : undefined });
      onLoggedIn(me);
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'password_required') {
        setNeedsPassword(true);
      } else {
        setError(errorText(t, err));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <div className="row between">
          <h1>{t('app.name')}</h1>
          <LanguageSwitch value={i18n.language as Locale} onChange={onLocale} />
        </div>
        <p className="muted">{t('app.tagline')}</p>
        <h2>{t('login.title')}</h2>
        <p className="muted small">{t('login.hint')}</p>
        <label>
          {t('login.email')}
          <input
            type="email"
            name="email"
            autoComplete="username"
            required
            autoFocus
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setNeedsPassword(false);
            }}
          />
        </label>
        {needsPassword && (
          <label>
            {t('login.password')}
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <span className="muted small">{t('login.passwordHint')}</span>
          </label>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="primary" disabled={busy}>
          {t('login.submit')}
        </button>
      </form>
    </div>
  );
}
