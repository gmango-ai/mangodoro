import { Component } from "react";

// Catches render/runtime errors in its subtree so a single throw can't blank
// the whole window (in Electron an unmounted tree shows the bare window —
// reading as a teal/accent void). Renders a readable fallback with the error
// instead, and logs it to the console.
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

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error);
    return (
      <div
        style={{
          minHeight: "100%",
          width: "100%",
          background: "#ffffff",
          color: "#0f172a",
          padding: 16,
          overflow: "auto",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Something went wrong</p>
        <pre style={{ fontSize: 11, whiteSpace: "pre-wrap", wordBreak: "break-word", color: "#b91c1c", margin: 0 }}>
          {String(error?.message || error)}
        </pre>
      </div>
    );
  }
}
