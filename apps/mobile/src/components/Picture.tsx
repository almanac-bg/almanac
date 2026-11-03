import { fromCommons, licenseName } from '@almanac/client';
import type { ImageCredit, QuestionImage } from '@almanac/shared';
import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { View } from 'react-native';
import { pictureUri } from '@/lib/images';
import { radius, useColors } from '@/theme';
import { T } from '@/ui';

/**
 * A question's picture (the web's QuestionPicture), at most `maxHeight` tall, its box kept while it loads. Whose it is
 * shows once the answer is out (`credit`; a painter's name would give a painting's answer away), over the picture's
 * foot: the licence (to its deed), then the author (to the source) — the attribution its licence asks for.
 */
export function Picture({
  image,
  credit,
  maxHeight = 260,
}: {
  image: QuestionImage;
  credit?: ImageCredit | null;
  maxHeight?: number;
}) {
  const colors = useColors();
  const ratio = image.w / image.h;
  return (
    <View
      style={{
        width: '100%',
        maxWidth: maxHeight * ratio,
        alignSelf: 'center',
        aspectRatio: ratio,
        borderRadius: radius.md,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.glass,
      }}
    >
      <Image
        source={{ uri: pictureUri(image) }}
        accessibilityLabel={image.alt}
        contentFit="contain"
        style={{ width: '100%', height: '100%' }}
      />
      {credit && <Credit credit={credit} />}
    </View>
  );
}

function Credit({ credit }: { credit: ImageCredit }) {
  const open = (url: string | null | undefined) => (url ? () => void WebBrowser.openBrowserAsync(url) : undefined);
  const licence = licenseName(credit.license);
  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        paddingHorizontal: 10,
        paddingTop: 16,
        paddingBottom: 5,
        experimental_backgroundImage: 'linear-gradient(to top, rgba(0,0,0,0.8), rgba(0,0,0,0.6) 60%, transparent)',
      }}
    >
      {/* White on dark whatever the theme, as the picture's own frame is. */}
      <T
        variant="caption"
        align="right"
        numberOfLines={2}
        style={{ fontSize: 11, lineHeight: 15, color: 'rgba(255,255,255,0.85)' }}
      >
        <T
          variant="caption"
          accessibilityRole={credit.licenseUrl ? 'link' : undefined}
          onPress={open(credit.licenseUrl)}
          style={{
            fontSize: 11,
            lineHeight: 15,
            color: 'rgba(255,255,255,0.85)',
            textDecorationLine: credit.licenseUrl ? 'underline' : 'none',
          }}
        >
          {licence}
        </T>
        {' · '}
        <T
          variant="caption"
          accessibilityRole={credit.sourceUrl ? 'link' : undefined}
          onPress={open(credit.sourceUrl)}
          style={{
            fontSize: 11,
            lineHeight: 15,
            color: 'rgba(255,255,255,0.85)',
            textDecorationLine: credit.sourceUrl ? 'underline' : 'none',
          }}
        >
          {credit.credit}
        </T>
        {fromCommons(credit) ? ' · чрез Wikimedia Commons' : ''}
      </T>
    </View>
  );
}
