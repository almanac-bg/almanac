import clsx from 'clsx';
import { X } from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import { type ButtonHTMLAttributes, type ReactNode, type Ref, type RefObject, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Emoji } from './Emoji';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'gold' | 'accent';
type Size = 'sm' | 'md' | 'lg' | 'field';

const VARIANTS: Record<Variant, string> = {
  // Starts at purple-600: white on the lighter #a855f7 was under 4:1 where long labels begin.
  // Disabled, a plain fill: a faded gradient still looked like the button to press (a „Подреди“ not yet complete).
  primary:
    'text-white bg-[linear-gradient(110deg,#9333ea,#7c3aed_45%,#db2777)] shadow-[0_8px_32px_-8px_rgb(168_85_247/0.65),inset_0_1px_0_rgb(255_255_255/0.25)] hover:brightness-110 disabled:bg-none disabled:bg-tint/10 disabled:text-fg-2 disabled:shadow-none',
  secondary: 'glass text-fg hover:bg-tint/10',
  ghost: 'text-fg-2 hover:text-fg hover:bg-tint/5',
  // rose-600, darker on hover: white on rose-500 is under 4:1.
  danger: 'text-white bg-[#be123c] hover:bg-[#9f1239] shadow-[0_8px_28px_-10px_rgb(244_63_94/0.7)]',
  // A fixed dark brown, not the palette's (that one runs light on the light theme): the gold is the same on both.
  gold: 'text-[#451a03] bg-[linear-gradient(110deg,#fde68a,#f59e0b)] shadow-[0_8px_28px_-10px_rgb(245_158_11/0.8)] hover:brightness-105',
  // A game mode's own colours, given by the caller (style={accentFill(mode)}).
  accent: 'hover:brightness-110',
};

const SIZES: Record<Size, string> = {
  // Compact for a mouse, a full 44px tap target on touch screens.
  // One control radius at every size; fully round corners are for chips and badges.
  sm: 'h-9 pointer-coarse:h-11 px-3.5 text-sm rounded-2xl gap-1.5',
  md: 'h-11 px-5 text-[15px] rounded-2xl gap-2',
  lg: 'h-14 px-7 text-base rounded-2xl gap-2.5',
  /** Beside a text field (INPUT): the same height, so the row reads as one line. */
  field: 'h-12 px-5 text-[15px] rounded-2xl gap-2',
};

/** A button's look, for a link that should look like one (a <Button> inside a link would be a second tab stop). */
export function buttonClass({ variant = 'primary', size = 'md' }: { variant?: Variant; size?: Size } = {}) {
  return clsx(
    'focus-ring inline-flex select-none items-center justify-center font-semibold transition-[filter,background,transform,opacity] duration-150 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45',
    VARIANTS[variant],
    SIZES[size],
  );
}

/** A plain button unless it says `type="submit"` (the HTML default would submit any form it sits in). */
export function Button({
  variant = 'primary',
  size = 'md',
  type = 'button',
  className,
  children,
  loading,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      {...rest}
      type={type}
      disabled={rest.disabled || loading}
      className={clsx(buttonClass({ variant, size }), className)}
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

/**
 * A whole page waiting for its data: it holds most of the screen, so what loads fills the space instead of pushing the
 * footer down (a jump under the thumb, and what Google counts as layout shift).
 */
export function PageSpinner() {
  return (
    <div role="status" className="grid min-h-[70dvh] place-items-center">
      <Spinner className="size-8 text-violet-400" />
      <span className="sr-only">Зареждане…</span>
    </div>
  );
}

/**
 * A page that belongs to where the player is (a room, a match) while the server hasn't said yet whether they still are:
 * after a reload or a blip it does within moments (Store.settled). Not a redirect to the lobby in the meantime.
 */
export function Restoring({ what }: { what: string }) {
  return (
    <div role="status" className="grid min-h-[70dvh] place-items-center text-center">
      <div className="flex flex-col items-center gap-3">
        <Spinner className="size-8 text-violet-400" />
        <p className="text-fg-2">Връщаме те {what}…</p>
      </div>
    </div>
  );
}

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={clsx('glass rounded-3xl', className)}>
      {children}
    </div>
  );
}

/**
 * How an on/off switch looks: a track and a thumb. The control around it is the button with role="switch" (its own
 * label, its own target size). One look and one colour everywhere: the colour says "on", not what is switched.
 */
export function SwitchTrack({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={clsx(
        'relative h-7 w-12 shrink-0 rounded-full border transition-colors',
        on ? 'border-violet-400/60 bg-violet-500/70' : 'border-line bg-tint/10',
      )}
    >
      <span
        className={clsx(
          'absolute top-0.5 left-0.5 size-5.5 rounded-full bg-white shadow transition-transform',
          on && 'translate-x-5',
        )}
      />
    </span>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <h2 className="t-section">{children}</h2>
      {aside}
    </div>
  );
}

