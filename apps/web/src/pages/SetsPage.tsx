import { api, errorMessage, type SetBody, timeAgo, toast, useStore } from '@quiz/client';
import { SETS, type SetQuestion } from '@quiz/shared';
import clsx from 'clsx';
import { ArrowDown, ArrowLeft, ArrowUp, Flag, Link2, Plus, Send, Trash2 } from 'lucide-react';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { GuestNudge } from '../components/ClaimAccount';
import { LETTERS, OPTION_COLORS } from '../components/game/answers';
import { LoadError } from '../components/LoadError';
import { Button, Card, EmptyState, INPUT, Modal, PageSpinner, Segmented } from '../components/ui';
import { useLoad } from '../lib/load';
import { usePageTitle } from '../lib/title';
import { NotFoundPage } from './NotFoundPage';

/** „Моите въпроси“ (/sets), one set to edit (/sets/<id>), or another host's set by its link (/sets/shared/<code>). */
export function SetsPage() {
  const { id, code } = useParams();
  const guest = useStore((s) => !!s.me?.isGuest);
  if (guest)
    return (
      <div className="mx-auto max-w-xl space-y-6">
        <h1 className="t-page">Моите въпроси</h1>
        <GuestNudge>Собствени въпроси за стаите си прави профилът: запази своя с име и парола.</GuestNudge>
      </div>
    );
  if (code !== undefined) return <SharedSet code={code} />;
  if (id === undefined) return <SetList />;
  return /^\d{1,12}$/.test(id) ? <SetEditor id={Number(id)} /> : <NotFoundPage />;
}

const shareUrl = (code: string) => `${window.location.origin}/sets/shared/${code}`;

async function copyLink(code: string) {
  try {
    await navigator.clipboard.writeText(shareUrl(code));
    toast({ kind: 'success', title: 'Линкът е копиран', body: 'Който го отвори, може да вземе копие за стаите си.' });
  } catch {
    toast({ kind: 'error', title: 'Браузърът не позволи копиране.' });
  }
}

// ─── The list ────────────────────────────────────────────────────────────────

