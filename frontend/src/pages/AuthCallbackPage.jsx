import { useEffect, useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

/**
 * Reads the OAuth callback query string once per render.
 * Returns either { user } or { error } so the page can render the outcome
 * without storing derived state.
 */
function readCallback(searchParams) {
  const authError = searchParams.get("error");

  if (authError) {
    return { error: authError };
  }

  const userParam = searchParams.get("user");

  if (!userParam) {
    return { error: "Authentication response is missing user data" };
  }

  try {
    return { user: JSON.parse(userParam) };
  } catch {
    return { error: "Unable to read authentication response" };
  }
}

function AuthCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { setAuthUser } = useAuth();
  const result = useMemo(() => readCallback(searchParams), [searchParams]);

  useEffect(() => {
    if (result.user) {
      setAuthUser(result.user);
      navigate("/", { replace: true });
    }
  }, [navigate, result, setAuthUser]);

  return (
    <main className="simple-page">
      <section className="simple-card">
        <span className="kicker">Authentication</span>
        <h1>{result.error ? "Login failed" : "Completing login..."}</h1>

        {result.error ? (
          <>
            <p>{result.error}</p>
            <div className="button-row">
              <Link className="btn btn-primary" to="/login">
                Try again
              </Link>
            </div>
          </>
        ) : (
          <p>Please wait while ConflictFree saves your login session.</p>
        )}
      </section>
    </main>
  );
}

export default AuthCallbackPage;
