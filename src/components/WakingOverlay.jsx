function WakingOverlay({ onDismiss }) {
  return (
    <div className="waking-overlay" role="status" aria-live="polite">
      <div className="waking-overlay-card">
        <div className="waking-spinner" aria-hidden="true" />
        <p className="waking-title">Waking up the voice server…</p>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          The first request of the day can take up to a minute. Thanks for your patience!
        </p>
        <button className="btn-ghost" style={{ marginTop: '1rem' }} onClick={onDismiss}>
          Continue anyway
        </button>
      </div>
    </div>
  );
}

export default WakingOverlay;
