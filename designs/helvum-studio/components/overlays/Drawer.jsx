export function Drawer({ title, children }) {
  return (
    <aside className="hs-drawer">
      <header className="hs-drawer__header"><strong>{title}</strong></header>
      <div className="hs-drawer__body">{children}</div>
    </aside>
  );
}

