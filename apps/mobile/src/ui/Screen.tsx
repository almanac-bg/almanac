import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { gutter, useColors } from '@/theme';

/**
 * A page: the theme's background to the edges, its content inside the phone's safe area, scrolling when it doesn't fit
 * (a large text size, a small phone, the keyboard up) — never cut off.
 */
export function Screen({ children, centered = false }: { children: ReactNode; centered?: boolean }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.ink }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
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
