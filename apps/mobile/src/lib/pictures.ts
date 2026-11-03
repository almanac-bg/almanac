import { SETS } from '@almanac/shared';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

/**
 * A picture for a question of your own, from the phone's library, made small enough for a set (the web's
 * shrinkPicture): its longer side SETS.imageSide at most, as WebP, a little smaller and less fine each try until it
 * weighs SETS.imageBytes. `null`: none picked. Throws (with what to say) when no size of it fits.
 */
export async function pickSetPicture(): Promise<Blob | null> {
  const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
  const asset = picked.canceled ? null : picked.assets[0];
  if (!asset) return null;
  for (let side: number = SETS.imageSide; side >= 400; side = Math.round(side * 0.8)) {
    const scale = Math.min(1, side / Math.max(asset.width, asset.height));
    const context = ImageManipulator.manipulate(asset.uri);
    if (scale < 1) context.resize({ width: Math.max(1, Math.round(asset.width * scale)) });
    const image = await context.renderAsync();
    for (const compress of [0.85, 0.75, 0.65, 0.55]) {
      const saved = await image.saveAsync({ format: SaveFormat.WEBP, compress });
      const file = await (await fetch(saved.uri)).blob();
      // Said as what it is: a file read back may come without its type.
      const blob = file.type ? file : new Blob([file], { type: 'image/webp' });
      if (blob.size <= SETS.imageBytes) return blob;
    }
  }
  throw new Error('Тази снимка не става — опитай с друга.');
}
