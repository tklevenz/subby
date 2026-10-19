export type MilestoneCategory = 'social' | 'language' | 'cognitive' | 'movement';

export type MilestoneDef = {
  key: string;
  label: string;
  category: MilestoneCategory;
  /** Typical age (months) by which most children reach it (CDC "Learn the Signs" checkpoints). */
  months: number;
};

export const MILESTONES: readonly MilestoneDef[] = [
  { key: 'first_smile', label: 'Smiles at people', category: 'social', months: 2 },
  { key: 'coos', label: 'Coos and makes sounds', category: 'language', months: 2 },
  { key: 'holds_head_tummy', label: 'Holds head up during tummy time', category: 'movement', months: 2 },
  { key: 'tracks_objects', label: 'Follows moving things with eyes', category: 'cognitive', months: 2 },
  { key: 'laughs', label: 'Laughs', category: 'social', months: 4 },
  { key: 'holds_head_steady', label: 'Holds head steady unsupported', category: 'movement', months: 4 },
  { key: 'brings_hands_mouth', label: 'Brings hands to mouth', category: 'movement', months: 4 },
  { key: 'pushes_up_elbows', label: 'Pushes up onto elbows on tummy', category: 'movement', months: 4 },
  { key: 'rolls_tummy_back', label: 'Rolls from tummy to back', category: 'movement', months: 6 },
  { key: 'babbles', label: 'Takes turns making sounds', category: 'language', months: 6 },
  { key: 'reaches_toy', label: 'Reaches for a toy', category: 'cognitive', months: 6 },
  { key: 'sits_with_support', label: 'Leans on hands to sit', category: 'movement', months: 6 },
  { key: 'first_tooth', label: 'First tooth', category: 'movement', months: 6 },
  { key: 'sits_alone', label: 'Sits without support', category: 'movement', months: 9 },
  { key: 'mama_baba', label: 'Says "mamamama", "babababa"', category: 'language', months: 9 },
  { key: 'object_permanence', label: 'Looks for objects dropped out of sight', category: 'cognitive', months: 9 },
  { key: 'crawls', label: 'Crawls', category: 'movement', months: 9 },
  { key: 'waves_bye', label: 'Waves bye-bye', category: 'language', months: 12 },
  { key: 'pincer_grasp', label: 'Picks things up with thumb and finger', category: 'movement', months: 12 },
  { key: 'pulls_to_stand', label: 'Pulls up to stand', category: 'movement', months: 12 },
  { key: 'cruises', label: 'Walks holding on to furniture', category: 'movement', months: 12 },
  { key: 'first_word', label: 'First word', category: 'language', months: 12 },
  { key: 'first_steps', label: 'First steps', category: 'movement', months: 15 },
  { key: 'points', label: 'Points to ask for something', category: 'language', months: 15 },
  { key: 'walks_alone', label: 'Walks without holding on', category: 'movement', months: 18 },
  { key: 'feeds_self_spoon', label: 'Tries to use a spoon', category: 'movement', months: 18 },
  { key: 'two_word_phrases', label: 'Says two words together', category: 'language', months: 24 },
  { key: 'kicks_ball', label: 'Kicks a ball', category: 'movement', months: 24 },
  { key: 'runs', label: 'Runs', category: 'movement', months: 24 },
];

export const milestoneLabel = (key: string) => MILESTONES.find((m) => m.key === key)?.label ?? key;
