import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AuthAside from "../components/AuthAside";
import BrandMark from "../components/BrandMark";
import Icon from "../components/Icon";
import { useAuth } from "../context/AuthContext";
import { getGoogleLoginUrl } from "../services/authService";

function RegisterPage() {
  const navigate = useNavigate();
  const { registerWithEmail } = useAuth();
  const [formData, setFormData] = useState({
    name: "",
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
      await registerWithEmail(formData);
      navigate("/dashboard");
    } catch (registerError) {
      setError(registerError.message);
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
              <h1>Create your ConflictFree account</h1>
              <p className="lead">
                Register with email, or use Google to connect calendar access.
              </p>
            </div>

            <a className="btn btn-block" href={getGoogleLoginUrl()}>
              <Icon name="calendar" />
              Continue with Google
            </a>

            <div className="divider">or with email</div>

            <form className="auth-form" onSubmit={handleSubmit}>
              <label className="field">
                Name
                <input
                  name="name"
                  type="text"
                  autoComplete="name"
                  value={formData.name}
                  onChange={handleChange}
                  placeholder="Your name"
                  required
                />
              </label>

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
                  autoComplete="new-password"
                  value={formData.password}
                  onChange={handleChange}
                  placeholder="At least 8 characters"
                  minLength={8}
                  required
                />
              </label>

              {error ? (
                <p className="form-error" role="alert">
                  {error}
                </p>
              ) : null}

              <button className="btn btn-primary btn-block" type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Creating account..." : "Create account"}
              </button>
            </form>

            <p className="auth-switch">
              Already have an account? <Link to="/login">Sign in</Link>
            </p>
          </section>
        </div>
      </main>

      <AuthAside />
    </div>
  );
}

export default RegisterPage;
