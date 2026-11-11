import { getLocale, t } from '@subby/shared/i18n';
import { useEffect } from 'react';
import { Alert, AppState } from 'react-native';
import { router } from 'expo-router';
import { useChildStore } from '../../store/useChildStore';
import { useLogStore } from '../../store/useLogStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { pendingCount, requestSync } from './engine';
import { closeLive, openLive } from './live';
import { useSyncStore } from './state';
import { setUpBackgroundSync, stopBackgroundSync } from './background';
import { serverLabel } from './api';

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
      void pendingCount().then((pending) => useSyncStore.setState({ pending }));
      requestSync(0);
      void openLive(() => requestSync(300));
      setUpBackgroundSync().catch((e: unknown) => console.warn('Background sync setup failed', e)); // i18n-ignore
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
        const joined = s.newDevices.map((id) => names[id] ?? t('sync.newPhone.unnamed')).join(t('list.join'));
        // It may open the sentence ("a new phone can now…"): capitalized, in every language.
        const list = joined.charAt(0).toLocaleUpperCase(getLocale()) + joined.slice(1);
        useSyncStore.setState({ newDevices: [] });
        Alert.alert(t('sync.newPhone.title'), t('sync.newPhone.body', { phones: list }), [
          { text: t('common.ok') },
          { text: t('sync.newPhone.review'), onPress: () => router.push('/sync') },
        ]);
      }),
    );
    // Another phone moved the family and this one followed: say so once.
    unsubs.push(
      useSyncStore.subscribe((s) => {
        if (s.phase !== 'idle' || !s.movedTo) return;
        const to = serverLabel(s.movedTo);
        useSyncStore.setState({ movedTo: null });
        Alert.alert(t('sync.moved.title'), t('sync.moved.body', { server: to }));
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
