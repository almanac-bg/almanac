import clsx from 'clsx';
import { Check, ChevronDown } from 'lucide-react';
import {
  type CSSProperties,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

/**
 * The game's own form controls, in its look instead of each browser's: a select whose list is ours (the native one
 * opens the operating system's), a slider, and the round and square marks of radio buttons and checkboxes. Each keeps
 * the semantics and keys of the native control it stands for.
 */

export interface SelectOption<T> {
  value: T;
  /** What the option shows; `text` is what it's typed and read as when the label is more than text. */
  label: ReactNode;
  text?: string;
  icon?: ReactNode;
  /** A second, quieter line. */
  hint?: ReactNode;
  disabled?: boolean;
}

/**
 * A select: a button that shows the choice, and a list of the options under it (above it, near the bottom of the
 * screen). The WAI-ARIA "select-only combobox": the focus stays on the button, the list follows it by
 * aria-activedescendant; ↑/↓, Home/End and typing a name move, Enter/Space choose, Escape closes, Tab chooses and goes
 * on. Its name comes from a <label htmlFor={id}> or `aria-label`. The list is drawn over everything (in <body>), so a
 * dialog or a card's edge can't clip it.
 */
export function Select<T extends string | number>({
  id,
  value,
  onChange,
  options,
  placeholder = 'Избери…',
  disabled,
  className,
  'aria-label': ariaLabel,
  'aria-describedby': describedBy,
}: {
  id?: string;
  value: T | null;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
}) {
  const own = useId();
  const buttonId = id ?? `${own}-button`;
  const listId = `${own}-list`;
  const optionId = (i: number) => `${own}-option-${i}`;
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<CSSProperties>({});
  const typed = useRef({ text: '', at: 0 });
  const selected = options.findIndex((o) => o.value === value);
  const current = selected === -1 ? null : options[selected];

  const enabled = (i: number) => !options[i]?.disabled;
  const step = (from: number, by: 1 | -1) => {
    for (let i = from + by; i >= 0 && i < options.length; i += by) if (enabled(i)) return i;
    return from;
  };
  const first = () => step(-1, 1);
  const last = () => step(options.length, -1);

  const show = (at = selected === -1 ? first() : selected) => {
    if (disabled) return;
    setActive(at);
    setOpen(true);
  };
  const choose = (i: number) => {
    if (enabled(i)) onChange(options[i].value);
    setOpen(false);
  };

  // Under the button, as wide as it at least; above it when the screen has more room there.
  useLayoutEffect(() => {
    if (!open) return;
    const placeIt = () => {
      const box = button.current?.getBoundingClientRect();
      if (!box) return;
      const below = window.innerHeight - box.bottom;
      const up = below < 260 && box.top > below;
      const room = Math.max(160, (up ? box.top : below) - 16);
      setPlace({
        left: Math.max(8, Math.min(box.left, window.innerWidth - box.width - 8)),
        minWidth: box.width,
        maxWidth: window.innerWidth - 16,
        maxHeight: Math.min(320, room),
        ...(up ? { bottom: window.innerHeight - box.top + 6 } : { top: box.bottom + 6 }),
      });
    };
    placeIt();
    window.addEventListener('resize', placeIt);
    window.addEventListener('scroll', placeIt, true);
    return () => {
      window.removeEventListener('resize', placeIt);
      window.removeEventListener('scroll', placeIt, true);
    };
  }, [open]);

  // A tap or a click anywhere else closes it.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const at = e.target as Node;
      if (!button.current?.contains(at) && !list.current?.contains(at)) setOpen(false);
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [open]);

  // The active option in view as the keys move it — by scrolling the list alone. (scrollIntoView scrolled the page too
  // in WebKit, to where the list sat for the moment before it was placed: on an iPhone the page jumped to its end and
  // the list opened off the screen.)
  useEffect(() => {
    const box = list.current;
    const option = open ? document.getElementById(optionId(active)) : null;
    if (!box || !option) return;
    const top = option.offsetTop;
    const bottom = top + option.offsetHeight;
    if (top < box.scrollTop) box.scrollTop = top;
    else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight;
  });

  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const key = e.key;
    if (!open) {
      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') {
        e.preventDefault();
        show(key === 'ArrowUp' && selected === -1 ? last() : undefined);
      }
      return;
    }
    if (key === 'ArrowDown') setActive((a) => step(a, 1));
    else if (key === 'ArrowUp') setActive((a) => step(a, -1));
    else if (key === 'Home' || key === 'PageUp') setActive(first());
    else if (key === 'End' || key === 'PageDown') setActive(last());
    else if (key === 'Enter' || key === ' ') choose(active);
    else if (key === 'Escape') setOpen(false);
    else if (key === 'Tab') {
      choose(active);
      return; // and on, as Tab goes
    } else if (key.length === 1) {
      // Typing a name: the next option that starts with what's typed (within half a second, a word).
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 500 ? typed.current.text : '') + key.toLowerCase(), at: now };
      const text = (o: SelectOption<T>) => (o.text ?? (typeof o.label === 'string' ? o.label : '')).toLowerCase();
      const n = options.length;
      for (let k = 1; k <= n; k++) {
        const i = (active + (typed.current.text.length > 1 ? 0 : 1) + k - 1) % n;
        if (enabled(i) && text(options[i]).startsWith(typed.current.text)) {
          setActive(i);
          break;
        }
      }
    } else return;
    // Handled here: not the page's, nor a dialog's (Escape would close it).
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <>
      <button
        ref={button}
        id={buttonId}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? optionId(active) : undefined}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKey}
        className={clsx(
          'field flex h-11 w-full min-w-0 items-center gap-2 rounded-2xl pr-3 pl-3 text-left text-sm disabled:opacity-60',
          open && 'border-violet-400/60',
          className,
        )}
      >
        {current?.icon && <span className="shrink-0">{current.icon}</span>}
        <span className={clsx('min-w-0 flex-1 truncate', !current && 'text-fg-3')}>
          {current ? current.label : placeholder}
        </span>
        <ChevronDown
          aria-hidden
          className={clsx('size-4 shrink-0 text-fg-2 transition-transform', open && 'rotate-180')}
        />
      </button>
      {open &&
        createPortal(
          // The listbox of the "select-only combobox": the focus stays on the button, which takes every key
          // (aria-activedescendant points at the option); its options aren't focused themselves.
          <div
            ref={list}
            id={listId}
            role="listbox"
            aria-labelledby={buttonId}
            tabIndex={-1}
            style={place}
            // Above a dialog (z-50); its own glass is solid enough to read over anything.
            className="fixed z-[60] overflow-y-auto rounded-2xl border border-line bg-ink-2 p-1.5 shadow-2xl shadow-black/40"
          >
            {options.map((o, i) => (
              // biome-ignore lint/a11y/useFocusableInteractive: the button keeps the focus (aria-activedescendant)
              // biome-ignore lint/a11y/useKeyWithClickEvents: the button takes the keys for the whole list
              <div
                key={String(o.value)}
                id={optionId(i)}
                role="option"
                aria-selected={i === selected}
                aria-disabled={o.disabled || undefined}
                // Down, not up: the button keeps the focus (a click would move it), and the choice is made at once.
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => choose(i)}
                onPointerMove={() => enabled(i) && active !== i && setActive(i)}
                className={clsx(
                  'flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm pointer-coarse:min-h-11',
                  i === active && 'bg-tint/10',
                  i === selected ? 'font-semibold text-fg' : 'text-fg-2',
                  o.disabled && 'cursor-default opacity-50',
                )}
              >
                {o.icon && <span className="shrink-0">{o.icon}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block">{o.label}</span>
                  {o.hint && <span className="block text-xs font-normal text-fg-3">{o.hint}</span>}
                </span>
                {i === selected && <Check aria-hidden className="size-4 shrink-0 text-violet-300" />}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

/**
 * A slider in the game's look (the track filled up to the thumb), on the native range input: its keys, its touch and
 * what a screen reader says stay the browser's.
 */
export function Slider({
  value,
  min,
  max,
  className,
  style,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'min' | 'max'> & {
  value: number;
  min: number;
  max: number;
}) {
  const fill = max > min ? ((Math.min(Math.max(value, min), max) - min) / (max - min)) * 100 : 0;
  return (
    <input
      {...rest}
      type="range"
      min={min}
      max={max}
      value={value}
      className={clsx('slider', className)}
      style={{ ...style, '--fill': `${fill}%` } as CSSProperties}
    />
  );
}

/**
 * A radio button in the game's look: the native input, unseen but there (focus, keys, the name it's read with), and
 * our round mark after it. `tone`: its colour when chosen (a text colour class). Put it in a <label> with its text.
 */
export function Radio({
  tone = 'text-violet-300',
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { tone?: string }) {
  return (
    <>
      <input {...rest} type="radio" className="choice" />
      <span aria-hidden className={clsx('choice-mark rounded-full', tone, className)} />
    </>
  );
}

/** A checkbox in the game's look: as Radio, a square mark with a tick. */
export function Checkbox({
  tone = 'text-violet-300',
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { tone?: string }) {
  return (
    <>
      <input {...rest} type="checkbox" className="choice" />
      <span aria-hidden className={clsx('choice-mark choice-box rounded-md', tone, className)}>
        <Check className="size-3.5" strokeWidth={3.5} />
      </span>
    </>
  );
}
