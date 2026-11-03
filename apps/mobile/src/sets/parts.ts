import { actions, toast } from '@almanac/client';
import { type SetImage, setPictureUrl } from '@almanac/shared';
import { router } from 'expo-router';
import { API_URL } from '@/lib/client';

/** A set in a private room at once (the host plays too; „Само водя“ is the site's). */
export async function playInRoom(setId: number) {
  const res = await actions.createRoom({ set: setId });
  if (res.ok) router.push('/room');
  else toast({ kind: 'error', title: res.error });
}

/** Where a set's picture shows from: the address the server signed for it, only ever one of ours. */
export const setPictureUri = (image: SetImage) =>
  `${API_URL}${image.url?.startsWith('/api/sets/images/') ? image.url : setPictureUrl(image.id)}`;
