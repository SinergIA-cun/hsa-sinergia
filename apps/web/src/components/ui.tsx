import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type ReactNode,
} from 'react';
import { cn } from '../lib/cn.ts';

type Variant = 'primary' | 'gold' | 'outline' | 'ghost';

const variants: Record<Variant, string> = {
  primary: 'bg-ink text-cream hover:bg-ink-700 shadow-sm',
  gold: 'bg-gold text-cream hover:bg-gold-400 shadow-sm',
  outline: 'border border-ink/25 text-ink hover:border-ink/50 hover:bg-ink/5',
  ghost: 'text-ink hover:bg-ink/5',
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }
>(function Button({ className, variant = 'primary', ...props }, ref) {
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium tracking-wide',
        'transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-cream',
        variants[variant],
        className,
      )}
      {...props}
    />
  );
});

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.08em] text-ink-500">
        {label}
      </span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-charcoal-soft">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-wine">{error}</span>}
    </label>
  );
}

const inputBase =
  'w-full rounded-lg border border-ink/15 bg-white/70 px-3.5 py-2.5 text-sm text-charcoal ' +
  'placeholder:text-charcoal-soft/60 transition-colors ' +
  'focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30';

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function TextInput({ className, ...props }, ref) {
    return <input ref={ref} className={cn(inputBase, className)} {...props} />;
  },
);

export const SelectInput = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function SelectInput({ className, children, ...props }, ref) {
    return (
      <select ref={ref} className={cn(inputBase, 'appearance-none pr-9', className)} {...props}>
        {children}
      </select>
    );
  },
);

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-card)] border border-cream-300/80 bg-white/80 backdrop-blur',
        'shadow-[var(--shadow-card)]',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ArrowDivider({ children }: { children: ReactNode }) {
  return <div className="divider-arrow text-[0.7rem] uppercase tracking-[0.25em]">{children}</div>;
}
