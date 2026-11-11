import { formatDate, t } from '@subby/shared/i18n';
import React, { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { AngleLeft, AngleRight, Baby, CakeCandles, Camera, Flag, RulerVertical } from '../../../components/icons';
import {
  childStory,
  formatAgeLong,
  formatLength,
  formatPercentile,
  formatWeight,
  growthPercentile,
  growthPoints,
  type Child,
  type GrowthMeasure,
  type LogEntry,
  type StoryItem,
} from '@subby/shared';
import { avatarColors } from '../../../components/ChildAvatar';
import GrowthChart from '../../../components/charts/GrowthChart';
import PhotoMenu from '../../../components/PhotoMenu';
import { Button, Segmented, SectionLabel, Hint } from '../../../components/ui';
import { HAS_FOODS, fetchLogs } from '../../../store/queries';
import { useActiveChild } from '../../../store/useActiveChild';
import { useChildStore } from '../../../store/useChildStore';
import { useLogStore } from '../../../store/useLogStore';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { colors } from '../../../theme/colors';
import { ScreenScroll } from '../../../components/ScreenScroll';

const MEASURES = [
  { value: 'weightKg', get label() { return t('growth.weight'); } },
  { value: 'lengthCm', get label() { return t('growth.length'); } },
  { value: 'headCm', get label() { return t('growth.head'); } },
] as const;
const STORY_PAGE = 12;

const fmtDate = (ms: number, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) =>
  formatDate(ms, opts);
const isoToMs = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
};

/** A child's own page: photo cover, growth chart and their story of firsts. */
export default function ChildProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const child = useChildStore((s) => s.children.find((c) => c.id === id));
  if (!child) return <View className="flex-1 bg-ground" />;
  return <Profile child={child} />;
}

function Profile({ child }: { child: Child }) {
  const units = useSettingsStore((s) => s.units);
  const isActive = useActiveChild()?.id === child.id;
  const revision = useLogStore((s) => s.revision);
  const [menu, setMenu] = useState(false);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  // Once the cover has scrolled away, a strip keeps the page from running under the status bar.
  const [pastCover, setPastCover] = useState(false);
  const coverEnd = coverHeight(width) - insets.top;
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [shown, setShown] = useState(STORY_PAGE);

  // Read straight from the database: this child may not be the active one.
  useEffect(() => {
    let alive = true;
    void Promise.all([
      fetchLogs(child.id, { types: ['growth', 'milestone'] }),
      fetchLogs(child.id, { types: ['feed'], where: HAS_FOODS }),
    ]).then(([rows, solids]) => {
      if (alive) setLogs([...rows, ...solids]);
    });
    return () => {
      alive = false;
    };
  }, [child.id, revision]);

  const story = useMemo(() => childStory(logs, child, units), [logs, child, units]);

  return (
    <View className="flex-1 bg-ground">
    <ScreenScroll
      className="flex-1"
      contentContainerStyle={{ paddingBottom: 40 }}
      scrollEventThrottle={32}
      onScroll={(e) => setPastCover(e.nativeEvent.contentOffset.y > coverEnd)}
    >
      <Cover child={child} isActive={isActive} onPhoto={() => setMenu(true)} />
      <PhotoMenu
        visible={menu}
        hasPhoto={child.photoUri !== null}
        onClose={() => setMenu(false)}
        onChange={(photoUri) => useChildStore.getState().updateChild(child.id, { photoUri })}
      />

      <View className="px-4">
        {!isActive ? (
          <Button label={t('profile.switchTo', { name: child.name })} variant="ghost" onPress={() => useSettingsStore.getState().set('activeChildId', child.id)} />
        ) : null}

        <Growth child={child} logs={logs} isActive={isActive} />

        <SectionLabel className="mt-6 mb-3">{t('profile.story', { name: child.name })}</SectionLabel>
        {story.slice(0, shown).map((item, i) => (
          <StoryRow key={item.id} item={item} child={child} last={i === Math.min(shown, story.length) - 1} />
        ))}
        {story.length > shown ? (
          <Button label={t('profile.showMore')} variant="ghost" onPress={() => setShown((n) => n + STORY_PAGE)} />
        ) : null}
        {story.length === 1 ? (
          <Text className="text-ink-faint text-sm mt-1 ml-10">{t('profile.storyEmpty')}</Text>
        ) : null}
      </View>
    </ScreenScroll>
    {pastCover ? <View className="absolute top-0 left-0 right-0 bg-ground" style={{ height: insets.top }} /> : null}
    </View>
  );
}

