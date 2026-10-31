export function StatusBar() {
  return (
    <footer className="status-bar" aria-label="Status">
      <span className="status-item" data-testid="status-coords">X —  Y —</span>
      <span className="status-item" data-testid="status-tool">No tool</span>
      <span className="status-item" data-testid="status-snap">Snaps: off</span>
      <span className="status-spacer" />
      <span className="status-item" data-testid="status-level">No level</span>
    </footer>
  );
}
