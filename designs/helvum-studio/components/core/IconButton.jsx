export function IconButton({ label, children, disabled = false, onClick }) {
  return (
    <button
      className="hs-icon-button"
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <span aria-hidden="true">{children}</span>
    </button>
  );
}

