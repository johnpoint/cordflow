export function Notice({ children, tone = 'neutral', action = null }) {
  return (
    <div className={`hs-notice hs-notice--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <div className="hs-notice__body">{children}</div>
      {action}
    </div>
  );
}

