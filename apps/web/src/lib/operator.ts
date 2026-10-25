import { api } from '@quiz/client';
import type { OperatorInfo } from '@quiz/shared';
import { useEffect, useState } from 'react';

let loaded: OperatorInfo | null = inPage();
let loading: Promise<OperatorInfo> | null = null;

/** The server puts the details in the page it sends (the development server doesn't: there they're fetched). */
function inPage(): OperatorInfo | null {
  if (typeof document === 'undefined') return null;
  try {
    return JSON.parse(document.getElementById('operator')?.textContent ?? 'null');
  } catch {
    return null;
  }
}

/** For the server's own render of the pages (paint.tsx). */
export function setOperator(info: OperatorInfo) {
  loaded = info;
}

/** Who runs this site (from the server's configuration), from the page or fetched once per visit. Null until then. */
export function useOperator(): OperatorInfo | null {
  const [info, setInfo] = useState(loaded);
  useEffect(() => {
    if (loaded) return;
    loading ??= api.operator();
    loading.then(
      (result) => {
        loaded = result;
        setInfo(result);
      },
      () => {
        loading = null; // try again on the next page that asks
      },
    );
  }, []);
  return info;
}
