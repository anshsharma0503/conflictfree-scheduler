/**
 * Dark illustration panel used beside the public pages.
 * Shows one meeting being moved out of an overlap into free time.
 */
function AuthAside() {
  return (
    <aside className="auth-aside" aria-label="About ConflictFree">
      <span className="auth-aside-kicker">CONFLICT RESOLVED · 14:00–16:00</span>

      <div className="demo-schedule" aria-hidden="true">
        <div className="demo-hours">
          <span>14:00</span>
          <span>14:30</span>
          <span>15:00</span>
          <span>15:30</span>
        </div>
        <div className="demo-track">
          <div className="demo-block demo-fixed">
            Budget sync
            <span>14:00–15:00</span>
          </div>
          <div className="demo-block demo-ghost">
            Vendor call
            <span>14:30–15:30</span>
          </div>
          <div className="demo-block demo-moved">
            Vendor call
            <span>15:00–16:00 · moved</span>
          </div>
        </div>
      </div>

      <div className="auth-aside-copy">
        <p>Book meetings that never overlap.</p>
        <p>
          ConflictFree checks your calendar, your participants and your rooms
          before anything is saved, then ranks the times that work for everyone.
        </p>
      </div>
    </aside>
  );
}

export default AuthAside;
