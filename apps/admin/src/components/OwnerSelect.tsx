import { useTranslation } from 'react-i18next';
import type { Faculty } from '@slidecast/shared';

/** Super admin only: pick university (null) or a faculty as the owner of new content. */
export function OwnerSelect({
  faculties,
  value,
  onChange,
  label,
}: {
  faculties: Faculty[];
  value: number | null;
  onChange: (v: number | null) => void;
  label: string;
}) {
  const { t } = useTranslation();
  return (
    <label>
      {label}
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">{t('owner.university')}</option>
        {faculties.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function OwnerBadge({ name }: { name: string | null }) {
  const { t } = useTranslation();
  return name ? (
    <span className="badge">{name}</span>
  ) : (
    <span className="badge uni">{t('owner.university')}</span>
  );
}
