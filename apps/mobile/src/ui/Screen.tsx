import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { gutter, useColors } from '@/theme';

/**
 * A page: the theme's background to the edges, its content inside the phone's safe area, scrolling when it doesn't fit
 * (a large text size, a small phone, the keyboard up) — never cut off.
 */
export function Screen({
  children,
  centered = false,
  refreshing,
  onRefresh,
}: {
  children: ReactNode;
  centered?: boolean;
  /** Pull to refresh, where the page loads something. */
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.ink }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          refreshControl={
            onRefresh ? (
              <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.fg3} />
            ) : undefined
          }
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: centered ? 'center' : 'flex-start',
            paddingTop: insets.top + 24,
            paddingBottom: insets.bottom + 24,
            paddingLeft: insets.left + gutter,
            paddingRight: insets.right + gutter,
          }}
        >
          <View style={{ width: '100%', maxWidth: 520, alignSelf: 'center', gap: 16 }}>{children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
