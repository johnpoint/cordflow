export function ConnectionRow({ from, to, media = 'Audio', selected = false, action = null }) {
  return (
    <article className="hs-connection-row" aria-current={selected ? 'true' : undefined}>
      <span className={`hs-port-socket__dot hs-port-socket--${media.toLowerCase()}`} aria-hidden="true"></span>
      <div className="hs-connection-row__route"><strong>{from} → {to}</strong><small>{media} · Active</small></div>
      {action}
    </article>
  );
}

