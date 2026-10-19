import React, { useState } from 'react';
import { View, Text, Pressable, Modal } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Baby, Check, ChevronDown, Plus } from 'lucide-react-native';
import { formatAge } from '@kindred-log/shared';
import { useChildStore } from '../store/useChildStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useActiveChild } from '../store/useActiveChild';

/** Header showing the active child; tap to switch or add a child. */
export default function ChildSwitcher() {
  const children = useChildStore((s) => s.children);
  const setSetting = useSettingsStore((s) => s.set);
  const active = useActiveChild();
  const [open, setOpen] = useState(false);

  const choose = (id: string) => {
    Haptics.selectionAsync();
    setSetting('activeChildId', id);
    setOpen(false);
  };

  return (
    <>
      <Pressable onPress={() => setOpen(true)} className="flex-row items-center mb-4" hitSlop={8}>
        <Baby color="#a78bfa" size={22} />
        <Text className="text-xl font-bold text-white ml-2">{active?.name ?? 'Kindred Log'}</Text>
        {active ? (
          <Text className="text-sm text-slate-400 ml-2">{formatAge(active.birthDate, Date.now())}</Text>
        ) : null}
        <ChevronDown color="#64748b" size={18} style={{ marginLeft: 4 }} />
      </Pressable>

      <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable className="flex-1 bg-black/60 justify-center px-8" onPress={() => setOpen(false)}>
          <View className="bg-slate-900 rounded-2xl border border-slate-700 overflow-hidden">
            {children.map((c) => (
              <Pressable
                key={c.id}
                onPress={() => choose(c.id)}
                className="flex-row items-center px-4 py-3.5 border-b border-slate-800"
              >
                <Text className="flex-1 text-white text-base">{c.name}</Text>
                {c.id === active?.id ? <Check color="#a78bfa" size={18} /> : null}
              </Pressable>
            ))}
            <Pressable
              onPress={() => {
                setOpen(false);
                router.push('/child/new');
              }}
              className="flex-row items-center px-4 py-3.5"
            >
              <Plus color="#94a3b8" size={18} />
              <Text className="text-slate-300 text-base ml-2">Add child</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}
