import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props { children: ReactNode; }
interface State { hasError: boolean; error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          height: '100%', padding: '40px', textAlign: 'center',
          background: '#1a1a2e', borderRadius: '12px', margin: '20px',
        }}>
          <h2 style={{ color: '#ef4444', marginBottom: '12px', fontSize: '20px' }}>Something went wrong</h2>
          <p style={{ color: '#9ca3af', marginBottom: '8px', fontSize: '14px' }}>
            {this.state.error?.message || 'An unexpected error occurred'}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: '16px', padding: '10px 24px', background: '#e94560', color: '#fff',
              border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '14px',
            }}
          >
            Reload App
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
