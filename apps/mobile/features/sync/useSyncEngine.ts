import { useEffect } from 'react';
import { Alert, AppState } from 'react-native';
import { router } from 'expo-router';
import { useChildStore } from '../../store/useChildStore';
import { useLogStore } from '../../store/useLogStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { closeLive, openLive, pendingCount, requestSync, useSyncStore } from './engine';
import { setUpBackgroundSync, stopBackgroundSync } from './background';
import { isOfficialServer } from './api';

/**
 * Keeps this phone in sync while the app runs: on start, on every local write (debounced), when the app
 * comes to the foreground, and on live notifications from the server while it's open.
 */
export function useSyncEngine(ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    const start = () => {
      if (!useSettingsStore.getState().sync) return;
      useSyncStore.setState((s) => (s.phase === 'off' ? { phase: 'idle' } : s));
      pendingCount().then((pending) => useSyncStore.setState({ pending }));
      requestSync(0);
      openLive();
      setUpBackgroundSync().catch((e: unknown) => console.warn('Background sync setup failed', e));
    };
    start();
    const unsubs = [
      useLogStore.subscribe((s, prev) => s.revision !== prev.revision && requestSync()),
      useChildStore.subscribe((s, prev) => s.children !== prev.children && requestSync()),
      // Set up or turned off on the Sync screen.
      useSettingsStore.subscribe((s, prev) => {
        if (!!s.sync === !!prev.sync) return;
        if (s.sync) start();
        else {
          closeLive();
          stopBackgroundSync().catch(() => {});
        }
      }),
    ];
    // A phone this one didn't add showed up: say so once, after the sync that brought its name.
    unsubs.push(
      useSyncStore.subscribe((s) => {
        if (s.phase !== 'idle' || !s.newDevices.length) return;
        const names = useSettingsStore.getState().sync?.names ?? {};
        const list = s.newDevices.map((id) => names[id] ?? 'a new phone').join(', ');
        useSyncStore.setState({ newDevices: [] });
        Alert.alert('New phone in your family', `${list} can now see and add entries. If nobody in your family added it, remove it.`, [
          { text: 'OK' },
          { text: 'Review phones', onPress: () => router.push('/sync') },
        ]);
      }),
    );
    // Another phone moved the family and this one followed: say so once.
    unsubs.push(
      useSyncStore.subscribe((s) => {
        if (s.phase !== 'idle' || !s.movedTo) return;
        const to = isOfficialServer(s.movedTo) ? 'Subby Sync' : s.movedTo.replace(/^https?:\/\//, '');
        useSyncStore.setState({ movedTo: null });
        Alert.alert('Your family moved', `Another phone moved your family to ${to}. This phone followed and syncs there now.`);
      }),
    );
    const appState = AppState.addEventListener('change', (state) => (state === 'active' ? start() : closeLive()));
    return () => {
      unsubs.forEach((u) => u());
      appState.remove();
      closeLive();
    };
  }, [ready]);
}
