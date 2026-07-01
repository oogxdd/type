export function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mobile-native-group-wrap" aria-label={title}>
      <h3 className="mobile-native-group-title">{title}</h3>
      <div className="mobile-native-group">{children}</div>
    </section>
  );
}

export function ChoiceRow({
  label,
  subtitle,
  selected,
  onClick,
}: {
  label: string;
  subtitle?: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className="mobile-native-row choice" onClick={onClick} aria-pressed={selected}>
      <span className="mobile-native-row-main">
        <span className="mobile-native-row-label">{label}</span>
        {subtitle ? <span className="mobile-native-row-sub">{subtitle}</span> : null}
      </span>
      <span className={`mobile-native-check${selected ? " active" : ""}`} aria-hidden>
        {selected ? "\u2713" : ""}
      </span>
    </button>
  );
}

export function InputRow({
  label,
  value,
  onChange,
  placeholder,
  password,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  password?: boolean;
  disabled?: boolean;
}) {
  return (
    <label className="mobile-native-input-row">
      <span className="mobile-native-input-label">{label}</span>
      <input
        type={password ? "password" : "text"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoCapitalize="off"
        autoCorrect="off"
        disabled={disabled}
      />
    </label>
  );
}

export function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="mobile-native-row stat">
      <span className="mobile-native-row-label">{label}</span>
      <span className="mobile-native-row-value">{value}</span>
    </div>
  );
}
