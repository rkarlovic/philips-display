import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Locale, Me } from '@slidecast/shared';
import { api, ApiRequestError } from './api.js';
import { setLocale } from './i18n/index.js';
import { Login } from './pages/Login.js';
import { Faculties } from './pages/Faculties.js';
import { Users } from './pages/Users.js';
import { Dashboard } from './pages/Dashboard.js';
import { LanguageSwitch } from './components/LanguageSwitch.js';

type Tab = 'faculties' | 'users';

function tabFromHash(): Tab {
  return location.hash === '#users' ? 'users' : 'faculties';
}

export function App() {
  const { t } = useTranslation();
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>(tabFromHash);

  useEffect(() => {
    api
      .me()
      .then((u) => {
        setLocale(u.locale);
        setMe(u);
      })
      .catch((err: unknown) => {
        if (!(err instanceof ApiRequestError) || err.status !== 401) console.error(err);
        setMe(null);
      });
  }, []);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const changeLocale = (locale: Locale) => {
    setLocale(locale);
    if (me) {
      setMe({ ...me, locale });
      api.updateMe({ locale }).catch(console.error);
    }
  };

  const logout = async () => {
    await api.logout().catch(console.error);
    setMe(null);
  };

  if (me === undefined) return <p className="center muted">{t('common.loading')}</p>;

  if (me === null) {
    return (
      <Login
        onLoggedIn={(u) => {
          setLocale(u.locale);
          setMe(u);
        }}
        onLocale={changeLocale}
      />
    );
  }

  const isSuper = me.role === 'super_admin';

  return (
    <div className="app">
      <header className="topbar">
        <strong className="brand">{t('app.name')}</strong>
        {isSuper && (
          <nav className="tabs">
            <a href="#faculties" className={tab === 'faculties' ? 'active' : ''}>
              {t('nav.faculties')}
            </a>
            <a href="#users" className={tab === 'users' ? 'active' : ''}>
              {t('nav.users')}
            </a>
          </nav>
        )}
        <div className="spacer" />
        <span className="muted who" data-testid="who">
          {me.email} · {isSuper ? t('nav.superAdmin') : me.facultyName}
        </span>
        <LanguageSwitch value={me.locale} onChange={changeLocale} />
        <button type="button" onClick={logout}>
          {t('nav.logout')}
        </button>
      </header>
      <main className="content">
        {!isSuper && <Dashboard me={me} />}
        {isSuper && tab === 'faculties' && <Faculties />}
        {isSuper && tab === 'users' && <Users />}
      </main>
    </div>
  );
}
