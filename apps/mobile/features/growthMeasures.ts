import { t } from '@subby/shared/i18n';

/** The measures a growth chart switches between, labelled in the current language. */
export const growthMeasures = () =>
  [
    { value: 'weightKg', label: t('growth.weight') },
    { value: 'lengthCm', label: t('growth.length') },
    { value: 'headCm', label: t('growth.head') },
  ] as const;
