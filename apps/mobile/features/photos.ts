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
