import * as WebBrowser from 'expo-web-browser';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import notices from '@/settings/licenses.json';
import { radius, useColors } from '@/theme';
import { Button, Card, Screen, T } from '@/ui';
import pkg from '../../package.json';

/** A version's tag in the repository, as release-please makes them: the code this build was made from. */
const tagged = (file = '') => `${notices.source}/${file ? `blob/v${pkg.version}/${file}` : `tree/v${pkg.version}`}`;

/**
 * Лицензи (the site's /licenses.txt): the game's own licence and its source — the exact version this app runs, as the
 * AGPL asks — then the fonts and every package inside the app, each with its licence's text, as theirs ask to travel
 * with the code (scripts/licenses.mjs writes the list from the app's bundle).
 */
export default function Licenses() {
  const open = (url: string) => void WebBrowser.openBrowserAsync(url);
  return (
    <Screen>
      <Card>
        <T variant="title" role="heading">
          АЛМАНАХ {pkg.version}
        </T>
        <T variant="small" tone="fg2">
          Свободен софтуер: кодът на играта е под GNU AGPL-3.0 или по-нова версия — може да се чете, променя и споделя
          при същите условия. Допълнително разрешение по чл. 7 от лиценза позволява разпространението през магазините за
          приложения.
        </T>
        <Button title={`Изходният код на версия ${pkg.version}`} variant="secondary" onPress={() => open(tagged())} />
        <Button title="Лицензът (GNU AGPL-3.0)" variant="ghost" onPress={() => open(tagged('LICENSE'))} />
        <Button
          title="Разрешението за магазините"
          variant="ghost"
          onPress={() => open(tagged('APP-STORE-EXCEPTION.md'))}
        />
      </Card>

      <T variant="h2" role="heading">
        Шрифтове
      </T>
      <Card style={{ gap: 0, paddingVertical: 4 }}>
        {notices.fonts.map((f, i) => (
          <Notice key={f.name} name={f.name} licence="SIL Open Font License 1.1" text={f.text} first={i === 0} />
        ))}
      </Card>

      <T variant="h2" role="heading">
        Библиотеки ({notices.packages.length})
      </T>
      <T variant="small" tone="fg2">
        Кодът на други автори в приложението, всеки под своя лиценз. Докосни, за да видиш текста.
      </T>
      <Card style={{ gap: 0, paddingVertical: 4 }}>
        {notices.packages.map((p, i) => (
          <Notice key={p.name} name={p.name} licence={p.licence} text={p.text} first={i === 0} />
        ))}
      </Card>
    </Screen>
  );
}

/** One work and its licence's name; tapped, the licence's text under it (and folded again). */
function Notice({ name, licence, text, first }: { name: string; licence: string; text: string; first: boolean }) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ borderTopWidth: first ? 0 : 1, borderTopColor: colors.line }}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityLabel={`${name}, ${licence}`}
        accessibilityHint={open ? 'Скрива текста на лиценза' : 'Показва текста на лиценза'}
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => ({
          minHeight: 48,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingVertical: 8,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <View style={{ flex: 1 }}>
          <T variant="bodyStrong">{name}</T>
          <T variant="caption" tone="fg3">
            {licence}
          </T>
        </View>
        <ChevronDown
          size={20}
          color={colors.fg3}
          style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
      </Pressable>
      {open && (
        <T
          variant="caption"
          tone="fg2"
          selectable
          style={{
            marginBottom: 12,
            padding: 12,
            borderRadius: radius.sm,
            backgroundColor: colors.glass,
          }}
        >
          {text}
        </T>
      )}
    </View>
  );
}
