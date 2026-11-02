import { api, errorMessage, saveFile, toast } from '@quiz/client';
import { Download, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from './ui';

/**
 * Under a banned account's sign-in refusal (or a password reset's): the data stays the player's while the ban lasts,
 * as the privacy policy promises (§8) — download it, or delete the account. `token` comes with the refusal and opens
 * only these two, for a few minutes; deleting asks for the password just given (`password`).
 */
export function BannedData({ token, password, onDeleted }: { token: string; password: string; onDeleted: () => void }) {
  const [busy, setBusy] = useState<'export' | 'delete' | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function download() {
    setBusy('export');
    try {
      saveFile(await api.bannedExport(token), 'almanac-data.json');
    } catch (err) {
      toast({ kind: 'error', title: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  }

  async function erase() {
    setBusy('delete');
    try {
      await api.bannedDelete(token, password);
      toast({ kind: 'info', title: 'Профилът е изтрит', body: 'Данните ти са изтрити от играта.' });
      onDeleted();
    } catch (err) {
      toast({ kind: 'error', title: errorMessage(err) });
      setBusy(null);
    }
  }

  return (
    <div className="rounded-xl border border-line bg-sunk/20 px-3 py-3 text-sm text-fg-2">
      <p>Докато профилът е спрян, данните ти остават твои: можеш да ги изтеглиш или да изтриеш профила.</p>
      {confirming ? (
        <div className="mt-3 space-y-2">
          <p className="font-semibold text-fg">Изтриването е завинаги: профилът, резултатите и всичко в него.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="danger" loading={busy === 'delete'} onClick={erase}>
              <Trash2 className="size-4" /> Изтрий завинаги
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Отказ
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" loading={busy === 'export'} onClick={download}>
            <Download className="size-4" /> Изтегли данните си
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(true)}>
            <Trash2 className="size-4" /> Изтрий профила
          </Button>
        </div>
      )}
    </div>
  );
}
