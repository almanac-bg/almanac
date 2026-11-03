import { useStore } from '@almanac/client';
import { Onest_400Regular } from '@expo-google-fonts/onest/400Regular';
import { Onest_500Medium } from '@expo-google-fonts/onest/500Medium';
import { Onest_600SemiBold } from '@expo-google-fonts/onest/600SemiBold';
import { Onest_700Bold } from '@expo-google-fonts/onest/700Bold';
import { Unbounded_700Bold } from '@expo-google-fonts/unbounded/700Bold';
import { Unbounded_800ExtraBold } from '@expo-google-fonts/unbounded/800ExtraBold';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TopOverlays } from '@/components/TopOverlays';
import { UpdateScreen } from '@/components/UpdateScreen';
import { QueueOverlay } from '@/home/QueueOverlay';
import { restore, useApp } from '@/lib/client';
import { useRealtime } from '@/lib/realtime';
import { useColors } from '@/theme';
import { useHeader } from '@/ui';

// The splash stays until the fonts are in and the app knows whether someone is signed in: no flash of the way in for a
// player who is.
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colors = useColors();
  const header = useHeader();
  const [fontsIn, fontError] = useFonts({
    Onest_400Regular,
    Onest_500Medium,
    Onest_600SemiBold,
    Onest_700Bold,
    Unbounded_700Bold,
    Unbounded_800ExtraBold,
  });
  const authChecked = useStore((s) => s.authChecked);
  const signedIn = useStore((s) => !!s.me);
  const updateRequired = useApp((s) => s.updateRequired);
  const ready = (fontsIn || !!fontError) && authChecked;
  useRealtime();

  useEffect(() => {
    void restore();
  }, []);
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="auto" />
        {updateRequired ? (
          <UpdateScreen />
        ) : (
          <>
            {/* Signed in, the tabs and the match; signed out, the way in. The router moves between them as the session
                comes and goes (a sign-in, a sign-out, a session the server ended). */}
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ink } }}>
              <Stack.Protected guard={signedIn}>
                <Stack.Screen name="(tabs)" />
                {/* A swipe from the edge mustn't walk out of a match: ✕ (and Android's back) ask first. */}
                <Stack.Screen name="game" options={{ gestureEnabled: false }} />
                <Stack.Screen name="settings" options={{ ...header, title: 'Настройки' }} />
                <Stack.Screen name="profile/[username]" options={header} />
                <Stack.Screen name="notifications" options={{ ...header, title: 'Известия' }} />
                <Stack.Screen name="c/[id]" options={{ ...header, title: 'Предизвикателство' }} />
                <Stack.Screen name="room" options={{ ...header, title: 'Частна стая' }} />
                <Stack.Screen name="locker" options={{ ...header, title: 'Колекция' }} />
                <Stack.Screen name="submit" options={{ ...header, title: 'Предложи въпрос' }} />
                <Stack.Screen name="sets/index" options={{ ...header, title: 'Моите въпроси' }} />
                <Stack.Screen name="sets/[id]" options={{ ...header, title: 'Набор' }} />
                <Stack.Screen name="sets/shared/[code]" options={{ ...header, title: 'Набор с въпроси' }} />
                <Stack.Screen name="groups/index" options={{ ...header, title: 'Групи' }} />
                <Stack.Screen name="groups/[id]" options={{ ...header, title: 'Група' }} />
                <Stack.Screen name="groups/join/[code]" options={{ ...header, title: 'Покана за група' }} />
                <Stack.Screen name="daily/index" options={{ ...header, title: 'Въпросите на деня' }} />
                <Stack.Screen name="daily/[code]" options={{ ...header, title: 'Въпросите на деня' }} />
                <Stack.Screen name="achievements" options={{ ...header, title: 'Постижения' }} />
                <Stack.Screen name="join/[code]" options={{ ...header, title: 'Стая' }} />
              </Stack.Protected>
              <Stack.Protected guard={!signedIn}>
                <Stack.Screen name="welcome" />
                <Stack.Screen name="sign-in" />
                <Stack.Screen name="sign-up" />
              </Stack.Protected>
            </Stack>
            {signedIn && <QueueOverlay />}
            <TopOverlays signedIn={signedIn} />
          </>
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
