import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AuthAside from "../components/AuthAside";
import BrandMark from "../components/BrandMark";
import Icon from "../components/Icon";
import { useAuth } from "../context/AuthContext";
import { getGoogleLoginUrl } from "../services/authService";

function LoginPage() {
  const navigate = useNavigate();
  const { loginWithEmail } = useAuth();
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function handleChange(event) {
    const { name, value } = event.target;

    setFormData((currentData) => ({
      ...currentData,
      [name]: value,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      await loginWithEmail(formData);
      navigate("/dashboard");
    } catch (loginError) {
      setError(loginError.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="auth-layout">
      <main className="auth-main">
        <BrandMark />

        <div className="auth-center">
          <section className="auth-card">
            <div>
              <h1>Sign in to ConflictFree</h1>
              <p className="lead">
                Use Google to bring your calendar in, or sign in with email.
              </p>
            </div>

            <a className="btn btn-block" href={getGoogleLoginUrl()}>
              <Icon name="calendar" />
              Continue with Google
            </a>

            <div className="divider">or with email</div>

            <form className="auth-form" onSubmit={handleSubmit}>
              <label className="field">
                Email
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={formData.email}
                  onChange={handleChange}
                  placeholder="you@example.com"
                  required
                />
              </label>

              <label className="field">
                Password
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  value={formData.password}
                  onChange={handleChange}
                  placeholder="Your password"
                  required
                />
              </label>

              {error ? (
                <p className="form-error" role="alert">
                  {error}
                </p>
              ) : null}

              <button className="btn btn-primary btn-block" type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Signing in..." : "Sign in"}
              </button>
            </form>

            <p className="auth-switch">
              New here? <Link to="/register">Create an account</Link>
            </p>
          </section>
        </div>
      </main>

      <AuthAside />
    </div>
  );
}

export default LoginPage;
