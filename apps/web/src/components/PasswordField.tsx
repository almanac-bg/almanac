import { Eye, EyeOff } from 'lucide-react';
import { type Ref, useId, useState } from 'react';
import { Field, INPUT } from './ui';

/**
 * A password with its label and a show/hide eye — one for every form that asks for one (sign-in and sign-up, saving a
 * guest, Settings, a new password). `invalid` marks it and points to `describedBy` (the form's error box).
 */
export function PasswordField({
  label = 'Парола',
  value,
  onChange,
  autoComplete,
  placeholder,
  invalid,
  describedBy,
  inputRef,
  minLength,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  placeholder?: string;
  invalid?: boolean;
  describedBy?: string;
  inputRef?: Ref<HTMLInputElement>;
  minLength?: number;
}) {
  const id = useId();
  const [show, setShow] = useState(false);
  return (
    <Field label={label} htmlFor={id}>
      <div className="relative">
        <input
          id={id}
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          type={show ? 'text' : 'password'}
          autoComplete={autoComplete}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          required
          minLength={minLength}
          placeholder={placeholder}
          className={`${INPUT} pr-12`}
        />
        <button
          type="button"
          onClick={() => setShow(!show)}
          aria-label={show ? 'Скрий паролата' : 'Покажи паролата'}
          className="focus-ring absolute top-1/2 right-0.5 grid size-11 -translate-y-1/2 place-items-center rounded-xl text-fg-3 hover:text-fg"
        >
          {show ? <EyeOff className="size-4.5" /> : <Eye className="size-4.5" />}
        </button>
      </div>
    </Field>
  );
}
