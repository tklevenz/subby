import React from 'react';
import { View, Text, TouchableOpacity, Modal, Animated, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useLogStore } from '../store/useLogStore';
import { X, Minus, Plus, Baby } from 'lucide-react-native';

const BOTTLE_PRESETS = [60, 90, 120, 150, 180];
const BREAST_DURATION_PRESETS = [3, 5, 7, 10, 15]; // minutes

type FeedMethod = 'bottle' | 'breast_left' | 'breast_right' | 'breast_both';

export default function FeedModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const addLog = useLogStore((s) => s.addLog);
  const slideY = React.useRef(new Animated.Value(600)).current;

  const [method, setMethod] = React.useState<FeedMethod>('bottle');
  const [amountMl, setAmountMl] = React.useState(120);
  const [durationMin, setDurationMin] = React.useState(5);

  // Reset form state whenever the modal opens
  React.useEffect(() => {
    if (visible) {
      setMethod('bottle');
      setAmountMl(120);
      setDurationMin(5);
      slideY.setValue(600);
      Animated.spring(slideY, {
        toValue: 0,
        useNativeDriver: true,
        damping: 18,
        stiffness: 200,
      }).start();
    }
  }, [visible, slideY]);

  const handleDismiss = () => {
    Animated.timing(slideY, { toValue: 600, duration: 250, useNativeDriver: true }).start(() =>
      onClose(),
    );
  };

  const handleSave = async (amount: number | undefined, duration: number | undefined) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await addLog({
      type: 'feed',
      method,
      amountMl: amount,
      durationSeconds: duration !== undefined ? duration * 60 : undefined,
    });
    handleDismiss();
  };

  const handlePill = (val: number) => {
    Haptics.selectionAsync();
    setAmountMl(val);
  };

  const handleDurationPill = (val: number) => {
    Haptics.selectionAsync();
    setDurationMin(val);
  };

  return (
    <Modal transparent animationType="none" visible={visible} statusBarTranslucent>
      <View className="flex-1 justify-end">
        {/* Backdrop */}
        <TouchableOpacity
          activeOpacity={1}
          onPress={handleDismiss}
          className="absolute inset-0 bg-black/60"
        />

        {/* Sheet */}
        <Animated.View
          style={[{ transform: [{ translateY: slideY }] }, { backgroundColor: '#0f172a' }, { borderTopWidth: 1 }, { borderTopColor: 'rgba(51, 65, 85, 0.5)' }, { borderTopLeftRadius: 16 }, { borderTopRightRadius: 16 }]}
          className="shadow-lg"
        >
          {/* Drag handle */}
          <View className="items-center pt-3 pb-1">
            <View className="w-10 h-1.5 bg-slate-600 rounded-full" />
          </View>

          {/* Header */}
          <View className="flex-row items-center justify-between px-5 pb-3">
            <View className="flex-row items-center">
              <Baby color="#67e8f9" size={20} />
              <Text className="text-lg font-bold text-white ml-2">Log Feed</Text>
            </View>
            <TouchableOpacity onPress={handleDismiss}>
              <X color="#94a3b8" size={22} />
            </TouchableOpacity>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="px-5 pb-3">
            {(['bottle', 'breast_left', 'breast_right', 'breast_both'] as FeedMethod[]).map((m) => (
              <TouchableOpacity
                key={m}
                onPress={() => {
                  Haptics.selectionAsync();
                  setMethod(m);
                }}
                className={`mr-2 px-3 py-1.5 rounded-full border ${
                  method === m
                    ? 'bg-cyan-500/30 border-cyan-400/60'
                    : 'bg-slate-800 border-slate-700'
                }`}
              >
                <Text
                  className={
                    method === m ? 'text-cyan-200 text-sm font-medium' : 'text-slate-400 text-sm'
                  }
                >
                  {m === 'bottle'
                    ? 'Bottle'
                    : m === 'breast_left'
                      ? 'Left'
                      : m === 'breast_right'
                        ? 'Right'
                        : 'Both'}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Bottle mode */}
          {method === 'bottle' && (
            <View className="px-5 pb-4">
              <Text className="text-xs text-slate-400 font-medium mb-2">Amount (ml)</Text>
              <View className="flex-row flex-wrap gap-2">
                {BOTTLE_PRESETS.map((v) => (
                  <TouchableOpacity
                    key={v}
                    onPress={() => handlePill(v)}
                    className={`px-4 py-2 rounded-full border ${
                      amountMl === v
                        ? 'bg-cyan-500/30 border-cyan-400/60'
                        : 'bg-slate-800 border-slate-700'
                    }`}
                  >
                    <Text
                      className={
                        amountMl === v ? 'text-cyan-200 font-medium' : 'text-slate-400'
                      }
                    >
                      {v}ml
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Stepper */}
              <View className="flex-row items-center justify-center mt-3 gap-4">
                <TouchableOpacity
                  onPress={() => handlePill(Math.max(10, amountMl - 10))}
                  className="w-10 h-10 rounded-full bg-slate-800 border border-slate-700 items-center justify-center"
                >
                  <Minus color="#94a3b8" size={18} />
                </TouchableOpacity>
                <Text className="text-lg font-bold text-white w-16 text-center">
                  {amountMl}ml
                </Text>
                <TouchableOpacity
                  onPress={() => handlePill(amountMl + 10)}
                  className="w-10 h-10 rounded-full bg-slate-800 border border-slate-700 items-center justify-center"
                >
                  <Plus color="#94a3b8" size={18} />
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                onPress={() => handleSave(amountMl, undefined)}
                className="mt-4 bg-cyan-600 rounded-xl py-3.5 items-center"
              >
                <Text className="text-white font-semibold text-base">
                  Log {amountMl}ml Bottle
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Breast mode */}
          {method !== 'bottle' && (
            <View className="px-5 pb-4">
              <Text className="text-xs text-slate-400 font-medium mb-2">Duration (minutes)</Text>
              <View className="flex-row flex-wrap gap-2">
                {BREAST_DURATION_PRESETS.map((v) => (
                  <TouchableOpacity
                    key={v}
                    onPress={() => handleDurationPill(v)}
                    className={`px-4 py-2 rounded-full border ${
                      durationMin === v
                        ? 'bg-violet-500/30 border-violet-400/60'
                        : 'bg-slate-800 border-slate-700'
                    }`}
                  >
                    <Text
                      className={
                        durationMin === v ? 'text-violet-200 font-medium' : 'text-slate-400'
                      }
                    >
                      {v}m
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Stepper */}
              <View className="flex-row items-center justify-center mt-3 gap-4">
                <TouchableOpacity
                  onPress={() => handleDurationPill(Math.max(1, durationMin - 1))}
                  className="w-10 h-10 rounded-full bg-slate-800 border border-slate-700 items-center justify-center"
                >
                  <Minus color="#94a3b8" size={18} />
                </TouchableOpacity>
                <Text className="text-lg font-bold text-white w-16 text-center">
                  {durationMin}m
                </Text>
                <TouchableOpacity
                  onPress={() => handleDurationPill(durationMin + 1)}
                  className="w-10 h-10 rounded-full bg-slate-800 border border-slate-700 items-center justify-center"
                >
                  <Plus color="#94a3b8" size={18} />
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                onPress={() => handleSave(undefined, durationMin)}
                className="mt-4 bg-violet-600 rounded-xl py-3.5 items-center"
              >
                <Text className="text-white font-semibold text-base">
                  Log {durationMin}m Feed
                </Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={{ paddingBottom: insets.bottom + 8 }} />
        </Animated.View>
      </View>
    </Modal>
  );
}
