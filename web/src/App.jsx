import { useCallback, useEffect, useState } from "react";
import { Routes, Route, Link } from "react-router-dom";
import Home from "./pages/Home.jsx";
import SongPage from "./pages/SongPage.jsx";
import Login from "./components/Login.jsx";
import { api } from "./lib/api.js";

export default function App() {
  const [theme, setTheme] = useState(
    () => document.documentElement.dataset.theme || "dark"
  );
  const [session, setSession] = useState(null);

  useEffect(() => {
    api
      .session()
      .then(setSession)
      // A failure here should not blank the app; fall back to open local mode.
      .catch(() => setSession({ authEnabled: false, user: null }));
  }, []);

  const onSignedIn = useCallback(
    (user) => setSession((previous) => ({ ...previous, user })),
    []
  );

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem("chordai-theme", next);
  }

  async function logout() {
    await api.logout().catch(() => {});
    setSession((previous) => ({ ...previous, user: null }));
  }

  if (!session) {
    return <div className="container"><div className="empty">טוען…</div></div>;
  }

  const needsLogin = session.authEnabled && !session.user;

  return (
    <div className="app">
      <header className="topbar no-print">
        <Link to="/" className="brand">
          <span className="brand-mark">♪</span>
          <span>ChordAI</span>
        </Link>
        <div className="topbar-spacer" />

        {session.user && (
          <div className="account">
            {session.user.picture && (
              <img className="avatar" src={session.user.picture} alt="" referrerPolicy="no-referrer" />
            )}
            <span className="account-name">{session.user.name || session.user.email}</span>
            <button className="btn btn-ghost" onClick={logout}>יציאה</button>
          </div>
        )}

        <button
          className="btn btn-ghost btn-icon"
          onClick={toggleTheme}
          title={theme === "dark" ? "מצב בהיר" : "מצב כהה"}
          aria-label="החלפת ערכת נושא"
        >
          {theme === "dark" ? "☀" : "☾"}
        </button>
      </header>

      <main>
        {needsLogin ? (
          <Login clientId={session.clientId} onSignedIn={onSignedIn} />
        ) : (
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/song/:id" element={<SongPage />} />
            <Route
              path="*"
              element={
                <div className="container">
                  <div className="empty">הדף לא נמצא</div>
                </div>
              }
            />
          </Routes>
        )}
      </main>
    </div>
  );
}
