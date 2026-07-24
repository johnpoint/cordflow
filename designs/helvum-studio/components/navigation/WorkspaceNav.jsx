export function WorkspaceNav({ items, activeId, onChange }) {
  return (
    <nav className="hs-workspace-nav" aria-label="Workspaces">
      {items.map((item) => (
        <button
          key={item.id}
          className={`hs-workspace-nav__item ${item.id === activeId ? 'hs-workspace-nav__item--active' : ''}`}
          type="button"
          aria-current={item.id === activeId ? 'page' : undefined}
          onClick={() => onChange?.(item.id)}
        >
          {item.icon ? <span aria-hidden="true">{item.icon}</span> : null}
          <span><strong>{item.label}</strong><small>{item.description}</small></span>
        </button>
      ))}
    </nav>
  );
}