function SetList() {
  usePageTitle('Моите въпроси');
  const navigate = useNavigate();
  const { data, error, retry } = useLoad(() => api.sets());
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const { id } = await api.createSet({ name: 'Нов набор', questions: [] });
      navigate(`/sets/${id}`);
    } catch (err) {
      toast({ kind: 'error', title: errorMessage(err) });
      setBusy(false);
    }
  }

  if (!data && error) return <LoadError title="Наборите не се заредиха" error={error} onRetry={retry} />;
  if (!data) return <PageSpinner />;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="t-page">Моите въпроси</h1>
          <p className="mt-2 max-w-xl text-fg-2 text-pretty">
            Твои въпроси за частните ти стаи — урок, рожден ден, офисът. До {SETS.maxQuestions} в набор: с избор от
            четири, вярно или невярно, или число.
          </p>
        </div>
        <Button onClick={() => void create()} loading={busy} disabled={data.sets.length >= SETS.perOwner}>
          <Plus className="size-4" /> Нов набор
        </Button>
      </header>
      {data.sets.length ? (
        <ul className="space-y-3">
          {data.sets.map((s) => (
            <li key={s.id}>
              <Link
                to={`/sets/${s.id}`}
                className="focus-ring glass flex items-center gap-4 rounded-3xl p-4 transition-colors hover:bg-white/[0.06] sm:px-5"
              >
                <span aria-hidden className="text-3xl">
                  📝
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{s.name}</span>
                  <span className="text-sm text-fg-3">
                    {s.questions} {s.questions === 1 ? 'въпрос' : 'въпроса'} · {timeAgo(s.updatedAt)}
                    {s.hidden && <span className="text-rose-300"> · скрит от модератор</span>}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Card>
          <EmptyState
            icon="📝"
            title="Още нямаш набор"
            body="Направи си един и го пусни в частна стая: в „Настройки“ → „Въпроси“."
          />
        </Card>
      )}
    </div>
  );
}

// ─── The editor ──────────────────────────────────────────────────────────────

/**
 * A question as the editor holds it: numbers as typed (a comma, a minus on its way), turned into numbers on save; `key`
 * keeps each one itself while they're moved around.
 */
type Draft = { key: number } & (
  | { kind: 'choice'; q: string; options: string[]; answer: number }
  | { kind: 'truefalse'; q: string; answer: boolean }
  | { kind: 'number'; q: string; answer: string; unit: string; tolerance: string }
);

let nextKey = 0;
const blank = (): Draft => ({ key: nextKey++, kind: 'choice', q: '', options: ['', '', '', ''], answer: 0 });

function toDraft(q: SetQuestion): Draft {
  if (q.kind !== 'number') return { ...q, key: nextKey++ };
  return {
    key: nextKey++,
    kind: 'number',
    q: q.q,
    answer: String(q.number.answer).replace('.', ','),
    unit: q.number.unit,
    tolerance: String(q.number.tolerance).replace('.', ','),
  };
}

/** What's saved, keys aside: for telling unsaved changes. */
const content = (name: string, drafts: Draft[]) => JSON.stringify([name, drafts.map(({ key: _, ...d }) => d)]);

const parseNumber = (s: string) => {
  const n = Number(s.trim().replace(/\s/g, '').replace(',', '.'));
  return s.trim() && Number.isFinite(n) ? n : null;
};

/** The set as the server takes it, or what's wrong with a number in it. */
function toBody(name: string, drafts: Draft[]): { body: SetBody } | { error: string } {
  const questions: SetQuestion[] = [];
  for (const [i, { key: _, ...d }] of drafts.entries()) {
    if (d.kind !== 'number') {
      questions.push(d);
      continue;
    }
    const answer = parseNumber(d.answer);
    const tolerance = parseNumber(d.tolerance);
    if (answer === null) return { error: `Въпрос ${i + 1}: напиши верния отговор като число.` };
    if (tolerance === null || tolerance <= 0) return { error: `Въпрос ${i + 1}: отклонението е число над нула.` };
    questions.push({ kind: 'number', q: d.q, number: { answer, unit: d.unit, tolerance } });
  }
  return { body: { name, questions } };
}

/** A sensible "how far off scores nothing": ten years for a year, a tenth of anything else. */
function defaultTolerance(answer: string): string {
  const n = parseNumber(answer);
  if (n === null) return '';
  if (Number.isInteger(n) && n >= 1000 && n <= 2100) return '10';
  return String(Math.max(1, Math.round(Math.abs(n) / 10))).replace('.', ',');
}

function SetEditor({ id }: { id: number }) {
  const navigate = useNavigate();
  const { data, error, retry } = useLoad(() => api.set(id), String(id));
  const [name, setName] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  usePageTitle(data?.name ?? 'Набор');

  useEffect(() => {
    if (!data) return;
    setName(data.name);
    setDrafts(data.questions.map(toDraft));
    setSaved(content(data.name, data.questions.map(toDraft)));
  }, [data]);
  const dirty = !!data && content(name, drafts) !== saved;

  // Unsaved work isn't lost to a closed tab without a word.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const update = (i: number, next: Draft) => setDrafts((ds) => ds.map((d, j) => (j === i ? next : d)));
  const move = (i: number, by: number) =>
    setDrafts((ds) => {
      const next = [...ds];
      [next[i], next[i + by]] = [next[i + by], next[i]];
      return next;
    });

  async function save(e?: FormEvent) {
    e?.preventDefault();
    const built = toBody(name, drafts);
    if ('error' in built) return setProblem(built.error);
    setBusy(true);
    try {
      const set = await api.saveSet(id, built.body);
      setName(set.name);
      setDrafts(set.questions.map(toDraft));
      setSaved(content(set.name, set.questions.map(toDraft)));
      setProblem(null);
      toast({ kind: 'success', title: 'Наборът е запазен' });
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    try {
      await api.deleteSet(id);
      navigate('/sets', { replace: true });
    } catch (err) {
      toast({ kind: 'error', title: errorMessage(err) });
    }
  }

  if (!data && error)
    return error.status === 404 ? (
      <NotFoundPage />
    ) : (
      <LoadError title="Наборът не се зареди" error={error} onRetry={retry} />
    );
  if (!data) return <PageSpinner />;

  return (
    <form onSubmit={save} className="mx-auto max-w-3xl space-y-6 pb-24">
      <Link
        to="/sets"
        className="focus-ring -my-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg text-sm font-semibold text-fg-3 hover:text-fg-2"
      >
        <ArrowLeft aria-hidden className="size-4" /> Моите въпроси
      </Link>
      {data.hidden && (
        <p className="rounded-2xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-100">
          Модератор скри този набор след сигнал: не може да се играе и споделя.
        </p>
      )}
      <div>
        <label htmlFor="set-name" className="mb-1.5 block text-xs font-semibold tracking-wide text-fg-2 uppercase">
          Име на набора
        </label>
        <input
          id="set-name"
          value={name}
          maxLength={SETS.name[1]}
          onChange={(e) => setName(e.target.value)}
          className={INPUT}
        />
      </div>

      <ol className="space-y-4">
        {drafts.map((d, i) => (
          <li key={d.key}>
            <QuestionCard
              index={i}
              draft={d}
              last={i === drafts.length - 1}
              onChange={(next) => update(i, next)}
              onMove={(by) => move(i, by)}
              onRemove={() => setDrafts((ds) => ds.filter((_, j) => j !== i))}
              onPropose={
                d.kind === 'choice'
                  ? () => navigate('/submit', { state: { draft: { q: d.q, options: d.options, answer: d.answer } } })
                  : null
              }
            />
          </li>
        ))}
      </ol>
      <Button
        variant="secondary"
        className="w-full"
        onClick={() => setDrafts((ds) => [...ds, blank()])}
        disabled={drafts.length >= SETS.maxQuestions}
      >
        <Plus className="size-4" /> Въпрос {drafts.length < SETS.maxQuestions ? drafts.length + 1 : ''}
      </Button>

      <div className="flex flex-wrap gap-2 border-t border-line pt-6">
        <Button variant="ghost" onClick={() => void copyLink(data.code)} disabled={data.hidden}>
          <Link2 className="size-4" /> Сподели с друг домакин
        </Button>
        <Button variant="ghost" className="text-rose-300" onClick={() => setDeleting(true)}>
          <Trash2 className="size-4" /> Изтрий набора
        </Button>
      </div>

      {/* The save stays in reach while the questions scroll by. */}
      <div className="fixed inset-x-0 bottom-[calc(4rem+1px+env(safe-area-inset-bottom))] z-30 border-t border-line bg-ink/90 px-4 py-3 backdrop-blur-xl md:bottom-0">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <p className={clsx('min-w-0 flex-1 text-sm', problem ? 'text-rose-300' : 'text-fg-3')} aria-live="polite">
            {problem ??
              (dirty ? 'Има незапазени промени.' : `${drafts.length} от ${SETS.maxQuestions} въпроса · запазено`)}
          </p>
          <Button type="submit" loading={busy} disabled={!dirty}>
            Запази
          </Button>
        </div>
      </div>

      <Modal open={deleting} onClose={() => setDeleting(false)} title="Изтриване на набора">
        <p className="text-fg-2">Наборът „{data.name}“ ще изчезне. Копията, които други са взели, остават техни.</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeleting(false)}>
            Не
          </Button>
          <Button variant="danger" onClick={() => void remove()}>
            Изтрий
          </Button>
        </div>
      </Modal>
    </form>
  );
}

function QuestionCard({
  index,
  draft: d,
  last,
  onChange,
  onMove,
  onRemove,
  onPropose,
}: {
  index: number;
  draft: Draft;
  last: boolean;
  onChange: (d: Draft) => void;
  onMove: (by: number) => void;
  onRemove: () => void;
  onPropose: (() => void) | null;
}) {
  const id = useId();
  const kind = (k: Draft['kind']) => {
    if (k === d.kind) return;
    if (k === 'choice') onChange({ key: d.key, kind: 'choice', q: d.q, options: ['', '', '', ''], answer: 0 });
    else if (k === 'truefalse') onChange({ key: d.key, kind: 'truefalse', q: d.q, answer: true });
    else onChange({ key: d.key, kind: 'number', q: d.q, answer: '', unit: '', tolerance: '' });
  };
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display font-bold">Въпрос {index + 1}</h2>
        <div className="ml-auto flex items-center gap-1">
          <IconButton label="По-нагоре" onClick={() => onMove(-1)} disabled={index === 0}>
            <ArrowUp className="size-4" />
          </IconButton>
          <IconButton label="По-надолу" onClick={() => onMove(1)} disabled={last}>
            <ArrowDown className="size-4" />
          </IconButton>
          <IconButton label={`Махни въпрос ${index + 1}`} onClick={onRemove}>
            <Trash2 className="size-4" />
          </IconButton>
        </div>
      </div>
      <div className="mt-3">
        <Segmented
          value={d.kind}
          onChange={kind}
          options={[
            { value: 'choice', label: '4 отговора' },
            { value: 'truefalse', label: 'Вярно/невярно' },
            { value: 'number', label: 'Число' },
          ]}
        />
      </div>
      <label htmlFor={`${id}-q`} className="sr-only">
        Текст на въпрос {index + 1}
      </label>
      <textarea
        id={`${id}-q`}
        value={d.q}
        rows={2}
        maxLength={SETS.question[1]}
        placeholder={d.kind === 'truefalse' ? 'Твърдение, напр. „Дунав се влива в Черно море.“' : 'Въпросът'}
        onChange={(e) => onChange({ ...d, q: e.target.value })}
        className="field mt-3 w-full resize-y rounded-2xl p-3 text-[15px]"
      />
      {d.kind === 'choice' && (
        <fieldset className="mt-3 space-y-2">
          <legend className="sr-only">Отговори; отбележи верния</legend>
          {d.options.map((o, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: four fixed slots (А–Г)
              key={i}
              className="flex items-center gap-2"
            >
              <input
                type="radio"
                name={`${id}-answer`}
                checked={d.answer === i}
                onChange={() => onChange({ ...d, answer: i })}
                aria-label={`${LETTERS[i]} е верният`}
                className="size-5 shrink-0 accent-emerald-400"
              />
              <span className="w-5 shrink-0 font-display font-bold" style={{ color: OPTION_COLORS[i] }}>
                {LETTERS[i]}
              </span>
              <input
                value={o}
                maxLength={SETS.option[1]}
                aria-label={`Отговор ${LETTERS[i]}`}
                onChange={(e) => onChange({ ...d, options: d.options.map((x, j) => (j === i ? e.target.value : x)) })}
                className={clsx(INPUT, 'h-11', d.answer === i && 'border-emerald-400/50')}
              />
            </div>
          ))}
          <p className="text-xs text-fg-3">Отбележи верния отговор. В мача отговорите се разбъркват.</p>
        </fieldset>
      )}
      {d.kind === 'truefalse' && (
        <div className="mt-3">
          <Segmented
            value={d.answer ? 'yes' : 'no'}
            onChange={(v) => onChange({ ...d, answer: v === 'yes' })}
            options={[
              { value: 'yes', label: 'Вярно е' },
              { value: 'no', label: 'Невярно е' },
            ]}
          />
        </div>
      )}
      {d.kind === 'number' && (
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <NumberField
            label="Верният отговор"
            value={d.answer}
            onChange={(answer) => onChange({ ...d, answer, tolerance: d.tolerance || defaultTolerance(answer) })}
          />
          <div>
            <label htmlFor={`${id}-unit`} className="mb-1.5 block text-xs font-semibold text-fg-2">
              Мерна единица
            </label>
            <input
              id={`${id}-unit`}
              value={d.unit}
              maxLength={SETS.unit}
              placeholder="км, г., души…"
              onChange={(e) => onChange({ ...d, unit: e.target.value })}
              className={clsx(INPUT, 'h-11')}
            />
          </div>
          <NumberField
            label="Отклонение за 0 точки"
            value={d.tolerance}
            onChange={(tolerance) => onChange({ ...d, tolerance })}
          />
          <p className="text-xs text-fg-3 sm:col-span-3">
            Точно число носи най-много точки; колкото по-далеч, толкова по-малко, а отклонение от {d.tolerance || '…'} —
            нула.
          </p>
        </div>
      )}
      {onPropose && (
        <button
          type="button"
          onClick={onPropose}
          className="focus-ring mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-lg text-sm font-semibold text-violet-300 hover:text-violet-200"
        >
          <Send aria-hidden className="size-4" /> Предложи в общата банка
        </button>
      )}
    </Card>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-semibold text-fg-2">
        {label}
      </label>
      <input
        id={id}
        value={value}
        inputMode="decimal"
        onChange={(e) => onChange(e.target.value)}
        className={clsx(INPUT, 'h-11 tabular-nums')}
      />
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="focus-ring grid size-11 place-items-center rounded-xl text-fg-3 hover:bg-white/10 hover:text-fg disabled:opacity-30"
    >
      {children}
    </button>
  );
}

