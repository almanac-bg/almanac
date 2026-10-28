import { api, useStore } from '@quiz/client';
import { levelProgress, SUBMISSION_RULES } from '@quiz/shared';
import clsx from 'clsx';
import { PenLine, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, Card } from '../ui';

export function CommunityCard({ className }: { className?: string }) {
  const me = useStore((s) => s.me)!;
  const navigate = useNavigate();
  const [todo, setTodo] = useState<{ pendingQuestions: number; openReports: number; questionReports: number } | null>(
    null,
  );
  const locked = levelProgress(me.xp).level < SUBMISSION_RULES.minLevel;
  const pending = todo ? todo.pendingQuestions + todo.openReports + todo.questionReports : 0;
  // Open the moderation tab that has work waiting.
  const adminTab =
    !todo || todo.pendingQuestions
      ? '/admin'
      : todo.questionReports
        ? '/admin?tab=flags'
        : todo.openReports
          ? '/admin?tab=reports'
          : '/admin';

  useEffect(() => {
    if (me.isAdmin)
      api
        .adminSummary()
        .then(setTodo)
        .catch(() => {});
  }, [me.isAdmin]);

  return (
    <Card className={clsx('relative flex flex-col overflow-hidden p-5 sm:p-7', className)}>
      <div className="absolute -right-10 -bottom-16 size-48 rounded-full glow text-emerald-500/15" />
      <div className="relative flex items-center gap-2 text-emerald-300">
        <PenLine className="size-5" />
        <span className="t-eyebrow">Общност</span>
      </div>
      <h2 className="relative mt-2 t-card">Предложи въпрос</h2>
      <p className="relative mt-1 text-sm text-fg-3">
        Знаеш нещо интересно? Изпрати въпрос — одобрените влизат в играта с твоето име и +{SUBMISSION_RULES.approvedXp}{' '}
        XP.
      </p>
      <div className="relative mt-auto flex flex-wrap gap-2 pt-5">
        {/* Only admins see the card before level 3 (for moderation); writing still waits for the level. */}
        {!locked && (
          <Button variant="secondary" onClick={() => navigate('/submit')}>
            <PenLine className="size-4" /> Напиши въпрос
          </Button>
        )}
        {/* An admin below the level sees the card for moderation: say why there's nothing to write with yet. */}
        {locked && (
          <p className="w-full text-xs text-fg-3">Писането се отключва на ниво {SUBMISSION_RULES.minLevel}.</p>
        )}
        {me.isAdmin && (
          <Button variant={locked ? 'secondary' : 'ghost'} onClick={() => navigate(adminTab)}>
            <ShieldCheck className="size-4" /> Модерация
            {pending ? (
              <span className="rounded-full bg-amber-400 px-1.5 text-xs font-bold text-amber-950">{pending}</span>
            ) : null}
          </Button>
        )}
      </div>
    </Card>
  );
}
