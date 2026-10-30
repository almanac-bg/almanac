import { DoorClosed } from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';
import { Button, INPUT, Spinner } from './ui';

const KEY = 'quiz:room-nickname';

/**
 * The name a guest went by in a room in this tab, to offer again (a reload, the next room). Only for the tab: a school's
 * shared tablet doesn't hand one pupil's name to the next (it used to stay on the device, so it's cleared from there).
 */
function remembered(): string {
  try {
    localStorage.removeItem(KEY);
    return sessionStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

/** As the server checks it: 2–20 letters, digits, spaces and . - _ */
export function nicknameProblem(name: string): string | null {
  const n = name.replace(/\s+/gu, ' ').trim();
  if ([...n].length < 2 || [...n].length > 20) return 'Името е от 2 до 20 знака.';
  if (!/^[\p{L}\p{N} ._-]+$/u.test(n)) return 'Само букви, цифри и интервали.';
  return null;
}

/**
 * A guest joining a room says what to call them there (they have no name of their own yet): the host and the others
 * see it, a class's teacher above all. Remembered in this tab for the next room.
 */
export function RoomNickname({
  code,
  busy,
  error,
  onJoin,
}: {
  code: string;
  busy: boolean;
  error: string | null;
  onJoin: (nickname: string) => void;
}) {
  const [name, setName] = useState(remembered);
  const [problem, setProblem] = useState<string | null>(null);
  const id = useId();

  function submit(e: FormEvent) {
    e.preventDefault();
    const issue = nicknameProblem(name);
    setProblem(issue);
    if (issue) return;
    const clean = name.replace(/\s+/gu, ' ').trim();
    try {
      sessionStorage.setItem(KEY, clean);
    } catch {
      /* not remembered: asked again next time */
    }
    onJoin(clean);
  }

  const message = problem ?? error;
  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-fg-2">
        Влизаш в стая <b className="font-mono tracking-widest text-fg">{code}</b>. Как да те виждат там?
      </p>
      <div>
        <label htmlFor={id} className="mb-1.5 block text-xs font-semibold tracking-wide text-fg-2 uppercase">
          Име в стаята
        </label>
        <input
          id={id}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={20}
          autoComplete="nickname"
          placeholder="Например Мария или Иван 7Б"
          aria-invalid={!!message}
          aria-describedby={message ? `${id}-error ${id}-hint` : `${id}-hint`}
          className={INPUT}
        />
        <p id={`${id}-hint`} className="mt-2 text-xs text-fg-3">
          Първо име или прякор е достатъчно: виждат го всички в стаята.
        </p>
        {message && (
          <p id={`${id}-error`} className="mt-2 text-sm text-rose-300">
            {message}
          </p>
        )}
      </div>
      <Button type="submit" size="lg" className="w-full" loading={busy}>
        Влез в стаята
      </Button>
    </form>
  );
}

/**
 * At a locked room's door: the host sees who's waiting and lets each in or not. `refused`: why not (the host said no,
 * the room filled up or closed).
 */
export function RoomDoor({ code, refused, onLeave }: { code: string; refused: string | null; onLeave: () => void }) {
  return (
    <div className="space-y-4 text-center" role="status">
      <DoorClosed aria-hidden className="mx-auto size-10 text-fuchsia-300" />
      {refused ? (
        <>
          <h1 className="t-section">Не влезе в стаята</h1>
          <p className="text-fg-2">{refused}</p>
        </>
      ) : (
        <>
          <h1 className="t-section">Чакаш домакина</h1>
          <p className="text-fg-2">
            Стая <b className="font-mono tracking-widest text-fg">{code}</b> е заключена. Домакинът вижда, че чакаш, и
            решава дали да те пусне.
          </p>
          <Spinner className="mx-auto block size-6 text-fg-3" />
        </>
      )}
      <Button variant={refused ? 'primary' : 'ghost'} className="w-full" onClick={onLeave}>
        {refused ? 'Към началото' : 'Откажи се'}
      </Button>
    </div>
  );
}
