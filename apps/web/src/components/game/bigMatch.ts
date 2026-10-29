/** More players than this (a class in a room) and the standings show the top and you, not everyone. */
export const BIG_MATCH = 12;

/**
 * The first `top` of a ranked list and you, if you're further down: what a big match's standings show. `gap`: the
 * index in `shown` before which places were left out (null: none were).
 */
export function topAndYou<T extends { id: string }>(
  list: T[],
  youId: string,
  top: number,
): { shown: T[]; gap: number | null } {
  if (list.length <= top + 1) return { shown: list, gap: null };
  const mine = list.findIndex((x) => x.id === youId);
  if (mine < top) return { shown: list.slice(0, top), gap: null };
  return { shown: [...list.slice(0, top), list[mine]], gap: mine > top ? top : null };
}
