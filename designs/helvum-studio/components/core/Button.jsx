export function Button({ children, variant = 'default', disabled = false, onClick, type = 'button' }) {
  return (
    <button
      className={`hs-button hs-button--${variant}`}
      type={type}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

