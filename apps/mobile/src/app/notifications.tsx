import { api, setState, timeAgo } from '@almanac/client';
import type { AppNotification } from '@almanac/shared';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { openPath } from '@/lib/links';
import { useLoad } from '@/lib/load';
import { fonts, radius, useColors } from '@/theme';
import { Card, LoadError, Screen, T } from '@/ui';

/**
 * Известия (the web's NotificationsPage): a link of yours played, a question approved, a rematch someone wanted. Opening
 * the list marks it seen; the ones that were new keep their mark while it's open.
 */
export default function Notifications() {
  const { data, error, loading, reload } = useLoad(() => api.notifications());
  const items = data?.notifications ?? null;
  const unseen = !!items?.some((n) => !n.read);

  useEffect(() => {
    if (!unseen) return;
    api.readNotifications().then(
      () => setState((s) => ({ me: s.me && { ...s.me, unreadNotifications: 0 } })),
      () => {}, // still unseen: the count stays, and the next visit marks them
    );
  }, [unseen]);

  return (
    <Screen refreshing={loading && !!data} onRefresh={reload}>
      <T tone="fg2">Кой изигра линковете ти, кой те покани или поиска реванш, какво стана с въпросите ти.</T>
      {!items && error ? (
        <LoadError title="Известията не се заредиха" error={error} onRetry={reload} />
      ) : !items ? (
        <ActivityIndicator style={{ marginTop: 40 }} />
      ) : items.length === 0 ? (
        <Card style={{ alignItems: 'center' }}>
          <T style={{ fontSize: 34, lineHeight: 42 }}>🔔</T>
          <T variant="title" align="center">
            Нищо ново
          </T>
          <T tone="fg2" align="center">
            Тук ще видиш, когато някой изиграе твой линк, когато въпросът ти бъде одобрен или някой поиска реванш.
          </T>
        </Card>
      ) : (
        <Card style={{ gap: 0, paddingVertical: 4 }}>
          {items.map((n, i) => (
            <Item key={n.id} note={n} first={i === 0} />
          ))}
        </Card>
      )}
    </Screen>
  );
}

function Item({ note, first }: { note: AppNotification; first: boolean }) {
  const colors = useColors();
  const when = timeAgo(note.createdAt);
  const body = (
    <>
      <T style={{ fontSize: 24, lineHeight: 30 }}>{note.icon}</T>
      <View style={{ flex: 1, gap: 2 }}>
        <T
          variant="small"
          tone={note.read ? 'fg2' : 'fg'}
          style={note.read ? undefined : { fontFamily: fonts.semibold }}
        >
          {note.text}
        </T>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <T variant="caption" tone="fg3">
            {when}
          </T>
          {!note.read && (
            <View style={{ paddingHorizontal: 8, borderRadius: 999, backgroundColor: `${colors.violet}33` }}>
              <T variant="caption" tone="link" style={{ fontFamily: fonts.semibold }}>
                ново
              </T>
            </View>
          )}
        </View>
      </View>
      {note.link && <ChevronRight color={colors.fg3} size={18} />}
    </>
  );
  const row = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 14,
    paddingVertical: 12,
    borderTopWidth: first ? 0 : 1,
    borderTopColor: colors.line,
    borderRadius: radius.sm,
  };
  const said = `${note.read ? '' : 'Ново: '}${note.text}, ${when}`;
  const link = note.link;
  return link ? (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={said}
      onPress={() => openPath(link)}
      style={({ pressed }) => [row, pressed && { opacity: 0.7 }]}
    >
      {body}
    </Pressable>
  ) : (
    <View accessible accessibilityLabel={said} style={row}>
      {body}
    </View>
  );
}
