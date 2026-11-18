import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Locale, Me } from '@slidecast/shared';
import { api, ApiRequestError } from './api.js';
import { setLocale } from './i18n/index.js';
import { Login } from './pages/Login.js';
import { Faculties } from './pages/Faculties.js';
import { Users } from './pages/Users.js';
import { MediaLibrary } from './pages/MediaLibrary.js';
import { Playlists } from './pages/Playlists.js';
import { PlaylistEditor } from './pages/PlaylistEditor.js';
import { Displays } from './pages/Displays.js';
import { LanguageSwitch } from './components/LanguageSwitch.js';

type Route =
  | { tab: 'displays' }
  | { tab: 'media' }
  | { tab: 'playlists'; id?: number }
  | { tab: 'faculties' }
  | { tab: 'users' };

/** Hash routes: #displays (default), #media, #playlists, #playlists/12, #faculties, #users. */
function routeFromHash(): Route {
  const [tab, id] = location.hash.replace(/^#/, '').split('/');
  switch (tab) {
    case 'playlists':
      return { tab, id: id ? Number(id) : undefined };
    case 'media':
    case 'faculties':
    case 'users':
      return { tab };
    default:
      return { tab: 'displays' };
  }
}

export function App() {
  const { t } = useTranslation();
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [route, setRoute] = useState<Route>(routeFromHash);

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
    const onHash = () => setRoute(routeFromHash());
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
  const tabs: { id: Route['tab']; label: string }[] = [
    { id: 'displays', label: t('nav.displays') },
    { id: 'media', label: t('nav.media') },
    { id: 'playlists', label: t('nav.playlists') },
    ...(isSuper
      ? [
          { id: 'faculties' as const, label: t('nav.faculties') },
          { id: 'users' as const, label: t('nav.users') },
        ]
      : []),
  ];

  return (
    <div className="app">
      <header className="topbar">
        <strong className="brand">{t('app.name')}</strong>
        <nav className="tabs">
          {tabs.map((tab) => (
            <a key={tab.id} href={`#${tab.id}`} className={route.tab === tab.id ? 'active' : ''}>
              {tab.label}
            </a>
          ))}
        </nav>
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
        {route.tab === 'displays' && <Displays me={me} />}
        {route.tab === 'media' && <MediaLibrary me={me} />}
        {route.tab === 'playlists' && route.id === undefined && <Playlists me={me} />}
        {route.tab === 'playlists' && route.id !== undefined && (
          <PlaylistEditor key={route.id} id={route.id} me={me} />
        )}
        {isSuper && route.tab === 'faculties' && <Faculties />}
        {isSuper && route.tab === 'users' && <Users />}
      </main>
    </div>
  );
}