export function Pill({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      style={style}
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border border-line bg-tint/5 px-2.5 py-1 text-xs font-semibold text-fg-2',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A text field's look; the `field` class (styles.css) carries the border, the fill and the focus ring. */
export const INPUT = 'field h-12 w-full rounded-2xl px-4 text-[15px] aria-invalid:border-rose-400/60';

/** A label above its input, tied to it by id: wrapping both would add the show-password toggle to the input's name. */
export function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-semibold tracking-wide text-fg-2 uppercase">
        {label}
      </label>
      {children}
    </div>
  );
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * What makes a box a dialog: while open, focus moves into it (to `initial`, or the box itself) and stays there (Tab
 * cycles inside), Escape closes it, the page behind doesn't scroll, and on close focus goes back where it was.
 */
export function useDialog(
  open: boolean,
  onClose: () => void,
  box: RefObject<HTMLElement | null>,
  initial?: RefObject<HTMLElement | null>,
) {
  // Kept in a ref: callers pass inline functions, and re-running the effect would yank focus while someone types.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: the refs are stable; `open` is the trigger
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (initial?.current ?? box.current)?.focus({ preventScroll: true });
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return close.current();
      const root = box.current;
      if (e.key !== 'Tab' || !root) return;
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
      if (!items.length) return e.preventDefault();
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!root.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && (active === first || active === root)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open]);
}

/**
 * A dialog that behaves like one (useDialog), named by its title (or `label` when it has none).
 */
export function Modal({
  open,
  onClose,
  children,
  className,
  title,
  label,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  /** Accessible name when there's no `title`. */
  label?: string;
  /** Id of a heading inside `children` that names the dialog, when there's no `title`. */
  labelledBy?: string;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialog(open, onClose, dialog);

  // Portal to <body>: a glass ancestor's backdrop-filter would otherwise trap `position: fixed` inside it.
  return createPortal(
    <AnimatePresence>
      {open && (
        <m.div
          className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/60 p-4 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <m.div
            ref={dialog}
            role="dialog"
            aria-modal
            aria-labelledby={title ? titleId : labelledBy}
            aria-label={title || labelledBy ? undefined : label}
            tabIndex={-1}
            className={clsx(
              'glass relative w-full max-w-lg rounded-3xl bg-ink-2/80 p-6 outline-none sm:p-8',
              className,
            )}
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="Затвори"
              className="focus-ring absolute top-3 right-3 grid size-11 place-items-center rounded-full text-fg-3 hover:bg-tint/10 hover:text-fg"
            >
              <X className="size-5" />
            </button>
            {title && (
              <h2 id={titleId} className="mb-5 pr-10 font-display text-xl font-bold">
                {title}
              </h2>
            )}
            {children}
          </m.div>
        </m.div>
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
  scroll,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  disabled?: boolean;
  /** On phones one row that scrolls sideways, instead of wrapping onto a second (many or long options). */
  scroll?: boolean;
}) {
  return (
    <div
      className={clsx(
        'inline-flex gap-1 rounded-2xl border border-line bg-sunk/20 p-1',
        scroll ? 'max-w-full overflow-x-auto max-sm:flex-nowrap max-sm:whitespace-nowrap sm:flex-wrap' : 'flex-wrap',
      )}
    >
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          disabled={disabled}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={clsx(
            // shrink-0: a touch screen's min-width replaces flex's own, and the tabs shrank under their text instead of scrolling.
            'focus-ring relative h-9 shrink-0 rounded-xl px-3.5 text-sm font-semibold transition-colors disabled:cursor-default pointer-coarse:min-h-11 pointer-coarse:min-w-11',
            o.value === value ? 'text-fg' : 'text-fg-3 hover:text-fg-2',
          )}
        >
          {o.value === value && (
            <m.span
              layoutId={`seg-${options.map((x) => x.value).join('-')}`}
              className="absolute inset-0 rounded-xl bg-tint/12 shadow-[inset_0_1px_0_rgb(255_255_255/0.12)]"
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
    <div className={clsx('h-2 overflow-hidden rounded-full bg-tint/8', className)}>
      <m.div
        className="h-full rounded-full"
        style={{ background: gradient ?? 'linear-gradient(90deg,#a855f7,#22d3ee)' }}
        initial={{ width: 0 }}
        animate={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
        transition={{ type: 'spring', stiffness: 120, damping: 24 }}
      />
    </div>
  );
}

/** Nothing to show. `page`: it's all there is on the page, so its title is the page's heading. */
export function EmptyState({
  icon,
  title,
  body,
  page,
  children,
}: {
  icon: string;
  title: string;
  body?: string;
  page?: boolean;
  /** What to do about it (a button or two), under the text. */
  children?: ReactNode;
}) {
  const Title = page ? 'h1' : 'p';
  return (
    <div className="grid place-items-center gap-2 px-6 py-12 text-center">
      <Emoji e={icon} size="3.5rem" />
      <Title className="font-extrabold">{title}</Title>
      {body && <p className="max-w-sm text-sm text-fg-3">{body}</p>}
      {children && <div className="mt-3 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}