// ─── A shared set ────────────────────────────────────────────────────────────

function SharedSet({ code }: { code: string }) {
  usePageTitle('Набор с въпроси');
  const navigate = useNavigate();
  const admin = useStore((s) => !!s.me?.isAdmin);
  const { data, error, retry, setData } = useLoad(() => api.sharedSet(code), code);
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [details, setDetails] = useState('');

  async function copy() {
    setBusy(true);
    try {
      const { id } = await api.copySet(code);
      toast({ kind: 'success', title: 'Копието е твое', body: 'Пусни го в стая от „Настройки“ → „Въпроси“.' });
      navigate(`/sets/${id}`);
    } catch (err) {
      toast({ kind: 'error', title: errorMessage(err) });
      setBusy(false);
    }
  }

  async function report() {
    try {
      await api.reportSet(code, details);
      setReporting(false);
      toast({ kind: 'success', title: 'Благодарим!', body: 'Модератор ще прегледа набора.' });
    } catch (err) {
      toast({ kind: 'error', title: errorMessage(err) });
    }
  }

  async function hide(hidden: boolean) {
    try {
      await api.hideSet(code, hidden);
      if (data) setData({ ...data, hidden });
    } catch (err) {
      toast({ kind: 'error', title: errorMessage(err) });
    }
  }

  if (!data && error)
    return error.status === 404 ? (
      <Card className="mx-auto max-w-md">
        <EmptyState icon="🔗" title="Този набор вече не е достъпен" page />
      </Card>
    ) : (
      <LoadError title="Наборът не се зареди" error={error} onRetry={retry} />
    );
  if (!data) return <PageSpinner />;
  const parts = [
    data.kinds.choice && `${data.kinds.choice} с избор`,
    data.kinds.truefalse && `${data.kinds.truefalse} вярно/невярно`,
    data.kinds.number && `${data.kinds.number} с число`,
  ].filter(Boolean);
  return (
    <div className="mx-auto max-w-md space-y-4">
      <Card className="p-6 text-center sm:p-8">
        <span aria-hidden className="text-5xl">
          📝
        </span>
        <p className="mt-4 t-eyebrow text-fg-3">Набор с въпроси</p>
        <h1 className="mt-2 font-display text-3xl font-black [overflow-wrap:anywhere]">{data.name}</h1>
        <p className="mt-2 text-fg-2">
          {data.questions} {data.questions === 1 ? 'въпрос' : 'въпроса'}
          {data.author && ` · от ${data.author}`}
        </p>
        {parts.length > 0 && <p className="mt-1 text-sm text-fg-3">{parts.join(', ')}</p>}
        {data.hidden && <p className="mt-3 text-sm text-rose-300">Скрит от модератор.</p>}
        {data.mine ? (
          <Button size="lg" className="mt-6 w-full" onClick={() => navigate(`/sets/${data.mine}`)}>
            Отвори своя набор
          </Button>
        ) : (
          <Button size="lg" className="mt-6 w-full" onClick={() => void copy()} loading={busy} disabled={data.hidden}>
            Вземи копие за моите стаи
          </Button>
        )}
      </Card>
      <div className="flex flex-wrap justify-center gap-2">
        {!data.mine && (
          <Button variant="ghost" size="sm" onClick={() => setReporting(true)}>
            <Flag className="size-4" /> Сигнализирай
          </Button>
        )}
        {admin && (
          <Button variant="ghost" size="sm" onClick={() => void hide(!data.hidden)}>
            {data.hidden ? 'Покажи отново' : 'Скрий (модератор)'}
          </Button>
        )}
      </div>
      <Modal open={reporting} onClose={() => setReporting(false)} title="Сигнал за набор">
        <p className="text-sm text-fg-2">Какво не е наред — обидно съдържание, нещо неподходящо?</p>
        <textarea
          value={details}
          maxLength={400}
          rows={3}
          aria-label="Подробности"
          onChange={(e) => setDetails(e.target.value)}
          className="field mt-3 w-full rounded-2xl p-3 text-sm"
        />
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setReporting(false)}>
            Отказ
          </Button>
          <Button onClick={() => void report()}>Изпрати</Button>
        </div>
      </Modal>
    </div>
  );
}
