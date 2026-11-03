import type { ReactNode } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { radius, useColors } from '@/theme';
import { T } from './Text';

/** A group of settings with its heading. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  const colors = useColors();
  return (
    <View
      style={{
        gap: 12,
        padding: 16,
        borderRadius: radius.xl,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.glass,
      }}
    >
      <T variant="h2" role="heading">
        {title}
      </T>
      {children}
    </View>
  );
}

/** An on/off setting: the phone's own switch, its label and what it means read with it. */
export function Toggle({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
}) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <T variant="bodyStrong">{label}</T>
        {hint ? (
          <T variant="small" tone="fg2">
            {hint}
          </T>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        accessibilityLabel={label}
        accessibilityHint={hint}
        trackColor={{ true: colors.violet, false: colors.lineStrong }}
      />
    </View>
  );
}

/** One of a few: a row of choices, the chosen one marked (and said). `disabled`: shown, not changed (not yours to). */
export function Choices<Id extends string>({
  options,
  value,
  onChange,
  label,
  disabled = false,
}: {
  options: readonly { id: Id; label: string }[];
  value: Id;
  onChange: (id: Id) => void;
  label: string;
  disabled?: boolean;
}) {
  const colors = useColors();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}
    >
      {options.map((o) => {
        const on = o.id === value;
        return (
          <Pressable
            key={o.id}
            onPress={() => onChange(o.id)}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityState={{ checked: on, disabled }}
            style={{
              opacity: disabled && !on ? 0.55 : 1,
              minHeight: 44,
              paddingHorizontal: 14,
              justifyContent: 'center',
              borderRadius: 999,
              borderWidth: 1,
              borderColor: on ? colors.violet : colors.line,
              backgroundColor: on ? `${colors.violet}22` : colors.ink2,
            }}
          >
            <T variant="small" tone={on ? 'fg' : 'fg2'}>
              {o.label}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}
