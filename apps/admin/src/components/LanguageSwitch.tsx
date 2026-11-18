import { useTranslation } from 'react-i18next';
import { LOCALES, type Locale } from '@slidecast/shared';

export function LanguageSwitch({
  value,
  onChange,
}: {
  value: Locale;
  onChange: (l: Locale) => void;
}) {
  const { t } = useTranslation();
  return (
    <select
      aria-label={t('lang.label')}
      value={value}
      onChange={(e) => onChange(e.target.value as Locale)}
    >
      {LOCALES.map((l) => (
        <option key={l} value={l}>
          {t(`lang.${l}`)}
        </option>
      ))}
    </select>
  );
}
