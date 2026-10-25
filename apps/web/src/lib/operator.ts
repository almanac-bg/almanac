import { api } from '@quiz/client';
import type { OperatorInfo } from '@quiz/shared';
import { useEffect, useState } from 'react';

let loaded: OperatorInfo | null = null;
let loading: Promise<OperatorInfo> | null = null;

/** Who runs this site (from the server's configuration), fetched once per visit. Null until it arrives. */
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
