import { HeaderShownContext } from 'expo-router/react-navigation';
import { BottomTabBarHeightContext } from 'expo-router/tabs';
import { type ReactNode, useContext } from 'react';
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { gutter, useColors } from '@/theme';

/** A page's column: as wide as a phone's, centred on a tablet. */
export const COLUMN: ViewStyle = { width: '100%', maxWidth: 520, alignSelf: 'center' };

/**
 * A page's padding: inside the phone's safe area, with a margin. Under a header (a page pushed in a tab) or above the
 * tab bar, those already keep it clear of the phone's edge, so that side has no inset of its own.
 */
export function usePagePadding(): ViewStyle {
  const insets = useSafeAreaInsets();
  const underHeader = useContext(HeaderShownContext);
  const aboveTabs = useContext(BottomTabBarHeightContext) !== undefined;
  return {
    paddingTop: underHeader ? 16 : insets.top + 24,
    paddingBottom: aboveTabs ? 24 : insets.bottom + 24,
    paddingLeft: insets.left + gutter,
    paddingRight: insets.right + gutter,
  };
}

/**
 * A sheet's padding (a Modal with presentationStyle "pageSheet"). On iOS the sheet is a card that starts below the
 * status bar; on Android it's the whole screen, edge to edge, so its top keeps clear of the status bar itself (without
 * it, a sheet's title ran into the clock on Android 16). The bottom clears the home indicator or the gesture bar.
 */
export function useSheetPadding(): ViewStyle {
  const insets = useSafeAreaInsets();
  return {
    paddingTop: (Platform.OS === 'android' ? insets.top : 0) + gutter,
    paddingBottom: insets.bottom + 24,
    paddingLeft: insets.left + gutter,
    paddingRight: insets.right + gutter,
  };
}

/**
 * A page: the theme's background to the edges, its content in the page's padding, scrolling when it doesn't fit (a
 * large text size, a small phone, the keyboard up) — never cut off. A long list is a FlatList with the same padding
 * (usePagePadding) instead.
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
  const padding = usePagePadding();
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
          contentContainerStyle={{ flexGrow: 1, justifyContent: centered ? 'center' : 'flex-start', ...padding }}
        >
          <View style={[COLUMN, { gap: 16 }]}>{children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
