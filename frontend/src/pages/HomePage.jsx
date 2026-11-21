import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import AuthAside from "../components/AuthAside";
import BrandMark from "../components/BrandMark";
import Icon from "../components/Icon";
import { useAuth } from "../context/AuthContext";
import { getHealthStatus } from "../services/healthService";

function getInitials(name = "") {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function HomePage() {
  const [apiStatus, setApiStatus] = useState("Checking API...");
  const [apiIsHealthy, setApiIsHealthy] = useState(false);
  const { user, logoutUser } = useAuth();

  useEffect(() => {
    let isActive = true;

    getHealthStatus()
      .then((response) => {
        if (isActive) {
          setApiStatus(response.message);
          setApiIsHealthy(true);
        }
      })
      .catch(() => {
        if (isActive) {
          setApiStatus("Unable to connect to the API");
          setApiIsHealthy(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, []);

  return (
    <div className="auth-layout">
      <main className="auth-main">
        <BrandMark />

        <div className="auth-center">
          <section className="auth-card">
            <div>
              <h1>ConflictFree</h1>
              <p className="lead">
                Smart scheduling that checks calendars, people and rooms before
                anything is booked, then ranks the times that work for everyone.
              </p>
            </div>

            {user ? (
              <>
                <div className="home-user">
                  {user.avatarUrl ? (
                    <img className="avatar" src={user.avatarUrl} alt={user.name} />
                  ) : (
                    <span className="avatar" aria-hidden="true">
                      {getInitials(user.name)}
                    </span>
                  )}
                  <div>
                    <span className="user-name">{user.name}</span>
                    <span className="user-email">{user.email}</span>
                  </div>
                </div>

                <Link className="btn btn-primary btn-block" to="/dashboard">
                  Open dashboard
                  <Icon name="arrowRight" size={16} strokeWidth={2} />
                </Link>

                <button className="btn btn-block" type="button" onClick={logoutUser}>
                  Log out
                </button>
              </>
            ) : (
              <>
                <p className="muted">
                  Sign in with Google to connect your calendar and start scheduling.
                </p>

                <Link className="btn btn-primary btn-block" to="/login">
                  Sign in
                </Link>
              </>
            )}
          </section>
        </div>

        <div className="auth-foot">
          <span className="api-status" role="status">
            <span className={apiIsHealthy ? "dot dot-free" : "dot"} aria-hidden="true" />
            <span>{apiStatus}</span>
          </span>
        </div>
      </main>

      <AuthAside />
    </div>
  );
}

export default HomePage;
