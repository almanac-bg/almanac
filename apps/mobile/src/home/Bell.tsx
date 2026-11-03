import { useStore } from '@almanac/client';
import { router } from 'expo-router';
import Bell from 'lucide-react-native/icons/bell';
import { Pressable, View } from 'react-native';
import { fonts, useColors } from '@/theme';
import { T } from '@/ui';

/** Известия, from the top of Играй (the web's bell in the bar): with how many are new. */
export function NotificationsBell() {
  const colors = useColors();
  const unread = useStore((s) => s.me?.unreadNotifications ?? 0);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={unread ? `Известия, ${unread} нови` : 'Известия'}
      onPress={() => router.push('/notifications')}
      hitSlop={8}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? colors.lineStrong : colors.glass,
        borderWidth: 1,
        borderColor: colors.line,
      })}
    >
      <Bell color={colors.fg2} size={20} />
      {unread > 0 && (
        <View
          style={{
            position: 'absolute',
            top: -2,
            right: -2,
            minWidth: 20,
            height: 20,
            paddingHorizontal: 5,
            borderRadius: 10,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.bad,
            borderWidth: 2,
            borderColor: colors.ink,
          }}
        >
          <T variant="caption" style={{ fontFamily: fonts.bold, fontSize: 11, lineHeight: 14, color: '#fff' }}>
            {unread > 99 ? '99+' : unread}
          </T>
        </View>
      )}
    </Pressable>
  );
}
