import { t } from '@subby/shared/i18n';
import React from 'react';
import { Baby, Plus, PoopDroplet } from '../icons';
import { useSheetStore, type SheetRequest } from '../../store/useSheetStore';
import BottomSheet from '../BottomSheet';
import { TYPE_META } from '../logTypes';
import AddLogSheet from './AddLogSheet';
import DiaperSheet from './DiaperSheet';
import FeedSheet from './FeedSheet';
import LogSheet from './LogSheet';
import { colors } from '../../theme/colors';

function header(sheet: SheetRequest): { title: string; icon: React.ReactNode } {
  switch (sheet.kind) {
    case 'feed':
      return { title: t('sheet.log.feed'), icon: <Baby color={colors.cyanSoft} size={20} /> };
    case 'add':
      return { title: t('sheet.logSomething'), icon: <Plus color={colors.violetSoft} size={20} /> };
    case 'diaper':
      return { title: t('type.diaper'), icon: <PoopDroplet color={colors.amberStrong} size={20} /> };
    case 'log': {
      const { Icon, color } = TYPE_META[sheet.type];
      return { title: t(`sheet.log.${sheet.type}`), icon: <Icon color={color} size={20} /> };
    }
  }
}

/**
 * The single bottom sheet on Home; requests from useSheetStore swap its content.
 * One persistent Modal avoids iOS failing to present a new modal while another dismisses.
 */
export default function SheetHost() {
  const sheet = useSheetStore((s) => s.sheet);
  const close = useSheetStore((s) => s.close);
  const { title, icon } = sheet ? header(sheet) : { title: '', icon: null };

  return (
    <BottomSheet visible={sheet !== null} onClose={close} title={title} icon={icon}>
      {sheet?.kind === 'feed' ? <FeedSheet key="feed" initialTab={sheet.tab} onClose={close} /> : null}
      {sheet?.kind === 'add' ? <AddLogSheet key="add" at={sheet.at} /> : null}
      {sheet?.kind === 'diaper' ? <DiaperSheet key="diaper" onClose={close} /> : null}
      {/* Keyed so switching from one type to another resets the form state. */}
      {sheet?.kind === 'log' ? <LogSheet key={`log-${sheet.type}`} type={sheet.type} initial={sheet.payload} initialStart={sheet.at} onClose={close} /> : null}
    </BottomSheet>
  );
}
