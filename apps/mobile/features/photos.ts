import { t } from '@subby/shared/i18n';
import { Alert, Linking } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as Sharing from 'expo-sharing';
import { Directory, File, Paths } from 'expo-file-system';
import { downloads } from '../modules/subby-downloads';

const photosDir = () => new Directory(Paths.document, 'photos');

/** Copy a picked image into the app's document dir so it outlives the picker cache. */
export async function persistPhoto(uri: string): Promise<string> {
  const dir = photosDir();
  dir.create({ idempotent: true, intermediates: true });
  // Only a plain extension (a content:// URI may have none, or a path where one would be).
  const last = uri.split('?')[0]!.split('/').pop() ?? '';
  const ext = /\.([a-z0-9]{1,5})$/i.exec(last)?.[1]?.toLowerCase() ?? 'jpg';
  const dest = new File(dir, `${Date.now()}.${ext}`);
  await new File(uri).copy(dest);
  return dest.uri;
}

/** Longest edge kept: plenty for a phone screen, and keeps photo sync (and the hosted allowance) small. */
const MAX_EDGE = 2048;
const MAX_AVATAR_EDGE = 512;

/**
 * Let the user take or choose a photo and keep a shrunk copy in the app. `square` crops for avatars.
 * Returns null when cancelled or permission is denied.
 */
/**
 * Asks for the camera if the phone still can. Denied for good, it offers the system settings instead (choosing
 * from the library needs no permission). A denial just now stays quiet.
 */
async function cameraAllowed(): Promise<boolean> {
  const current = await ImagePicker.getCameraPermissionsAsync();
  if (current.granted) return true;
  if (current.canAskAgain) return (await ImagePicker.requestCameraPermissionsAsync()).granted;
  Alert.alert(t('photo.cameraOff'), t('photo.cameraOffText'), [
    { text: t('common.cancel'), style: 'cancel' },
    { text: t('common.openSettings'), onPress: () => void Linking.openSettings() },
  ]);
  return false;
}

export async function pickPhoto(source: 'camera' | 'library', square = false): Promise<string | null> {
  const opts: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    // Full quality here: the photo is compressed once, when it's shrunk.
    quality: 1,
    ...(square ? { allowsEditing: true, aspect: [1, 1] as [number, number] } : {}),
  };
  if (source === 'camera' && !(await cameraAllowed())) return null;
  const res = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  const asset = !res.canceled ? res.assets[0] : undefined;
  if (!asset) return null;
  const shrunk = await shrinkPhoto(asset, square ? MAX_AVATAR_EDGE : MAX_EDGE);
  try {
    return await persistPhoto(shrunk);
  } finally {
    // The shrunk file is a temporary one in the cache.
    if (shrunk !== asset.uri) {
      try {
        new File(shrunk).delete();
      } catch {}
    }
  }
}

/**
 * Scales a photo down to `maxEdge` on its longest side and re-encodes it as JPEG. Re-encoding also drops the
 * metadata (location, camera), which has no place in a baby log. Falls back to the original if it can't.
 */
async function shrinkPhoto(asset: { uri: string; width: number; height: number }, maxEdge: number): Promise<string> {
  const context = ImageManipulator.manipulate(asset.uri);
  try {
    if (Math.max(asset.width, asset.height) > maxEdge) context.resize(asset.width >= asset.height ? { width: maxEdge } : { height: maxEdge });
    const image = await context.renderAsync();
    try {
      return (await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 })).uri;
    } finally {
      image.release();
    }
  } catch (e) {
    console.warn("Couldn't shrink the photo, keeping the original", e); // i18n-ignore
    return asset.uri;
  } finally {
    context.release();
  }
}

const imageType = (uri: string) => (/\.png$/i.test(uri) ? 'image/png' : 'image/jpeg');

/** Opens the share sheet for a photo (iOS's has "Save Image"). */
export const sharePhoto = (uri: string) => Sharing.shareAsync(uri, { mimeType: imageType(uri), dialogTitle: t('photo.shareTitle') });

/** Whether `savePhoto` can save straight to the phone (Android's Downloads folder). */
export const canSavePhoto = downloads !== null;

/** Saves a copy to the public Downloads folder (Android); returns the saved name. */
export async function savePhoto(uri: string): Promise<string> {
  if (!downloads) throw new Error(t('photo.notAvailable'));
  const ext = /\.png$/i.test(uri) ? 'png' : 'jpg';
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return downloads.saveToDownloads(uri, `${t('photo.fileName', { day })}.${ext}`, imageType(uri));
}

/** A photo's size in bytes; null when the file is gone. */
export function photoSize(uri: string): number | null {
  const file = new File(uri);
  return file.exists ? file.size : null;
}

/** A photo's bytes (for encrypting and uploading it); null when the file is gone. */
export async function readPhotoBytes(uri: string): Promise<Uint8Array | null> {
  const file = new File(uri);
  return file.exists ? file.bytes() : null;
}

/** Saves a downloaded photo into the app's photos dir and returns its uri. */
export function savePhotoBytes(name: string, data: Uint8Array): string {
  const dir = photosDir();
  dir.create({ idempotent: true, intermediates: true });
  const file = new File(dir, name);
  if (file.exists) file.delete();
  file.create();
  file.write(data);
  return file.uri;
}

/** Delete a photo we own (inside the app's photos dir); anything else is left alone. */
export function deletePhoto(uri: string | null | undefined) {
  // Only our own photos folder (with its trailing slash, so "photos-other/" doesn't match), and no "..".
  const dir = photosDir().uri;
  if (!uri || !uri.startsWith(dir.endsWith('/') ? dir : `${dir}/`) || uri.includes('..')) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // A missing file shouldn't block deleting the data that referenced it.
  }
}

/** Delete every photo this app stored (used when a phone replaces its data with a family's). */
export function deleteAllPhotos() {
  try {
    const dir = photosDir();
    if (dir.exists) dir.delete();
  } catch {
    // Leftover files are harmless; the rows that referenced them are gone.
  }
}
