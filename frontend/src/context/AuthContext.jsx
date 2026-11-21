import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  clearStoredUser,
  getCurrentUser,
  getStoredUser,
  loginUser,
  logout,
  registerUser,
  saveStoredUser,
} from "../services/authService";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => getStoredUser());
  const [isLoadingUser, setIsLoadingUser] = useState(true);
  // Incremented on every explicit auth change (login, register, logout,
  // OAuth callback). A slower initial /api/auth/me response must never
  // overwrite a newer explicit auth state.
  const authVersionRef = useRef(0);

  useEffect(() => {
    const versionAtStart = authVersionRef.current;

    async function loadCurrentUser() {
      try {
        const currentUser = await getCurrentUser();

        if (authVersionRef.current === versionAtStart) {
          setUser(currentUser);
        }
      } catch {
        if (authVersionRef.current === versionAtStart) {
          clearStoredUser();
          setUser(null);
        }
      } finally {
        setIsLoadingUser(false);
      }
    }

    loadCurrentUser();
  }, []);

  const setAuthUser = useCallback((nextUser) => {
    authVersionRef.current += 1;
    saveStoredUser(nextUser);
    setUser(nextUser);
  }, []);

  const registerWithEmail = useCallback(async (formData) => {
    const registeredUser = await registerUser(formData);

    authVersionRef.current += 1;
    saveStoredUser(registeredUser);
    setUser(registeredUser);

    return registeredUser;
  }, []);

  const loginWithEmail = useCallback(async (formData) => {
    const loggedInUser = await loginUser(formData);

    authVersionRef.current += 1;
    saveStoredUser(loggedInUser);
    setUser(loggedInUser);

    return loggedInUser;
  }, []);

  const logoutUser = useCallback(async () => {
    authVersionRef.current += 1;
    await logout();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: Boolean(user),
      isLoadingUser,
      setAuthUser,
      registerWithEmail,
      loginWithEmail,
      logoutUser,
    }),
    [
      user,
      isLoadingUser,
      setAuthUser,
      registerWithEmail,
      loginWithEmail,
      logoutUser,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }

  return context;
}