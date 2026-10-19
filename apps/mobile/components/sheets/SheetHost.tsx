import React from 'react';
import { Baby, Plus } from 'lucide-react-native';
import { useSheetStore, type SheetRequest } from '../../store/useSheetStore';
import BottomSheet from '../BottomSheet';
import { TYPE_META } from '../logTypes';
import AddLogSheet from './AddLogSheet';
import FeedSheet from './FeedSheet';
import LogSheet from './LogSheet';

function header(sheet: SheetRequest): { title: string; icon: React.ReactNode } {
  switch (sheet.kind) {
    case 'feed':
      return { title: 'Log feed', icon: <Baby color="#67e8f9" size={20} /> };
    case 'add':
      return { title: 'Log something', icon: <Plus color="#c4b5fd" size={20} /> };
    case 'log': {
      const { label, Icon, color } = TYPE_META[sheet.type];
      return { title: `Log ${label.toLowerCase()}`, icon: <Icon color={color} size={20} /> };
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
      {sheet?.kind === 'add' ? <AddLogSheet key="add" /> : null}
      {/* Keyed so switching from one type to another resets the form state. */}
      {sheet?.kind === 'log' ? <LogSheet key={`log-${sheet.type}`} type={sheet.type} initial={sheet.payload} onClose={close} /> : null}
    </BottomSheet>
  );
}
