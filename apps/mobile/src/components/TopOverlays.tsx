import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Invites } from './Invites';
import { Toasts } from './Toasts';

/** Over every screen, under the phone's status bar: a friend's invitation, then the toasts. Taps go through the gaps. */
export function TopOverlays({ signedIn }: { signedIn: boolean }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        top: insets.top + 8,
        left: insets.left + 12,
        right: insets.right + 12,
        alignItems: 'center',
        gap: 8,
      }}
    >
      {signedIn && <Invites />}
      <Toasts />
    </View>
  );
}
