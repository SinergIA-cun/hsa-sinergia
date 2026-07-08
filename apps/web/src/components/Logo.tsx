import { cn } from '../lib/cn.ts';

export function Logo({ className, tone = 'ink' }: { className?: string; tone?: 'ink' | 'cream' }) {
  const color = tone === 'cream' ? 'text-cream' : 'text-ink';
  return (
    <div className={cn('flex flex-col items-center leading-none', color, className)}>
      <span className="font-display text-[1.35rem] font-600 tracking-tight">
        Hacienda San Andrés
      </span>
      <span className="mt-1 flex items-center gap-2 text-[0.55rem] uppercase tracking-[0.35em] text-gold">
        <span className="h-px w-4 bg-gold/70" />
        1894
        <span className="h-px w-4 bg-gold/70" />
      </span>
    </div>
  );
}
