import { api, errorMessage, toast } from '@quiz/client';
import type { QuestionDraft } from '@quiz/shared';
import { Check } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { DraftEditor } from '../questions/DraftEditor';
import { cleanDraft, hasErrors, toDraft, validateDraft } from '../questions/draft';
import { Button, Modal } from '../ui';

/**
 * A player's question already in the game, corrected by a moderator (`questionId` null: closed). The change is in
 * play at once, and logged with what it said before.
 */
export function EditQuestionModal({
  questionId,
  draft,
  onClose,
  onSaved,
}: {
  questionId: string | null;
  draft: QuestionDraft | null;
  onClose: () => void;
  onSaved: (draft: QuestionDraft) => void;
}) {
  return (
    <Modal open={!!questionId && !!draft} onClose={onClose} title="Поправи въпроса" className="max-w-2xl">
      {questionId && draft && (
        <EditForm key={questionId} questionId={questionId} original={draft} onClose={onClose} onSaved={onSaved} />
      )}
    </Modal>
  );
}

function EditForm({
  questionId,
  original,
  onClose,
  onSaved,
}: {
  questionId: string;
  original: QuestionDraft;
  onClose: () => void;
  onSaved: (draft: QuestionDraft) => void;
}) {
  const [draft, setDraft] = useState(() => toDraft(original));
  const [busy, setBusy] = useState(false);
  const errors = useMemo(() => validateDraft(draft), [draft]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (hasErrors(errors)) return;
    setBusy(true);
    try {
      const clean = cleanDraft(draft);
      await api.editCommunityQuestion(questionId, clean);
      toast({ kind: 'success', title: 'Въпросът е поправен и вече се играе така.' });
      onSaved(clean);
      onClose();
    } catch (err) {
      toast({ kind: 'error', title: errorMessage(err, 'Промените не се запазиха.') });
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-6">
      <DraftEditor draft={draft} onChange={setDraft} errors={errors} compact />
      <div className="flex justify-end">
        <Button type="submit" loading={busy} disabled={hasErrors(errors)}>
          <Check className="size-4" /> Запази
        </Button>
      </div>
    </form>
  );
}
