export function StatusBadge({ children, tone = 'neutral' }) {
  return <span className={`hs-status-badge hs-status-badge--${tone}`}>{children}</span>;
}

