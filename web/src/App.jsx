import { useState } from "react";
import { Routes, Route, Link } from "react-router-dom";
import Home from "./pages/Home.jsx";
import SongPage from "./pages/SongPage.jsx";

export default function App() {
  const [theme, setTheme] = useState(
    () => document.documentElement.dataset.theme || "dark"
  );

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem("chordai-theme", next);
  }

  return (
    <div className="app">
      <header className="topbar no-print">
        <Link to="/" className="brand">
          <span className="brand-mark">♪</span>
          <span>ChordAI</span>
        </Link>
        <div className="topbar-spacer" />
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
      </main>
    </div>
  );
}
