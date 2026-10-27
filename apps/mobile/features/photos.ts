import * as ImagePicker from 'expo-image-picker';
import { Directory, File, Paths } from 'expo-file-system';

const photosDir = () => new Directory(Paths.document, 'photos');

/** Copy a picked image into the app's document dir so it outlives the picker cache. */
export async function persistPhoto(uri: string): Promise<string> {
  const dir = photosDir();
  dir.create({ idempotent: true, intermediates: true });
  const ext = uri.split('.').pop()?.split('?')[0] || 'jpg';
  const dest = new File(dir, `${Date.now()}.${ext}`);
  await new File(uri).copy(dest);
  return dest.uri;
}

/**
 * Let the user take or choose a photo and keep a copy in the app. `square` crops for avatars.
 * Returns null when cancelled or permission is denied.
 */
export async function pickPhoto(source: 'camera' | 'library', square = false): Promise<string | null> {
  const opts: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    quality: 0.7,
    ...(square ? { allowsEditing: true, aspect: [1, 1] as [number, number] } : {}),
  };
  if (source === 'camera' && !(await ImagePicker.requestCameraPermissionsAsync()).granted) return null;
  const res = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  return !res.canceled && res.assets[0] ? persistPhoto(res.assets[0].uri) : null;
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
  if (!uri || !uri.startsWith(photosDir().uri)) return;
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