const coverHeight = (width: number) => Math.round(Math.min(width, 420) * 0.92);

function Cover({ child, isActive, onPhoto }: { child: Child; isActive: boolean; onPhoto: () => void }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [failed, setFailed] = useState<string | null>(null);
  const { bg, fg } = avatarColors(child.id);
  const showPhoto = child.photoUri && failed !== child.photoUri;
  const height = coverHeight(width);
  // The name sits on the photo now; a soft shadow keeps it readable on light photos.
  const textOnPhoto = { textShadowColor: colors.ground, textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 8 };

  return (
    <View style={{ height, backgroundColor: bg }} className="overflow-hidden">
      {showPhoto ? (
        <Image source={{ uri: child.photoUri! }} style={{ width: '100%', height: '100%' }} resizeMode="cover" onError={() => setFailed(child.photoUri)} />
      ) : (
        <Pressable onPress={onPhoto} className="flex-1 items-center justify-center">
          <Text style={{ color: fg, fontSize: 120, fontWeight: '700', opacity: 0.5 }}>{child.name.trim().charAt(0).toUpperCase() || '?'}</Text>
          <View className="flex-row items-center mt-2 px-3.5 py-2 rounded-full bg-ground/50">
            <Camera color={colors.ink} size={16} />
            <Text className="text-ink text-sm font-medium ml-2">{t('profile.addPhoto')}</Text>
          </View>
        </Pressable>
      )}

      <View style={{ top: insets.top + 8 }} className="absolute left-4 right-4 flex-row justify-between">
        <Pressable onPress={() => router.back()} accessibilityLabel={t('common.back')} hitSlop={8} className="w-10 h-10 rounded-full bg-ground/55 items-center justify-center">
          <AngleLeft color={colors.ink} size={22} />
        </Pressable>
        <View className="flex-row gap-2">
          {showPhoto ? (
            <Pressable onPress={onPhoto} accessibilityLabel={t('childForm.changePhoto')} hitSlop={8} className="w-10 h-10 rounded-full bg-ground/55 items-center justify-center">
              <Camera color={colors.ink} size={18} />
            </Pressable>
          ) : null}
          <Pressable onPress={() => router.push(`/child/${child.id}/edit`)} hitSlop={8} className="h-10 px-4 rounded-full bg-ground/55 items-center justify-center">
            <Text className="text-ink text-[15px] font-medium">{t('profile.edit')}</Text>
          </Pressable>
        </View>
      </View>

      {/* Fades the bottom of the photo into the page; a flat translucent band let busy photos streak through behind the text. */}
      <Svg style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }} width="100%" height={120}>
        <Defs>
          <LinearGradient id="coverFade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.ground} stopOpacity={0} />
            <Stop offset="0.75" stopColor={colors.ground} stopOpacity={0.3} />
            <Stop offset="1" stopColor={colors.ground} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#coverFade)" />
      </Svg>
      <View className="absolute left-0 right-0 bottom-0 px-5 pt-4 pb-4 flex-row items-end justify-between">
        <View className="flex-1">
          <Text style={textOnPhoto} className="text-ink text-[34px] leading-[38px] font-bold" numberOfLines={1}>{child.name}</Text>
          <Text style={textOnPhoto} className="text-violet-pale text-[15px] mt-0.5">
            {t('profile.ageBorn', { age: formatAgeLong(child.birthDate, Date.now()), date: fmtDate(isoToMs(child.birthDate), { day: 'numeric', month: 'short' }) })}
          </Text>
        </View>
        {isActive ? (
          <View className="px-2.5 py-1.5 rounded-full bg-violet/30 border border-violet-strong/60 ml-3">
            <Text className="text-violet-faint text-xs font-semibold">{t('profile.active')}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function Growth({ child, logs, isActive }: { child: Child; logs: LogEntry[]; isActive: boolean }) {
  const units = useSettingsStore((s) => s.units);
  const [measure, setMeasure] = useState<GrowthMeasure>('weightKg');
  const points = useMemo(() => growthPoints(logs, child, measure), [logs, child, measure]);
  const sex = child.sex === 'male' || child.sex === 'female' ? child.sex : null;
  const last = points.at(-1);
  const pct = last ? growthPercentile(measure, child.sex, last.months, last.value) : null;
  const format = (v: number) => (measure === 'weightKg' ? formatWeight(v * 1000, units) : formatLength(v, units));

  const openGrowth = async () => {
    if (!isActive) await useSettingsStore.getState().set('activeChildId', child.id);
    router.push('/growth');
  };

  return (
    <>
      <View className="flex-row items-center justify-between mt-6 mb-2 mr-1">
        <SectionLabel className="">{t('profile.growth')}</SectionLabel>
        <Pressable onPress={openGrowth} hitSlop={8} className="flex-row items-center">
          <Text className="text-violet-soft text-[13px] mr-1">{t('profile.allCharts')}</Text>
          <AngleRight color={colors.violetSoft} size={10} />
        </Pressable>
      </View>
      <View className="bg-surface border border-line rounded-2xl p-3.5">
        <Segmented options={MEASURES} value={measure} onChange={setMeasure} />
        {last ? (
          <>
            <View className="flex-row items-baseline justify-between mt-3">
              <Text className="text-ink text-[28px] leading-[34px] font-bold">{format(last.value)}</Text>
              {pct !== null ? <Text className="text-violet-soft text-sm font-semibold">{t('percentile.long', { value: formatPercentile(pct) })}</Text> : null}
            </View>
            <View className="mt-2">
              <GrowthChart measure={measure} sex={sex} points={points} units={units} height={180} />
            </View>
            <Text className="text-ink-muted text-xs mt-2">
              {t(sex === 'female' ? 'profile.lastMeasuredGirls' : sex ? 'profile.lastMeasuredBoys' : 'profile.lastMeasured', { date: fmtDate(last.at) })}
            </Text>
          </>
        ) : (
          <Text className="text-ink-faint text-sm mt-3">{t('profile.noMeasurements')}</Text>
        )}
      </View>
      {!sex ? (
        <Pressable onPress={() => router.push(`/child/${child.id}/edit`)}>
          <Hint className="ml-1">{t('profile.setSex')}</Hint>
        </Pressable>
      ) : null}
    </>
  );
}

const STORY_STYLE: Record<StoryItem['kind'], { box: string; Icon: typeof Flag; color: () => string }> = {
  milestone: { box: 'bg-orange/10 border-orange/40', Icon: Flag, color: () => colors.orangeSoft },
  growth: { box: 'bg-green/10 border-green/40', Icon: RulerVertical, color: () => colors.greenSoft },
  solids: { box: 'bg-cyan/10 border-cyan/40', Icon: Baby, color: () => colors.cyanSoft },
  birth: { box: 'bg-violet/10 border-violet/40', Icon: CakeCandles, color: () => colors.violetSoft },
};

function StoryRow({ item, child, last }: { item: StoryItem; child: Child; last: boolean }) {
  const s = STORY_STYLE[item.kind];
  const when =
    item.kind === 'birth'
      ? fmtDate(item.at, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
      : t('profile.storyWhen', { date: fmtDate(item.at), age: formatAgeLong(child.birthDate, item.at) });
  return (
    <Pressable disabled={!item.logId} onPress={() => item.logId && router.push(`/entry/${item.logId}`)} className="flex-row" style={{ minHeight: 62 }}>
      <View className="w-7 items-center">
        <View className={`w-7 h-7 rounded-full border items-center justify-center ${s.box}`}>
          <s.Icon color={s.color()} size={14} />
        </View>
        {!last ? <View className="flex-1 w-0.5 bg-line" /> : null}
      </View>
      <View className="flex-1 ml-3 pt-1 pb-3">
        <Text className="text-ink text-[15px] font-medium">{item.title}</Text>
        <Text className="text-ink-muted text-xs mt-0.5">{when}</Text>
      </View>
      {item.logId ? (
        <View className="pt-1.5">
          <AngleRight color={colors.inkGhost} size={14} />
        </View>
      ) : null}
    </Pressable>
  );
}
