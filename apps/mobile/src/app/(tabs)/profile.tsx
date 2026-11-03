import { useStore } from '@almanac/client';
import { ProfileView } from '@/profile/ProfileView';

/** Профил: your own profile, as others see it, with the way to Settings. */
export default function Profile() {
  const username = useStore((s) => s.me?.username);
  // Signed out a moment before the router takes this screen away.
  if (!username) return null;
  return <ProfileView username={username} />;
}
