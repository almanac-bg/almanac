import { Tabs } from 'expo-router';
// One icon per import: from the package's index Metro would bundle all of Lucide's (it doesn't tree-shake).
import BookOpen from 'lucide-react-native/icons/book-open';
import ChartColumn from 'lucide-react-native/icons/chart-column';
import Gamepad2 from 'lucide-react-native/icons/gamepad-2';
import User from 'lucide-react-native/icons/user';
import Users from 'lucide-react-native/icons/users';
import { fonts, useColors } from '@/theme';

/**
 * The signed-in app's sections, at the bottom where the thumb is, as the web's phone menu (NavBar) has them: Играй,
 * Знания, Класации, Приятели and Профил.
 */
export default function TabsLayout() {
  const colors = useColors();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.violet,
        tabBarInactiveTintColor: colors.fg3,
        tabBarStyle: { backgroundColor: colors.ink2, borderTopColor: colors.line },
        tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 12 },
        sceneStyle: { backgroundColor: colors.ink },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Играй', tabBarIcon: ({ color, size }) => <Gamepad2 color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="knowledge"
        options={{ title: 'Знания', tabBarIcon: ({ color, size }) => <BookOpen color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="leaderboard"
        options={{ title: 'Класации', tabBarIcon: ({ color, size }) => <ChartColumn color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="friends"
        options={{ title: 'Приятели', tabBarIcon: ({ color, size }) => <Users color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: 'Профил', tabBarIcon: ({ color, size }) => <User color={color} size={size} /> }}
      />
    </Tabs>
  );
}
