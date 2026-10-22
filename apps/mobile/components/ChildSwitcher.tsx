import React, { useState } from 'react';
import { View, Text, Pressable, Modal } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { AngleDown, AngleRight, Check, Plus } from './icons';
import { formatAge } from '@kindred-log/shared';
import { useCanAddChild, useChildStore } from '../store/useChildStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useActiveChild } from '../store/useActiveChild';
import ChildAvatar from './ChildAvatar';
import { colors } from '../theme/colors';

/** Header showing the active child; tap to switch child, open a profile or add a child. */
export default function ChildSwitcher() {
  const children = useChildStore((s) => s.children);
  const setSetting = useSettingsStore((s) => s.set);
  const active = useActiveChild();
  const canAddChild = useCanAddChild();
  const [open, setOpen] = useState(false);

  const choose = (id: string) => {
    Haptics.selectionAsync();
    setSetting('activeChildId', id);
    setOpen(false);
  };

  return (
    <>
      <Pressable onPress={() => setOpen(true)} className="flex-row items-center mb-4" hitSlop={8}>
        {active ? <ChildAvatar child={active} size={34} /> : null}
        <Text className="text-xl font-bold text-ink ml-2.5">{active?.name ?? 'Kindred Log'}</Text>
        {active ? (
          <Text className="text-sm text-ink-muted ml-2">{formatAge(active.birthDate, Date.now())}</Text>
        ) : null}
        <AngleDown color={colors.inkFaint} size={18} style={{ marginLeft: 4 }} />
      </Pressable>

      <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable className="flex-1 bg-scrim/60 justify-center px-8" onPress={() => setOpen(false)}>
          <View className="bg-surface rounded-2xl border border-line-strong overflow-hidden">
            {children.map((c) => (
              <View key={c.id} className="flex-row items-center border-b border-line">
                <Pressable onPress={() => choose(c.id)} className="flex-1 flex-row items-center pl-4 py-3">
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
                  className="flex-row items-center px-4 py-3"
                >
                  <Text className="text-ink-muted text-xs mr-0.5">Profile</Text>
                  <AngleRight color={colors.inkFaint} size={14} />
                </Pressable>
              </View>
            ))}
            <Pressable
              onPress={() => {
                setOpen(false);
                router.push('/child/new');
              }}
              className="flex-row items-center px-4 py-3.5"
            >
              <Plus color={colors.inkMuted} size={18} />
              <Text className="flex-1 text-ink-soft text-base ml-2">Add child</Text>
              {!canAddChild ? <Text className="text-violet-soft text-xs">Premium</Text> : null}
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}
