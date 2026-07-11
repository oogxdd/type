import type { ReactNode, SelectHTMLAttributes } from "react";

const cardBase =
  "space-y-3 rounded-lg border border-border/60 bg-card/40 p-4";

export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          {title}
        </h2>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

export function SettingsCard({
  title,
  description,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className ? `${cardBase} ${className}` : cardBase}>
      {title || description ? (
        <div className="space-y-1">
          {title ? (
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          ) : null}
          {description ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function SettingsField({
  label,
  children,
  hint,
}: {
  label: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="grid gap-2 text-sm">
      <span className="font-medium text-foreground">{label}</span>
      {children}
      {hint ? (
        <span className="text-xs leading-relaxed text-muted-foreground">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export function SettingsSelect({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none ring-offset-background transition-colors focus-visible:border-ring/50 focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 ${
        className ?? ""
      }`}
    />
  );
}

export function SettingsInfoGrid({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-md border border-border/50">
      {children}
    </div>
  );
}

export function SettingsInfoRow({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/50 px-3 py-2 text-sm last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-foreground">{children}</span>
    </div>
  );
}

export function SettingsActionRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>;
}

export function SettingsHelpText({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={
        className ??
        "text-xs leading-relaxed text-muted-foreground"
      }
    >
      {children}
    </p>
  );
}

export function SettingsErrorText({ children }: { children: ReactNode }) {
  return <p className="text-xs text-destructive">{children}</p>;
}

export function SettingsCheckRow({
  checked,
  onChange,
  disabled,
  label,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: ReactNode;
  description?: ReactNode;
}) {
  return (
    <label className="flex items-start gap-3 text-sm text-foreground">
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 rounded border-border"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="grid gap-0.5">
        <span className="font-medium">{label}</span>
        {description ? (
          <span className="text-xs leading-relaxed text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
}
