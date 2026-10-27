import { requireOptionalNativeModule } from 'expo';

type KindredDownloads = {
  isAvailable: boolean;
  /** Copies a local file (file:// uri) into the public Downloads folder; returns its final name. */
  saveToDownloads(sourceUri: string, name: string, mimeType: string): Promise<string>;
};

/** Android only (and not in Expo Go); null elsewhere. */
const native = requireOptionalNativeModule<KindredDownloads>('KindredDownloads');
export const downloads = native?.isAvailable ? native : null;
