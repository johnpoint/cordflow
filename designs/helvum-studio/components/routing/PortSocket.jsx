export function PortSocket({ name, id, media = 'audio', direction = 'output', selected = false, onClick }) {
  return (
    <button
      className={`hs-port-socket hs-port-socket--${media}`}
      type="button"
      aria-pressed={selected}
      aria-label={`${name}, ${media}, ${direction}, port ${id}`}
      onClick={onClick}
    >
      <span className="hs-port-socket__dot" aria-hidden="true"></span>
      <span>{name}</span>
      <small>{media} · P{id}</small>
    </button>
  );
}

