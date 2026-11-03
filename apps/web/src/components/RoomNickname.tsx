import { nicknameProblem, ROOM_CODE_DIGITS, ROOM_NICKNAME, tidyNickname } from '@almanac/shared';
import { DoorClosed } from 'lucide-react';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { Button, INPUT, Spinner } from './ui';

const KEY = 'almanac:room-nickname';

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

/**
 * A guest joining a room says what to call them there (they have no name of their own yet): the host and the others
 * see it, a class's teacher above all. Remembered in this tab for the next room.
 */
export function RoomNickname({
  code,
  busy,
  error,
  wrongCode = false,
  onJoin,
}: {
  code: string;
  busy: boolean;
  error: string | null;
  /** No room has this code: it can be corrected here, the name kept (the 31 October review, UX-11). */
  wrongCode?: boolean;
  onJoin: (nickname: string, code?: string) => void;
}) {
  const [name, setName] = useState(remembered);
  const [typed, setTyped] = useState(code);
  const codeId = useId();
  const codeField = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (wrongCode) codeField.current?.select();
  }, [wrongCode]);
  const [problem, setProblem] = useState<string | null>(null);
  const id = useId();
  // Its one field takes the focus: it comes in place of the button that led here (Enter then went nowhere).
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => field.current?.focus(), []);

  function submit(e: FormEvent) {
    e.preventDefault();
    const issue = nicknameProblem(name);
    setProblem(issue);
    if (issue) return;
    const clean = tidyNickname(name);
    try {
      sessionStorage.setItem(KEY, clean);
    } catch {
      /* not remembered: asked again next time */
    }
    onJoin(clean, wrongCode && typed.length === ROOM_CODE_DIGITS ? typed : undefined);
  }

  const message = problem ?? (wrongCode ? null : error);
  return (
    <form onSubmit={submit} className="space-y-4">
      {wrongCode ? (
        <div>
          <label htmlFor={codeId} className="mb-1.5 block text-xs font-semibold tracking-wide text-fg-2 uppercase">
            Код на стаята
          </label>
          <input
            ref={codeField}
            id={codeId}
            value={typed}
            onChange={(e) => setTyped(e.target.value.replace(/\D/g, '').slice(0, ROOM_CODE_DIGITS))}
            inputMode="numeric"
            autoComplete="off"
            aria-invalid={typed === code}
            aria-describedby={`${codeId}-error`}
            className={`${INPUT} font-mono text-lg tracking-[0.3em]`}
          />
          <p id={`${codeId}-error`} className="mt-2 text-sm text-rose-300">
            Няма стая с код {code} — провери го: {ROOM_CODE_DIGITS} цифри, както са на дъската.
          </p>
        </div>
      ) : (
        <p className="text-fg-2">
          Влизаш в стая <b className="font-mono tracking-widest text-fg">{code}</b>. Как да те виждат там?
        </p>
      )}
      <div>
        <label htmlFor={id} className="mb-1.5 block text-xs font-semibold tracking-wide text-fg-2 uppercase">
          Име в стаята
        </label>
        <input
          ref={field}
          id={id}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={ROOM_NICKNAME.max}
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
