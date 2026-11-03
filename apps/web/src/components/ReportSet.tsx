import { errorMessage, toast } from '@almanac/client';
import type { ReportReason } from '@almanac/shared';
import { useState } from 'react';
import { ReportReasons } from './ReportReasons';
import { Button, Modal } from './ui';

/**
 * A report about a set — its questions, its pictures: a reason and a few words, sent by `send` (from the set's shared
 * page, or from the review of a room's match that played it).
 */
export function ReportSet({
  open,
  onClose,
  send,
}: {
  open: boolean;
  onClose: () => void;
  send: (reason: ReportReason, details: string) => Promise<unknown>;
}) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);

  async function report() {
    if (!reason) return;
    setBusy(true);
    try {
      await send(reason, details);
      onClose();
      setReason(null);
      setDetails('');
      toast({ kind: 'success', title: 'Благодарим!', body: 'Модератор ще го прегледа, а ти ще научиш какво решихме.' });
    } catch (err) {
      toast({ kind: 'error', title: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Сигнал за набор">
      <ReportReasons kind="set" value={reason} onChange={setReason} />
      <textarea
        value={details}
        maxLength={400}
        rows={3}
        aria-label="Подробности"
        placeholder="Подробности (по желание): кой въпрос, коя снимка"
        onChange={(e) => setDetails(e.target.value)}
        className="field mt-4 w-full rounded-2xl p-3 text-sm"
      />
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Отказ
        </Button>
        <Button onClick={() => void report()} disabled={!reason} loading={busy}>
          Изпрати
        </Button>
      </div>
    </Modal>
  );
}
