import { useTranslation } from 'react-i18next';
import type { Me } from '@slidecast/shared';

export function Dashboard({ me }: { me: Me }) {
  const { t } = useTranslation();
  return (
    <section className="card">
      <h1>{t('dashboard.welcome', { name: me.displayName || me.email })}</h1>
      <p>{t('dashboard.faculty', { name: me.facultyName ?? '' })}</p>
      <p className="muted">{t('dashboard.comingSoon')}</p>
    </section>
  );
}
