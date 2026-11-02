import { useMemo } from 'react';
import { encode } from 'uqr';

/**
 * A QR code of `text`, drawn as one path of squares (each row's runs merged): dark on white whatever the theme — a
 * phone's camera reads that best — with the quiet zone of four modules round it that the standard asks for. Medium
 * error correction: a projector's glare or a smudge still reads.
 */
export function QrCode({ text, label, className }: { text: string; label: string; className?: string }) {
  const { size, d } = useMemo(() => {
    const { data } = encode(text, { ecc: 'M', border: 0 });
    const quiet = 4;
    let path = '';
    data.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (!row[x]) continue;
        let run = 1;
        while (row[x + run]) run++;
        path += `M${x + quiet} ${y + quiet}h${run}v1h-${run}z`;
        x += run - 1;
      }
    });
    return { size: data.length + 2 * quiet, d: path };
  }, [text]);
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className={className}
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={d} fill="#16131f" />
    </svg>
  );
}
