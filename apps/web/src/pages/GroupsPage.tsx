import { api, errorMessage, fmt, plural, toast, useStore } from '@quiz/client';
import { BRAND, GROUPS, type GroupEntry, type GroupInfo, shiftDay } from '@quiz/shared';
import clsx from 'clsx';
import { ArrowLeft, ArrowRight, Link2, LogOut, Pencil, Share2, Trash2, UserMinus } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Avatar, PlayerTag } from '../components/Avatar';
import { GuestNudge } from '../components/ClaimAccount';
import { Emoji } from '../components/Emoji';
import { GroupRow } from '../components/groups';
import { LoadError } from '../components/LoadError';
import { Button, Card, EmptyState, INPUT, Modal, PageSpinner, SectionTitle } from '../components/ui';
import { useLoad } from '../lib/load';
import { shareText } from '../lib/share';
import { usePageTitle } from '../lib/title';
import { NotFoundPage } from './NotFoundPage';

/** Groups (/groups), one group (/groups/<id>), or an invite to one (/groups/join/<code>). */
export function GroupsPage() {
  const { id, code } = useParams();
  if (code !== undefined) return <GroupInvite code={code} />;
  if (id === undefined) return <GroupList />;
  return /^\d{1,12}$/.test(id) ? <GroupView id={Number(id)} /> : <NotFoundPage />;
}

