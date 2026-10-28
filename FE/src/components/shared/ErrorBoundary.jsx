// src/components/shared/ErrorBoundary.jsx
import React from 'react';

/**
 * ErrorBoundary
 * -------------
 * Catches render-time errors in the entire subtree below it and shows
 * a friendly recovery UI instead of a blank white screen.
 *
 * Must be a class component — React only supports error boundaries via
 * class components with `componentDidCatch` and `getDerivedStateFromError`.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <App />
 *   </ErrorBoundary>
 *
 * Optional props:
 *   - onError: (error, info) => void  — hook for logging/telemetry
 *   - fallback: (error, reset) => JSX  — custom fallback UI
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Log to console in dev so you can still see the stack.
    // In production builds, this could be wired to a real error reporter
    // (Sentry, Rollbar, etc.) via the `onError` prop.
    if (import.meta.env.DEV) {
      console.error('🔴 Unhandled UI error:', error, errorInfo);
    }

    if (typeof this.props.onError === 'function') {
      try {
        this.props.onError(error, errorInfo);
      } catch (hookErr) {
        // Never let the error hook itself crash the boundary
        console.error('ErrorBoundary onError hook threw:', hookErr);
      }
    }

    this.setState({ errorInfo });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    // Clear local error state so the app re-mounts fresh.
    // This can recover from transient errors (e.g. a stale prop in a
    // controlled component that only breaks until state resets).
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    });
  };

  handleToggleDetails = () => {
    this.setState((prev) => ({ showDetails: !prev.showDetails }));
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    // Custom fallback wins if the caller provided one
    if (typeof this.props.fallback === 'function') {
      return this.props.fallback(this.state.error, this.handleReset);
    }

    const { error, errorInfo, showDetails } = this.state;
    const message = error?.message || 'An unexpected error occurred.';

    return (
      <div style={styles.root}>
        <div style={styles.card}>
          <div style={styles.iconWrap}>
            <span style={styles.icon}>⚠️</span>
          </div>

          <h1 style={styles.title}>Something went wrong</h1>
          <p style={styles.subtitle}>
            The page hit an unexpected error. You can try reloading the app,
            or go back to a clean state.
          </p>

          <div style={styles.messageBox}>
            <div style={styles.messageLabel}>Error</div>
            <div style={styles.messageText}>{message}</div>
          </div>

          <div style={styles.actions}>
            <button
              type="button"
              onClick={this.handleReset}
              style={{ ...styles.btn, ...styles.btnSecondary }}
            >
              🔄 Try Again
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              style={{ ...styles.btn, ...styles.btnPrimary }}
            >
              ↻ Reload Page
            </button>
          </div>

          <button
            type="button"
            onClick={this.handleToggleDetails}
            style={styles.detailsToggle}
          >
            {showDetails ? '▾ Hide technical details' : '▸ Show technical details'}
          </button>

          {showDetails && (
            <div style={styles.detailsBox}>
              <div style={styles.detailsLabel}>Stack trace</div>
              <pre style={styles.detailsPre}>
                {error?.stack || message}
              </pre>

              {errorInfo?.componentStack && (
                <>
                  <div style={{ ...styles.detailsLabel, marginTop: 12 }}>
                    Component stack
                  </div>
                  <pre style={styles.detailsPre}>
                    {errorInfo.componentStack}
                  </pre>
                </>
              )}
            </div>
          )}

          <div style={styles.footer}>
            Inventory Monitoring System · If this keeps happening, contact your administrator.
          </div>
        </div>
      </div>
    );
  }
}

/* ============================================================
   Inline styles — self-contained so the boundary renders even
   if the app's own CSS failed to load.
   ============================================================ */
const styles = {
  root: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 'clamp(16px, 4vw, 32px)',
    background: 'radial-gradient(circle at 20% 30%, #1a1f26 0%, #0a0c0f 80%)',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    color: '#e8edf2',
  },
  card: {
    width: '100%',
    maxWidth: 560,
    padding: 'clamp(24px, 4vw, 40px)',
    background: 'rgba(20, 25, 32, 0.85)',
    border: '1px solid rgba(0, 210, 200, 0.15)',
    borderRadius: 20,
    boxShadow:
      '0 25px 50px -12px rgba(0, 0, 0, 0.9), 0 0 40px rgba(0, 210, 200, 0.05)',
    textAlign: 'center',
  },
  iconWrap: {
    width: 64,
    height: 64,
    margin: '0 auto 18px',
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #fbbf24 0%, #d97706 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 8px 24px rgba(217, 119, 6, 0.4)',
  },
  icon: {
    fontSize: 32,
    lineHeight: 1,
  },
  title: {
    margin: '0 0 10px',
    fontSize: 22,
    fontWeight: 700,
    color: '#e8edf2',
    letterSpacing: '-0.01em',
  },
  subtitle: {
    margin: '0 0 22px',
    fontSize: 14,
    color: '#7a8699',
    lineHeight: 1.55,
  },
  messageBox: {
    padding: '12px 16px',
    background: 'rgba(255, 70, 70, 0.08)',
    border: '1px solid rgba(255, 70, 70, 0.2)',
    borderRadius: 12,
    textAlign: 'left',
    marginBottom: 22,
  },
  messageLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: '#ff8a8a',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    marginBottom: 4,
  },
  messageText: {
    fontSize: 13,
    color: '#ffb4b4',
    wordBreak: 'break-word',
    fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace",
    lineHeight: 1.5,
  },
  actions: {
    display: 'flex',
    gap: 10,
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginBottom: 16,
  },
  btn: {
    padding: '11px 22px',
    fontSize: 14,
    fontWeight: 700,
    borderRadius: 10,
    border: '1px solid transparent',
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'transform 0.15s ease, box-shadow 0.15s ease',
    minWidth: 140,
  },
  btnSecondary: {
    background: 'transparent',
    borderColor: 'rgba(255, 255, 255, 0.15)',
    color: '#8a99b0',
  },
  btnPrimary: {
    background: 'linear-gradient(145deg, #008a82, #00b8b0)',
    color: '#ffffff',
    boxShadow: '0 4px 20px rgba(0, 210, 200, 0.25)',
  },
  detailsToggle: {
    background: 'transparent',
    border: 'none',
    color: '#5a7a88',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    padding: '6px 10px',
    fontFamily: 'inherit',
    marginBottom: 12,
  },
  detailsBox: {
    padding: 14,
    background: 'rgba(0, 0, 0, 0.4)',
    border: '1px solid rgba(255, 255, 255, 0.06)',
    borderRadius: 10,
    textAlign: 'left',
    marginBottom: 16,
    maxHeight: 300,
    overflow: 'auto',
  },
  detailsLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    marginBottom: 6,
  },
  detailsPre: {
    margin: 0,
    fontSize: 11,
    lineHeight: 1.5,
    color: '#94a3b8',
    fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace",
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  footer: {
    marginTop: 18,
    paddingTop: 16,
    borderTop: '1px solid rgba(255, 255, 255, 0.06)',
    fontSize: 11,
    color: '#4a5568',
    lineHeight: 1.5,
  },
};

export default ErrorBoundary;