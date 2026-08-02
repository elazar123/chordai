import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { OAuth2Client } from "google-auth-library";
import { config } from "../config.js";

const COOKIE = "chordai_session";
const MAX_AGE_DAYS = 30;

/**
 * Sign-in is only enforced when a Google client id is configured. Without one
 * the app runs as a single-user tool on localhost, which is how it starts life.
 */
export const authEnabled = () => Boolean(config.googleClientId);

const client = new OAuth2Client(config.googleClientId);

/** A stable secret so sessions survive a restart, generated on first run. */
function sessionSecret() {
  if (process.env.CHORDAI_SESSION_SECRET) return process.env.CHORDAI_SESSION_SECRET;

  const file = path.join(config.dataDir, ".session-secret");
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();

  const secret = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

const SECRET = sessionSecret();

function sign(data) {
  return crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
}

function encodeSession(user) {
  const payload = Buffer.from(
    JSON.stringify({ ...user, exp: Date.now() + MAX_AGE_DAYS * 864e5 })
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function decodeSession(token) {
  if (!token || !token.includes(".")) return null;
  const [payload, signature] = token.split(".");

  // timingSafeEqual throws on length mismatch, so compare digests of fixed size.
  const expected = sign(payload);
  if (
    expected.length !== signature.length ||
    !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  ) {
    return null;
  }

  try {
    const user = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return user.exp > Date.now() ? user : null;
  } catch {
    return null;
  }
}

/** Marks an error as safe to show the user, unlike internal library failures. */
function expose(message) {
  const error = new Error(message);
  error.expose = true;
  return error;
}

/** Verify a Google ID token and return the user it identifies. */
export async function verifyGoogleToken(credential) {
  const ticket = await client.verifyIdToken({
    idToken: credential,
    audience: config.googleClientId,
  });
  const payload = ticket.getPayload();
  if (!payload?.email_verified) throw expose("כתובת המייל לא אומתה על ידי גוגל");

  if (config.allowedEmails.length && !config.allowedEmails.includes(payload.email)) {
    throw expose("החשבון הזה לא מורשה להשתמש במערכת");
  }

  return { id: payload.sub, email: payload.email, name: payload.name, picture: payload.picture };
}

export function setSessionCookie(res, user) {
  res.cookie(COOKIE, encodeSession(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: config.secureCookies,
    maxAge: MAX_AGE_DAYS * 864e5,
    path: "/",
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE, { path: "/" });
}

/** Attaches req.user when a valid session is present. Never rejects. */
export function readSession(req, _res, next) {
  // In local mode the id stays null, which switches off owner filtering entirely
  // rather than scoping everything to a fake "local" user.
  req.user = authEnabled()
    ? decodeSession(req.cookies?.[COOKIE])
    : { id: null, local: true };
  next();
}

/** Blocks the request when sign-in is required and missing. */
export function requireAuth(req, res, next) {
  if (!authEnabled()) return next();
  if (!req.user) return res.status(401).json({ error: "נדרשת התחברות" });
  next();
}

/** Songs are private: a user only ever sees their own. */
export function ownsSong(user, song) {
  if (!authEnabled()) return true;
  return song.owner === user?.id;
}
