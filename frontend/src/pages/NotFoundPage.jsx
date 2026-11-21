import { Link } from "react-router-dom";

function NotFoundPage() {
  return (
    <main className="simple-page">
      <section className="simple-card">
        <span className="kicker">404</span>
        <h1>Page not found</h1>
        <p>The page you requested does not exist.</p>
        <div className="button-row">
          <Link className="btn btn-primary" to="/">
            Return home
          </Link>
        </div>
      </section>
    </main>
  );
}

export default NotFoundPage;
