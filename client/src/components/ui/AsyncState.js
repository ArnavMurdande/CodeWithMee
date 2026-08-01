import './AsyncState.css';

const STATE_ROLE = Object.freeze({
  empty: 'status',
  error: 'alert',
  loading: 'status',
});

export function AsyncState({
  action = null,
  compact = false,
  description,
  label,
  title,
  type = 'loading',
}) {
  const normalizedType = Object.prototype.hasOwnProperty.call(STATE_ROLE, type) ? type : 'error';
  const accessibleLabel = label || title || (normalizedType === 'loading' ? 'Loading' : 'Status');

  return (
    <section
      aria-busy={normalizedType === 'loading' ? 'true' : undefined}
      aria-label={accessibleLabel}
      aria-live={normalizedType === 'error' ? 'assertive' : 'polite'}
      className={`cwm-async-state cwm-async-state--${normalizedType}${compact ? ' cwm-async-state--compact' : ''}`}
      role={STATE_ROLE[normalizedType]}
    >
      {normalizedType === 'loading' ? (
        <span aria-hidden="true" className="cwm-async-state__spinner" />
      ) : (
        <span aria-hidden="true" className="cwm-async-state__mark">
          {normalizedType === 'error' ? '!' : '—'}
        </span>
      )}
      <div className="cwm-async-state__copy">
        <h2>{title || (normalizedType === 'loading' ? 'Loading…' : 'Nothing here yet')}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {action ? <div className="cwm-async-state__action">{action}</div> : null}
    </section>
  );
}

export function InlineStatus({ children, tone = 'neutral' }) {
  const normalizedTone = ['danger', 'info', 'neutral', 'success', 'warning'].includes(tone)
    ? tone
    : 'neutral';
  return (
    <p
      aria-live={normalizedTone === 'danger' ? 'assertive' : 'polite'}
      className={`cwm-inline-status cwm-inline-status--${normalizedTone}`}
      role={normalizedTone === 'danger' ? 'alert' : 'status'}
    >
      {children}
    </p>
  );
}
