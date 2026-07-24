export function NodeCard({ name, detail, children }) {
  return (
    <article className="hs-node-card">
      <header className="hs-node-card__header"><div><strong>{name}</strong><small>{detail}</small></div></header>
      <div className="hs-node-card__ports">{children}</div>
    </article>
  );
}

