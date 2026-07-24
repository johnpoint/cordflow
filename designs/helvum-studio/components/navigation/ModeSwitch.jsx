export function ModeSwitch({
  label,
  checked = false,
  disabled = false,
  onLabel = 'On',
  offLabel = 'Off',
  onChange
}) {
  return (
    <label className={`hs-mode-switch ${disabled ? 'hs-mode-switch--disabled' : ''}`}>
      <span className="hs-mode-switch__label">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange?.(event.target.checked)}
      />
      <span className="hs-mode-switch__track" aria-hidden="true"><i></i></span>
      <strong>{checked ? onLabel : offLabel}</strong>
    </label>
  );
}
