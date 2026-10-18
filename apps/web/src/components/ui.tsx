import clsx from 'clsx';
import { X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { type ButtonHTMLAttributes, type ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'gold';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary:
    'text-white bg-[linear-gradient(110deg,#a855f7,#7c3aed_45%,#db2777)] shadow-[0_8px_32px_-8px_rgb(168_85_247/0.65),inset_0_1px_0_rgb(255_255_255/0.25)] hover:brightness-110',
  secondary: 'glass text-fg hover:bg-white/10',
  ghost: 'text-fg-2 hover:text-fg hover:bg-white/5',
  danger: 'text-white bg-rose-500/90 hover:bg-rose-500 shadow-[0_8px_28px_-10px_rgb(244_63_94/0.7)]',
  gold: 'text-amber-950 bg-[linear-gradient(110deg,#fde68a,#f59e0b)] shadow-[0_8px_28px_-10px_rgb(245_158_11/0.8)] hover:brightness-105',
};

const SIZES: Record<Size, string> = {
  sm: 'h-9 px-3.5 text-sm rounded-xl gap-1.5',
  md: 'h-11 px-5 text-[15px] rounded-2xl gap-2',
  lg: 'h-14 px-7 text-base rounded-2xl gap-2.5',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  loading,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={clsx(
        'focus-ring inline-flex select-none items-center justify-center font-semibold transition-[filter,background,transform,opacity] duration-150 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    >
      {loading ? <Spinner className="size-4" /> : children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={clsx('inline-block animate-spin rounded-full border-2 border-current border-r-transparent', className)}
    />
  );
}

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={clsx('glass rounded-3xl', className)}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <h2 className="font-display text-lg font-bold tracking-tight sm:text-xl">{children}</h2>
      {aside}
    </div>
  );
}

export function Pill({ children, className, style }: { children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <span
      style={style}
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border border-line bg-white/5 px-2.5 py-1 text-xs font-semibold text-fg-2',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Modal({
  open,
  onClose,
  children,
  className,
  title,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  title?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Portal to <body>: a glass ancestor's backdrop-filter would otherwise trap `position: fixed` inside it.
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/60 p-4 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            role="dialog"
            aria-modal
            className={clsx('glass relative w-full max-w-lg rounded-3xl bg-ink-2/80 p-6 sm:p-8', className)}
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          >
            <button
              onClick={onClose}
              aria-label="Затвори"
              className="focus-ring absolute top-4 right-4 grid size-9 place-items-center rounded-full text-fg-3 hover:bg-white/10 hover:text-fg"
            >
              <X className="size-5" />
            </button>
            {title && <h2 className="mb-5 pr-10 font-display text-xl font-bold">{title}</h2>}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-2xl border border-line bg-black/20 p-1">
      {options.map((o) => (
        <button
          key={String(o.value)}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={clsx(
            'focus-ring relative h-9 rounded-xl px-3.5 text-sm font-semibold transition-colors disabled:cursor-default',
            o.value === value ? 'text-white' : 'text-fg-3 hover:text-fg-2',
          )}
        >
          {o.value === value && (
            <motion.span
              layoutId={`seg-${options.map((x) => x.value).join('-')}`}
              className="absolute inset-0 rounded-xl bg-white/12 shadow-[inset_0_1px_0_rgb(255_255_255/0.12)]"
              transition={{ type: 'spring', stiffness: 500, damping: 38 }}
            />
          )}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function ProgressBar({ value, className, gradient }: { value: number; className?: string; gradient?: string }) {
  return (
    <div className={clsx('h-2 overflow-hidden rounded-full bg-white/8', className)}>
      <motion.div
        className="h-full rounded-full"
        style={{ background: gradient ?? 'linear-gradient(90deg,#a855f7,#22d3ee)' }}
        initial={{ width: 0 }}
        animate={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
        transition={{ type: 'spring', stiffness: 120, damping: 24 }}
      />
    </div>
  );
}

export function EmptyState({ icon, title, body }: { icon: string; title: string; body?: string }) {
  return (
    <div className="grid place-items-center gap-2 py-12 text-center">
      <span className="text-5xl">{icon}</span>
      <p className="font-display font-bold">{title}</p>
      {body && <p className="max-w-sm text-sm text-fg-3">{body}</p>}
    </div>
  );
}
