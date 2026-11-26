import { t } from '@subby/shared/i18n';
import React, { useState } from 'react';
import { View, Text, Pressable, Modal } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { AngleDown, AngleRight, Check, Plus } from './icons';
import { formatAge } from '@subby/shared';
import { useChildStore } from '../store/useChildStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useActiveChild } from '../store/useActiveChild';
import ChildAvatar from './ChildAvatar';
import { colors } from '../theme/colors';

/** Header showing the active child: the avatar opens their profile; the name switches child or adds one. */
export default function ChildSwitcher() {
  const children = useChildStore((s) => s.children);
  const setSetting = useSettingsStore((s) => s.set);
  const active = useActiveChild();
  const [open, setOpen] = useState(false);
  const reduced = useReducedMotion();
  const age = active ? formatAge(active.birthDate, Date.now()) : '';

  const choose = (id: string) => {
    void Haptics.selectionAsync();
    void setSetting('activeChildId', id);
    setOpen(false);
  };

  return (
    <>
      <View className="flex-row items-center pr-3">
        {active ? (
          <Pressable
            onPress={() => router.push(`/child/${active.id}`)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('switcher.profileOf', { name: active.name })}
          >
            <ChildAvatar child={active} size={40} />
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => setOpen(true)}
          hitSlop={8}
          className="ml-3 flex-1 min-w-0"
          accessibilityRole="button"
          accessibilityLabel={active ? t('switcher.currentA11y', { name: active.name, age }) : t('switcher.switch')}
          accessibilityHint={t('switcher.switch')}
        >
          <View className="flex-row items-center">
            <Text className="text-xl font-bold text-ink shrink" numberOfLines={1}>
              {active?.name ?? 'Subby'}
            </Text>
            <AngleDown color={colors.inkFaint} size={16} style={{ marginLeft: 4 }} />
          </View>
          {active ? (
            <Text className="text-[13px] text-ink-muted" numberOfLines={1}>
              {age}
            </Text>
          ) : null}
        </Pressable>
      </View>

      <Modal transparent visible={open} animationType={reduced ? 'none' : 'fade'} onRequestClose={() => setOpen(false)}>
        <View onAccessibilityEscape={() => setOpen(false)} className="flex-1 justify-center px-8">
          <Pressable
            onPress={() => setOpen(false)}
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
            className="absolute inset-0 bg-scrim/60"
          />
          <View className="bg-surface rounded-2xl border border-line-strong overflow-hidden">
            {children.map((c) => (
              <View key={c.id} className="flex-row items-center border-b border-line">
                <Pressable
                  onPress={() => choose(c.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: c.id === active?.id }}
                  className="flex-1 flex-row items-center pl-4 py-3"
                >
                  <ChildAvatar child={c} size={36} />
                  <View className="flex-1 ml-3">
                    <Text className="text-ink text-base">{c.name}</Text>
                    <Text className="text-ink-faint text-xs">{formatAge(c.birthDate, Date.now())}</Text>
                  </View>
                  {c.id === active?.id ? <Check color={colors.violetStrong} size={18} /> : null}
                </Pressable>
                {/* Separate target so switching stays a single tap. */}
                <Pressable
                  onPress={() => {
                    setOpen(false);
                    router.push(`/child/${c.id}`);
                  }}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={t('switcher.profileOf', { name: c.name })}
                  className="flex-row items-center px-4 py-3"
                >
                  <Text className="text-ink-muted text-xs mr-0.5">{t('switcher.profile')}</Text>
                  <AngleRight color={colors.inkFaint} size={14} />
                </Pressable>
              </View>
            ))}
            <Pressable
              onPress={() => {
                setOpen(false);
                router.push('/child/new');
              }}
              accessibilityRole="button"
              className="flex-row items-center px-4 py-3.5"
            >
              <Plus color={colors.inkMuted} size={18} />
              <Text className="flex-1 text-ink-soft text-base ml-2">{t('switcher.add')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}
