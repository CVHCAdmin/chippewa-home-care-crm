// ErrorBoundary.jsx - Catches component crashes so the whole app doesn't go down
import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    // Log to console — in production you'd send to Sentry or similar
    console.error('[ErrorBoundary] Component crash:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '40px 24px',
          textAlign: 'center',
          fontFamily: 'system-ui, sans-serif',
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <h2 style={{ color: '#DC2626', marginBottom: 8 }}>Something went wrong</h2>
          <p style={{ color: '#6B7280', marginBottom: 24, maxWidth: 400, margin: '0 auto 24px' }}>
            This section crashed unexpectedly. The rest of the app is still working.
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null, errorInfo: null })}
            style={{
              background: '#3B82F6', color: '#fff', border: 'none',
              borderRadius: 8, padding: '10px 24px', fontWeight: 600,
              fontSize: 14, cursor: 'pointer',
            }}
          >
            Try Again
          </button>
          {process.env.NODE_ENV === 'development' && this.state.error && (
            <details style={{ marginTop: 24, textAlign: 'left', maxWidth: 600, margin: '24px auto 0' }}>
              <summary style={{ cursor: 'pointer', color: '#6B7280', fontSize: 13 }}>Error details (dev only)</summary>
              <pre style={{ fontSize: 11, overflow: 'auto', background: '#F3F4F6', padding: 12, borderRadius: 6, marginTop: 8 }}>
                {this.state.error.toString()}
                {this.state.errorInfo?.componentStack}
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

// Wrap any component with this for targeted protection
export function withErrorBoundary(Component, fallback = null) {
  return function WrappedWithBoundary(props) {
    return (
      <ErrorBoundary fallback={fallback}>
        <Component {...props} />
      </ErrorBoundary>
    );
  };
}
