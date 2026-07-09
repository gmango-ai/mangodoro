import { Component } from "react";

// Catches render/runtime errors in its subtree so a single throw can't blank
// the whole window (an unmounted tree shows a bare/void screen). Renders a
// readable, RECOVERABLE fallback instead of a dead blank screen, and logs it.
//
// Recovery:
//   - "Try again" clears the error and re-renders the subtree.
//   - "Reload app" hard-reloads.
//   - `resetKey` (e.g. the route pathname): when it changes the boundary clears
//     itself automatically, so navigating away from a broken page recovers.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", this.props.label || "", error, info?.componentStack);
  }

  componentDidUpdate(prevProps) {
    // Auto-recover when the reset key changes (e.g. the user navigated away).
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, () => this.setState({ error: null }));
    const btn = {
      appearance: "none",
      border: "1px solid rgba(148,163,184,.4)",
      background: "transparent",
      color: "inherit",
      borderRadius: 8,
      padding: "8px 14px",
      fontSize: 13,
      fontWeight: 600,
      cursor: "pointer",
    };
    return (
      <div
        role="alert"
        style={{
          minHeight: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
          background: "var(--color-bg, #0b1220)",
          color: "var(--color-text, #e2e8f0)",
          padding: 24,
          textAlign: "center",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <p style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Something went wrong</p>
        <pre
          style={{
            fontSize: 11,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            color: "#f87171",
            margin: 0,
            maxWidth: 560,
            maxHeight: 160,
            overflow: "auto",
          }}
        >
          {String(error?.message || error)}
        </pre>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
          <button type="button" style={btn} onClick={() => this.setState({ error: null })}>Try again</button>
          <button
            type="button"
            style={{ ...btn, borderColor: "var(--color-accent, #34d399)", color: "var(--color-accent, #34d399)" }}
            onClick={() => { try { window.location.reload(); } catch { /* */ } }}
          >
            Reload app
          </button>
        </div>
      </div>
    );
  }
}
