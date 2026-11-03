import { useId } from 'react';
import { TextInput, type TextInputProps, View } from 'react-native';
import { fonts, radius, useColors } from '@/theme';
import { T } from './Text';

/** A labelled text field: the label above it, said with it, and what's wrong under it. */
export function Field({ label, error, ...props }: TextInputProps & { label: string; error?: string | null }) {
  const colors = useColors();
  const id = useId();
  return (
    <View style={{ gap: 6 }}>
      <T variant="small" tone="fg2" nativeID={id}>
        {label}
      </T>
      <TextInput
        accessibilityLabel={label}
        aria-labelledby={id}
        placeholderTextColor={colors.fg3}
        {...props}
        style={{
          minHeight: 50,
          paddingHorizontal: 14,
          borderRadius: radius.md,
          borderCurve: 'continuous',
          borderWidth: 1,
          borderColor: error ? colors.bad : colors.lineStrong,
          backgroundColor: colors.ink2,
          color: colors.fg,
          fontFamily: fonts.regular,
          fontSize: 16,
        }}
      />
      {error ? (
        <T variant="small" tone="bad" accessibilityLiveRegion="polite" role="alert">
          {error}
        </T>
      ) : null}
    </View>
  );
}