/** "26 октомври" (a day key, as Sofia has it). */
const dayName = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('bg-BG', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const weekName = (monday: string) => `${dayName(monday)} – ${dayName(shiftDay(monday, 6))}`;

const inviteUrl = (code: string) => `${window.location.origin}/groups/join/${code}`;

function shareInvite(g: Pick<GroupInfo, 'name' | 'code'>) {
  void shareText(
    `Влез в групата „${g.name}“ в ${BRAND.name}: всяка седмица — кой знае най-много от въпросите на деня.\n${inviteUrl(g.code)}`,
    'Линкът е копиран',
  );
}

// ─── The list ────────────────────────────────────────────────────────────────

function GroupList() {
  usePageTitle('Групи');
  const me = useStore((s) => s.me)!;
  const navigate = useNavigate();
  const { data, error, retry } = useLoad(() => api.groups());
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { id } = await api.createGroup(name);
      navigate(`/groups/${id}`);
    } catch (err) {
      toast({ kind: 'error', title: errorMessage(err) });
      setBusy(false);
    }
  }

  if (!data && error) return <LoadError title="Групите не се заредиха" error={error} onRetry={retry} />;
  if (!data) return <PageSpinner />;
  const full = data.groups.length >= GROUPS.perPlayer;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="t-page">Групи</h1>
        <p className="mt-2 max-w-xl text-fg-2 text-pretty">
          Клас, офис, семейство: група с линк за покана и седмична класация на въпросите на деня — сборът от най-добрите
          ти {GROUPS.bestDays} дни от понеделник до неделя. Победителят носи <Emoji e="👑" /> цялата следваща седмица.
        </p>
      </header>

      {data.groups.length > 0 ? (
        <ul className="space-y-3">
          {data.groups.map((g) => (
            <li key={g.id}>
              <GroupRow group={g} />
            </li>
          ))}
        </ul>
      ) : (
        <Card>
          <EmptyState
            icon="🫂"
            title="Още не си в група"
            body="Създай една и прати линка — или отвори линк, който са ти пратили."
          />
        </Card>
      )}

      {me.isGuest ? (
        <GuestNudge>
          Група се създава с профил: запази своя с име и парола (в чужда група можеш да влезеш и като гост).
        </GuestNudge>
      ) : full ? (
        <p className="text-sm text-fg-3">Можеш да си в най-много {GROUPS.perPlayer} групи.</p>
      ) : (
        <Card className="p-5 sm:p-6">
          <h2 className="t-card">Нова група</h2>
          <form onSubmit={create} className="mt-4 flex flex-wrap gap-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={GROUPS.name[1]}
              required
              minLength={GROUPS.name[0]}
              aria-label="Име на групата"
              placeholder="Например „10 Б клас“ или „Офис 3“"
              className={clsx(INPUT, 'min-w-0 flex-1 basis-56')}
            />
            <Button type="submit" size="lg" loading={busy} disabled={name.trim().length < GROUPS.name[0]}>
              Създай
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}

// ─── One group ───────────────────────────────────────────────────────────────

function GroupView({ id }: { id: number }) {
  const me = useStore((s) => s.me)!;
  const navigate = useNavigate();
  const { data: loaded, error, retry } = useLoad(() => api.group(id), String(id));
  const [group, setGroup] = useState<GroupInfo | null>(null);
  const g = group ?? loaded;
  usePageTitle(g?.name ?? 'Група');
  const [renaming, setRenaming] = useState(false);
  const [removing, setRemoving] = useState<{ id: number; username: string } | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function change(call: () => Promise<GroupInfo>, done?: string) {
    try {
      setGroup(await call());
      if (done) toast({ kind: 'success', title: done });
    } catch (err) {
      toast({ kind: 'error', title: errorMessage(err) });
    }
  }

  async function leave() {
    try {
      await api.leaveGroup(id);
      navigate('/groups', { replace: true });
    } catch (err) {
      toast({ kind: 'error', title: errorMessage(err) });
    }
  }

  async function remove() {
    try {
      await api.deleteGroup(id);
      navigate('/groups', { replace: true });
    } catch (err) {
      toast({ kind: 'error', title: errorMessage(err) });
    }
  }

  if (!g && error)
    return error.status === 404 ? (
      <Card className="mx-auto max-w-md">
        <EmptyState icon="🫂" title="Няма такава група" body="Или вече не си в нея. Поискай нов линк за покана." page />
      </Card>
    ) : (
      <LoadError title="Групата не се зареди" error={error} onRetry={retry} />
    );
  if (!g) return <PageSpinner />;
  const removable = (userId: number) => g.isOwner && userId !== me.id;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        to="/groups"
        className="focus-ring -my-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg text-sm font-semibold text-fg-3 hover:text-fg-2"
      >
        <ArrowLeft aria-hidden className="size-4" /> Групи
      </Link>

      <header className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="t-page [overflow-wrap:anywhere]">{g.name}</h1>
          <p className="mt-1 text-fg-2">
            {plural(g.members, 'член', 'членове')}
            {g.owner && ` · създадена от ${g.owner.username}`}
          </p>
        </div>
        {g.isOwner && (
          <Button variant="ghost" size="sm" onClick={() => setRenaming(true)}>
            <Pencil className="size-4" /> Преименувай
          </Button>
        )}
      </header>

      <Card className="p-5 sm:p-6">
        <h2 className="t-card">Покани</h2>
        <p className="mt-1 text-sm text-fg-2">Който отвори линка, влиза в групата — с профил или като гост.</p>
        <p className="mt-3 truncate rounded-xl bg-tint/5 px-3 py-2 font-mono text-sm text-fg-2">{inviteUrl(g.code)}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => shareInvite(g)}>
            <Share2 className="size-4" /> Прати линка
          </Button>
          {g.isOwner && (
            <Button
              variant="ghost"
              onClick={() => void change(() => api.newGroupLink(id), 'Новият линк е готов — старият вече не работи.')}
            >
              <Link2 className="size-4" /> Нов линк
            </Button>
          )}
        </div>
      </Card>

      {!me.daily.played && (
        <Link
          to="/daily"
          className="focus-ring flex items-center gap-3 rounded-3xl border border-amber-300/25 bg-amber-400/10 p-4 text-amber-100 hover:bg-amber-400/15"
        >
          <span aria-hidden className="text-2xl">
            <Emoji e="📅" />
          </span>
          <span className="min-w-0 flex-1 text-sm">
            <b className="text-fg">Днешните въпроси</b> те чакат — всеки ден е шанс за точки в групата.
          </span>
          <ArrowRight aria-hidden className="size-4 shrink-0" />
        </Link>
      )}

      <section>
        <div className="mb-4">
          <h2 className="t-section">Тази седмица</h2>
          <p className="mt-1 text-sm text-fg-3">{weekName(g.week.start)}</p>
        </div>
        {g.week.entries.length ? (
          <Card className="overflow-hidden">
            <ol className="divide-y divide-line">
              {g.week.entries.map((e) => (
                <BoardRow
                  key={e.user.id}
                  entry={e}
                  you={e.user.id === me.id}
                  onRemove={removable(e.user.id) ? () => setRemoving(e.user) : null}
                />
              ))}
            </ol>
          </Card>
        ) : (
          <Card>
            <EmptyState
              icon="📅"
              title="Седмицата тепърва започва"
              body="Който изиграе въпросите на деня, влиза в класацията."
            />
          </Card>
        )}
        <p className="mt-2 text-xs text-fg-3">
          Сбор от най-добрите {GROUPS.bestDays} дни на всеки до неделя вечер. Победителят носи <Emoji e="👑" /> цялата
          следваща седмица.
        </p>
      </section>

      {g.week.waiting.length > 0 && (
        <section>
          <SectionTitle>Още не са играли</SectionTitle>
          <Card className="divide-y divide-line">
            {g.week.waiting.map((u) => (
              <div key={u.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <Link
                  to={`/profile/${encodeURIComponent(u.username)}`}
                  className="focus-ring flex min-w-0 flex-1 items-center gap-3 rounded-xl"
                >
                  <Avatar avatar={u.avatar} frame={u.frame} size={36} />
                  <PlayerTag name={u.username} title={u.title} level={u.level} />
                </Link>
                {removable(u.id) && <RemoveButton name={u.username} onClick={() => setRemoving(u)} />}
              </div>
            ))}
          </Card>
        </section>
      )}

      {g.history.length > 0 && (
        <section>
          <SectionTitle>Победители</SectionTitle>
          <Card className="divide-y divide-line">
            {g.history.map((h) => (
              <div key={h.week} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm sm:px-5">
                <span className="min-w-0 flex-1 basis-44 text-fg-3">{weekName(h.week)}</span>
                {h.winner ? (
                  <span className="font-semibold">
                    <Emoji e="👑" /> {h.winner.username}{' '}
                    <span className="font-normal text-fg-3">· {fmt(h.score)} т.</span>
                  </span>
                ) : (
                  <span className="text-fg-3">никой не игра</span>
                )}
              </div>
            ))}
          </Card>
        </section>
      )}

      <div className="flex flex-wrap gap-2 border-t border-line pt-6">
        <Button variant="ghost" onClick={() => setLeaving(true)}>
          <LogOut className="size-4" /> Напусни групата
        </Button>
        {g.isOwner && (
          <Button variant="ghost" className="text-rose-300" onClick={() => setDeleting(true)}>
            <Trash2 className="size-4" /> Изтрий групата
          </Button>
        )}
      </div>

      <RenameGroup
        open={renaming}
        name={g.name}
        onClose={() => setRenaming(false)}
        onSave={(name) => change(() => api.renameGroup(id, name)).then(() => setRenaming(false))}
      />
      <Confirm
        open={!!removing}
        title="Премахване от групата"
        action="Премахни"
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          const target = removing!;
          setRemoving(null);
          void change(() => api.removeFromGroup(id, target.id));
        }}
      >
        Да премахна ли <b className="text-fg">{removing?.username}</b> от групата? С линка може да влезе отново — за да
        не може, направи нов линк.
      </Confirm>
      <Confirm
        open={leaving}
        title="Напускане на групата"
        action="Напусни"
        onClose={() => setLeaving(false)}
        onConfirm={() => void leave()}
      >
        {g.isOwner && g.members > 1
          ? 'Групата остава за другите: ще я поеме този, който е в нея най-отдавна.'
          : g.members > 1
            ? 'Можеш да влезеш отново с линк за покана.'
            : 'Ти си последният в групата: тя ще изчезне заедно с класациите си.'}
      </Confirm>
      <Confirm
        open={deleting}
        title="Изтриване на групата"
        action="Изтрий"
        onClose={() => setDeleting(false)}
        onConfirm={() => void remove()}
      >
        Групата „{g.name}“ и класациите ѝ ще изчезнат за всички {plural(g.members, 'член', 'членове')}.
      </Confirm>
    </div>
  );
}

