import { View } from 'react-native';
import { Button } from './Button';
import { T } from './Text';

/** What didn't load and why, said as it appears, with „Опитай пак“ (the web's LoadError). */
export function LoadError({ title, error, onRetry }: { title: string; error: string; onRetry: () => void }) {
  return (
    <View style={{ gap: 10 }}>
      <T tone="bad" role="alert" accessibilityLiveRegion="polite">
        {title}: {error}
      </T>
      <Button title="Опитай пак" variant="secondary" onPress={onRetry} />
    </View>
  );
}
