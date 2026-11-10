import { t, type MessageKey } from '../i18n';

export type MilestoneCategory = 'social' | 'language' | 'cognitive' | 'movement';

export type MilestoneDef = {
  key: string;
  label: string;
  category: MilestoneCategory;
  /** Typical age (months) by which most children reach it (CDC "Learn the Signs" checkpoints). */
  months: number;
};

/** The label follows the app's language (read when shown, not kept). */
const m = (key: string, category: MilestoneCategory, months: number): MilestoneDef => ({
  key,
  category,
  months,
  get label() {
    return t(`milestone.${key}` as MessageKey);
  },
});

export const MILESTONES: readonly MilestoneDef[] = [
  m('first_smile', 'social', 2),
  m('coos', 'language', 2),
  m('holds_head_tummy', 'movement', 2),
  m('tracks_objects', 'cognitive', 2),
  m('laughs', 'social', 4),
  m('holds_head_steady', 'movement', 4),
  m('brings_hands_mouth', 'movement', 4),
  m('pushes_up_elbows', 'movement', 4),
  m('rolls_tummy_back', 'movement', 6),
  m('babbles', 'language', 6),
  m('reaches_toy', 'cognitive', 6),
  m('sits_with_support', 'movement', 6),
  m('first_tooth', 'movement', 6),
  m('sits_alone', 'movement', 9),
  m('mama_baba', 'language', 9),
  m('object_permanence', 'cognitive', 9),
  m('crawls', 'movement', 9),
  m('waves_bye', 'language', 12),
  m('pincer_grasp', 'movement', 12),
  m('pulls_to_stand', 'movement', 12),
  m('cruises', 'movement', 12),
  m('first_word', 'language', 12),
  m('first_steps', 'movement', 15),
  m('points', 'language', 15),
  m('walks_alone', 'movement', 18),
  m('feeds_self_spoon', 'movement', 18),
  m('two_word_phrases', 'language', 24),
  m('kicks_ball', 'movement', 24),
  m('runs', 'movement', 24),
];

export const milestoneLabel = (key: string) => MILESTONES.find((m) => m.key === key)?.label ?? key;