function BoardRow({ entry: e, you, onRemove }: { entry: GroupEntry; you: boolean; onRemove: (() => void) | null }) {
  return (
    <li className={clsx('flex items-center gap-3 px-4 py-3 sm:px-5', you && 'bg-violet-500/10')}>
      <span className="w-6 shrink-0 text-center font-display font-bold text-fg-2 tabular-nums">{e.rank}</span>
      <Link
        to={`/profile/${encodeURIComponent(e.user.username)}`}
        className="focus-ring flex min-w-0 flex-1 items-center gap-3 rounded-xl"
      >
        <Avatar avatar={e.user.avatar} frame={e.user.frame} size={36} />
        <div className="min-w-0">
          <PlayerTag name={`${e.crown ? '👑 ' : ''}${e.user.username}`} title={e.user.title} level={e.user.level} />
        </div>
      </Link>
      <div className="shrink-0 text-right">
        <p className="font-display font-bold tabular-nums">{fmt(e.score)}</p>
        <p className="text-xs text-fg-3">
          {plural(e.days, 'ден', 'дни')}
          {e.today !== null ? ' · днес ✓' : ''}
        </p>
      </div>
      {onRemove && <RemoveButton name={e.user.username} onClick={onRemove} />}
    </li>
  );
}

function RemoveButton({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Премахни ${name} от групата`}
      title="Премахни от групата"
      className="focus-ring -mr-2 grid size-11 shrink-0 place-items-center rounded-xl text-fg-3 hover:bg-tint/10 hover:text-rose-300"
    >
      <UserMinus className="size-4" />
    </button>
  );
}

function Confirm({
  open,
  title,
  action,
  onClose,
  onConfirm,
  children,
}: {
  open: boolean;
  title: string;
  action: string;
  onClose: () => void;
  onConfirm: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="text-fg-2">{children}</p>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Не
        </Button>
        <Button variant="danger" onClick={onConfirm}>
          {action}
        </Button>
      </div>
    </Modal>
  );
}

function RenameGroup({
  open,
  name,
  onClose,
  onSave,
}: {
  open: boolean;
  name: string;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setValue(name);
  }, [open, name]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    await onSave(value);
    setBusy(false);
  }
  return (
    <Modal open={open} onClose={onClose} title="Ново име">
      <form onSubmit={submit}>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={GROUPS.name[1]}
          aria-label="Име на групата"
          className={INPUT}
        />
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Отказ
          </Button>
          <Button type="submit" loading={busy} disabled={value.trim().length < GROUPS.name[0]}>
            Запази
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ─── An invite ───────────────────────────────────────────────────────────────

function GroupInvite({ code }: { code: string }) {
  usePageTitle('Покана за група');
  const navigate = useNavigate();
  const guest = useStore((s) => !!s.me?.isGuest);
  const { data, error, retry } = useLoad(() => api.groupPreview(code), code);
  const [busy, setBusy] = useState(false);

  // Already in it: straight to the group.
  useEffect(() => {
    if (data?.memberOf) navigate(`/groups/${data.memberOf}`, { replace: true });
  }, [data, navigate]);

  async function join() {
    setBusy(true);
    try {
      const { id } = await api.joinGroup(code);
      toast({ kind: 'success', title: `Влезе в „${data!.name}“` });
      navigate(`/groups/${id}`, { replace: true });
    } catch (err) {
      toast({ kind: 'error', title: errorMessage(err) });
      setBusy(false);
    }
  }

  if (!data && error)
    return error.status === 404 ? (
      <Card className="mx-auto max-w-md">
        <EmptyState icon="🔗" title="Линкът вече не е валиден" body="Поискай нов линк от този, който те покани." page />
      </Card>
    ) : (
      <LoadError title="Поканата не се зареди" error={error} onRetry={retry} />
    );
  if (!data || data.memberOf) return <PageSpinner />;

  return (
    <div className="mx-auto max-w-md space-y-4">
      <Card className="p-6 text-center sm:p-8">
        <span aria-hidden className="text-5xl">
          <Emoji e="🫂" />
        </span>
        <p className="mt-4 t-eyebrow text-fg-3">Покана за група</p>
        <h1 className="mt-2 font-display text-3xl font-black [overflow-wrap:anywhere]">{data.name}</h1>
        <p className="mt-2 text-fg-2">
          {plural(data.members, 'член', 'членове')}
          {data.owner && ` · създадена от ${data.owner}`}
        </p>
        <p className="mt-4 text-sm text-fg-2 text-pretty">
          Всяка седмица — класация на въпросите на деня: сборът от най-добрите {GROUPS.bestDays} дни на всеки.
          Победителят носи <Emoji e="👑" />.
        </p>
        {data.full ? (
          <p className="mt-6 text-sm text-rose-300">Групата е пълна ({GROUPS.maxMembers} членове).</p>
        ) : (
          <Button size="lg" className="mt-6 w-full" onClick={() => void join()} loading={busy}>
            Влез в групата
          </Button>
        )}
      </Card>
      {guest && (
        <GuestNudge>В групата ще се виждаш с името на гост. Запази профила си с име, за да те познаят.</GuestNudge>
      )}
    </div>
  );
}
