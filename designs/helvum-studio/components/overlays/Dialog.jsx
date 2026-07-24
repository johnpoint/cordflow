export function Dialog({ title, description, children, footer, onClose }) {
  return (
    <div className="hs-dialog-backdrop">
      <section className="hs-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <header className="hs-dialog__header">
          <div><strong>{title}</strong>{description ? <p>{description}</p> : null}</div>
          <button className="hs-icon-button" type="button" aria-label="Close" onClick={onClose}>×</button>
        </header>
        <div className="hs-dialog__body">{children}</div>
        {footer ? <footer className="hs-dialog__footer">{footer}</footer> : null}
      </section>
    </div>
  );
}

