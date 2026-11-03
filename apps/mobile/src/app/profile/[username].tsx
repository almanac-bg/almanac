import { Stack, useLocalSearchParams } from 'expo-router';
import { ProfileView } from '@/profile/ProfileView';

/** Another player's profile, pushed over the tabs from wherever their name was (Класации, Приятели, a match). */
export default function PlayerProfile() {
  const { username } = useLocalSearchParams<{ username: string }>();
  return (
    <>
      <Stack.Screen options={{ title: username }} />
      <ProfileView username={username} />
    </>
  );
}
