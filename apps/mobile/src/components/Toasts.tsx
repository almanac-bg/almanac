import { dismissToast, type Toast, useStore } from '@almanac/client';
import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Pressable, View } from 'react-native';
import { fonts, radius, useColors } from '@/theme';
import { T } from '@/ui';

/** At most this many at once: the newest, the older ones dropped from view (they time out on their own). */
const SHOWN = 3;

/**
 * The client's toasts (the web's Toasts): an achievement, a notice from the server, an answer that didn't arrive, the
 * connection lost. They come in at the top, are said to a screen reader as they come, go after their time, and a tap
 * sends one away sooner.
 */
export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <>
      {toasts.slice(-SHOWN).map((t) => (
        <ToastCard key={t.id} toast={t} />
      ))}
    </>
  );
}

function ToastCard({ toast }: { toast: Toast }) {
  const colors = useColors();
  const enter = useRef(new Animated.Value(0)).current;
  const said = `${toast.title}${toast.body ? `. ${toast.body}` : ''}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, as it comes; its id doesn't change
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(said);
    let running: Animated.CompositeAnimation | null = null;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (reduce) return enter.setValue(1);
      running = Animated.spring(enter, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 6 });
      running.start();
    });
    const gone = setTimeout(() => dismissToast(toast.id), toast.ttlMs);
    return () => {
      clearTimeout(gone);
      running?.stop();
    };
  }, []);
  const accent = toast.kind === 'error' ? colors.bad : toast.kind === 'success' ? colors.good : colors.violet;
  return (
    <Animated.View
      style={{
        width: '100%',
        maxWidth: 480,
        opacity: enter,
        transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }) }],
      }}
    >
      <Pressable
        accessibilityRole="alert"
        accessibilityLabel={said}
        accessibilityHint="Скрива известието"
        onPress={() => dismissToast(toast.id)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingVertical: 12,
          paddingHorizontal: 14,
          borderRadius: radius.lg,
          borderCurve: 'continuous',
          borderWidth: 1,
          borderColor: `${accent}66`,
          backgroundColor: colors.ink2,
          shadowColor: '#000',
          shadowOpacity: 0.25,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 6 },
          elevation: 8,
        }}
      >
        {toast.icon ? (
          <T style={{ fontSize: 24, lineHeight: 30 }}>{toast.icon}</T>
        ) : (
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: accent }} />
        )}
        <View style={{ flex: 1, gap: 2 }}>
          <T variant="small" style={{ fontFamily: fonts.semibold }}>
            {toast.title}
          </T>
          {toast.body ? (
            <T variant="caption" tone="fg2">
              {toast.body}
            </T>
          ) : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}
