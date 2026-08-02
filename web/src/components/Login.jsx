import { useEffect, useRef, useState } from "react";

let gsiPromise = null;

/** Load Google Identity Services once. */
function loadGoogleScript() {
  if (gsiPromise) return gsiPromise;
  gsiPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve(window.google);
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => resolve(window.google);
    script.onerror = () => reject(new Error("לא הצלחתי לטעון את ההתחברות של גוגל"));
    document.head.appendChild(script);
  });
  return gsiPromise;
}

export default function Login({ clientId, onSignedIn }) {
  const buttonRef = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    loadGoogleScript()
      .then((google) => {
        if (cancelled || !buttonRef.current) return;

        google.accounts.id.initialize({
          client_id: clientId,
          callback: async (response) => {
            try {
              const result = await fetch("/api/auth/google", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ credential: response.credential }),
              });
              const body = await result.json();
              if (!result.ok) throw new Error(body.error || "ההתחברות נכשלה");
              onSignedIn(body.user);
            } catch (err) {
              setError(err.message);
            }
          },
        });

        google.accounts.id.renderButton(buttonRef.current, {
          theme: "outline",
          size: "large",
          shape: "pill",
          text: "signin_with",
          locale: "he",
        });
      })
      .catch((err) => !cancelled && setError(err.message));

    return () => {
      cancelled = true;
    };
  }, [clientId, onSignedIn]);

  return (
    <div className="container">
      <div className="login-card">
        <div className="brand-mark" style={{ width: 46, height: 46, fontSize: 24 }}>
          ♪
        </div>
        <h1 style={{ fontSize: 24 }}>ChordAI</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          אקורדים ומילים מכל שיר. התחבר כדי לראות את הספרייה הפרטית שלך.
        </p>

        <div ref={buttonRef} style={{ display: "flex", justifyContent: "center" }} />

        {error && <div className="error-box">{error}</div>}

        <p className="faint" style={{ marginBottom: 0 }}>
          השירים שלך פרטיים ונראים רק לך.
        </p>
      </div>
    </div>
  );
}
