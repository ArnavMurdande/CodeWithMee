import { useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { AuthContext } from '../context/AuthContext';
import { resolveBackendUrl } from '../config/runtime';
import { apiProblemCode } from '../lib/api';

// React StrictMode intentionally replays effects in development. Verification tokens are
// single-use, so both effect runs must observe the same request instead of consuming twice.
const emailVerificationAttempts = new Map();

function confirmEmailOnce(token, confirmEmailVerification) {
  if (!emailVerificationAttempts.has(token)) {
    emailVerificationAttempts.set(token, confirmEmailVerification(token));
  }
  return emailVerificationAttempts.get(token);
}

function authenticationMessage(error) {
  const code = apiProblemCode(error);
  const messages = {
    account_unavailable: 'This account is currently unavailable.',
    google_auth_unavailable: 'Google sign-in is not configured for this environment.',
    identity_not_configured: 'Authentication is not configured for this server environment.',
    invalid_credentials: 'The email or password is incorrect.',
    invalid_or_expired_token: 'This link is invalid or has expired.',
    origin_not_allowed: 'Requests from this web origin are not permitted.',
    password_compromised: 'Choose a password that has not appeared in known breaches.',
    password_policy_failed: 'Use a unique password between 12 and 128 characters.',
    registration_unavailable: 'An account with those details cannot be created.',
  };
  return (
    messages[code] ||
    error?.response?.data?.detail ||
    error?.response?.data?.message ||
    'The request could not be completed. Please try again.'
  );
}

const Auth = () => {
  const auth = useContext(AuthContext);
  const { confirmEmailVerification } = auth;
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const resetToken = searchParams.get('reset');
  const verificationToken = searchParams.get('verify');
  const initialMode = resetToken
    ? 'reset'
    : searchParams.get('mode') === 'forgot'
      ? 'forgot'
      : searchParams.get('mode') === 'verify-pending' ||
          (auth.isAuthenticated && auth.user?.emailVerified !== true)
        ? 'verify-pending'
        : 'login';
  const [mode, setMode] = useState(initialMode);
  const [form, setForm] = useState({ displayName: '', email: '', password: '' });
  const [error, setError] = useState(
    searchParams.get('error') === 'google_auth_failed'
      ? 'Google sign-in could not be completed.'
      : '',
  );
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [verifying, setVerifying] = useState(Boolean(verificationToken));
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (
      mode !== 'verify-pending' ||
      !auth.isAuthenticated ||
      auth.user?.emailVerified === true
    ) {
      return undefined;
    }
    let active = true;
    let redirectTimer;
    const checkVerification = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const currentUser = await auth.refreshCurrentUser();
        if (active && currentUser.emailVerified) {
          setVerifying(true);
          redirectTimer = window.setTimeout(
            () => navigate('/dashboard', { replace: true }),
            900,
          );
        }
      } catch {
        // Keep waiting; transient connectivity should not sign the user out.
      }
    };
    checkVerification();
    const interval = window.setInterval(checkVerification, 4000);
    const onVisible = () => checkVerification();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.clearTimeout(redirectTimer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [auth.isAuthenticated, auth.refreshCurrentUser, auth.user?.emailVerified, mode, navigate]);

  useEffect(() => {
    if (!verificationToken) return;
    let active = true;
    confirmEmailOnce(verificationToken, confirmEmailVerification)
      .then(() => {
        if (!active) return;
        setSearchParams({}, { replace: true });
        if (auth.isAuthenticated) {
          navigate('/dashboard', { replace: true });
        } else {
          setMode('login');
          setNotice('Email verified. Sign in to open your dashboard.');
        }
      })
      .catch((requestError) => {
        if (active) setError(authenticationMessage(requestError));
      })
      .finally(() => {
        if (active) setVerifying(false);
      });
    return () => {
      active = false;
    };
  }, [auth.isAuthenticated, confirmEmailVerification, navigate, setSearchParams, verificationToken]);

  const heading = useMemo(() => {
    if (mode === 'register') return 'Create your account';
    if (mode === 'forgot') return 'Reset your password';
    if (mode === 'reset') return 'Choose a new password';
    if (mode === 'verify-pending') return 'Check your email';
    return 'Welcome back';
  }, [mode]);

  const changeMode = (nextMode) => {
    setMode(nextMode);
    setError('');
    setNotice('');
  };

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setNotice('');
    setSubmitting(true);
    try {
      if (mode === 'login') {
        const signedInUser = await auth.signIn({ email: form.email, password: form.password });
        if (signedInUser.emailVerified) navigate('/dashboard', { replace: true });
        else {
          setMode('verify-pending');
          setNotice('Open the verification email we sent to continue.');
        }
      } else if (mode === 'register') {
        await auth.register({
          displayName: form.displayName,
          email: form.email,
          password: form.password,
        });
        setMode('verify-pending');
        setNotice('We sent a verification email. Open it and select Verify Email to continue.');
      } else if (mode === 'forgot') {
        await auth.requestPasswordReset(form.email);
        setNotice('If the account is eligible, password-reset instructions have been queued.');
      } else if (mode === 'reset') {
        await auth.resetPassword({ password: form.password, resetToken });
        setNotice('Password updated. Sign in again on every device.');
        setSearchParams({}, { replace: true });
        setMode('login');
        setForm((current) => ({ ...current, password: '' }));
      }
    } catch (requestError) {
      setError(authenticationMessage(requestError));
    } finally {
      setSubmitting(false);
    }
  };

  const startGoogleSignIn = () => {
    const returnTo = encodeURIComponent('/dashboard');
    window.location.assign(resolveBackendUrl(`/api/v1/auth/google/start?returnTo=${returnTo}`));
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1>{heading}</h1>
        <p className="auth-helper-text">
          One human account can learn, join providers, and hold scoped organization roles.
        </p>

        {verifying ? (
          <p className="auth-status" role="status">
            Verifying your email…
          </p>
        ) : mode === 'verify-pending' ? (
          <section
            aria-labelledby="verification-pending-title"
            className="auth-verification-pending"
          >
            <h2 id="verification-pending-title">Verification email sent</h2>
            <p className="auth-verification-copy">
              We sent a secure link to your email address. Open the message from CodeWithMee and
              select <strong>Verify Email</strong>.
            </p>
            <p className="auth-verification-hint">
              You can verify on this device, another browser, or your phone. This page will detect
              it and open your dashboard automatically.
            </p>
            {notice && (
              <p className="success-message" role="status">
                {notice}
              </p>
            )}
            {error && (
              <p className="error-message" role="alert">
                {error}
              </p>
            )}
            <div className="button-group auth-verification-actions">
              <button
                className="auth-button"
                disabled={submitting}
                onClick={async () => {
                  setSubmitting(true);
                  setError('');
                  try {
                    await auth.requestEmailVerification();
                    setNotice('A new verification email has been sent.');
                  } catch (requestError) {
                    setError(authenticationMessage(requestError));
                  } finally {
                    setSubmitting(false);
                  }
                }}
                type="button"
              >
                {submitting ? 'Sendingâ€¦' : 'Resend verification email'}
              </button>
              <button
                className="auth-button auth-button--secondary"
                onClick={auth.logout}
                type="button"
              >
                Sign out and use another account
              </button>
            </div>
          </section>
        ) : (
          <form onSubmit={submit}>
            {mode === 'register' && (
              <div className="form-group">
                <label htmlFor="displayName">Display name</label>
                <input
                  autoComplete="name"
                  id="displayName"
                  maxLength="80"
                  onChange={(event) => setForm({ ...form, displayName: event.target.value })}
                  required
                  type="text"
                  value={form.displayName}
                />
              </div>
            )}

            {mode !== 'reset' && (
              <div className="form-group">
                <label htmlFor="email">Email</label>
                <input
                  autoComplete="email"
                  id="email"
                  maxLength="254"
                  onChange={(event) => setForm({ ...form, email: event.target.value })}
                  required
                  type="email"
                  value={form.email}
                />
              </div>
            )}

            {mode !== 'forgot' && (
              <div className="form-group">
                <label htmlFor="password">Password</label>
                <div className="password-input-wrapper">
                  <input
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    id="password"
                    maxLength="128"
                    minLength={mode === 'login' ? 1 : 12}
                    onChange={(event) => setForm({ ...form, password: event.target.value })}
                    required
                    type={showPassword ? 'text' : 'password'}
                    value={form.password}
                  />
                  <button
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="password-toggle-button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    type="button"
                  >
                    {showPassword ? (
                      <svg
                        fill="none"
                        height="20"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        viewBox="0 0 24 24"
                        width="20"
                      >
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" x2="23" y1="1" y2="23" />
                      </svg>
                    ) : (
                      <svg
                        fill="none"
                        height="20"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        viewBox="0 0 24 24"
                        width="20"
                      >
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
                {mode !== 'login' && <small>Use 12–128 unique characters.</small>}
              </div>
            )}

            {error && (
              <p className="error-message" role="alert">
                {error}
              </p>
            )}
            {notice && (
              <p className="success-message" role="status">
                {notice}
              </p>
            )}

            <div className="button-group">
              <button className="auth-button" disabled={submitting} type="submit">
                {submitting
                  ? 'Please wait…'
                  : mode === 'login'
                    ? 'Sign in'
                    : mode === 'register'
                      ? 'Create account'
                      : mode === 'forgot'
                        ? 'Send reset instructions'
                        : 'Reset password'}
              </button>
              {mode === 'login' && (
                <button className="google-button" onClick={startGoogleSignIn} type="button">
                  <svg className="google-icon" viewBox="0 0 24 24" width="18" height="18">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.62z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    />
                  </svg>
                  <span>Continue with Google</span>
                </button>
              )}
            </div>
          </form>
        )}

        <div className="auth-mode-actions">
          {mode === 'login' && (
            <>
              <button
                className="switch-button"
                onClick={() => changeMode('register')}
                type="button"
              >
                Create an account
              </button>
              <button className="switch-button" onClick={() => changeMode('forgot')} type="button">
                Forgot password?
              </button>
            </>
          )}
          {mode !== 'login' && mode !== 'reset' && mode !== 'verify-pending' && (
            <button className="switch-button" onClick={() => changeMode('login')} type="button">
              Back to sign in
            </button>
          )}
        </div>

        <p className="provider-auth-note">
          Course providers sign in here, then create or join an organization with their verified
          email.
        </p>
      </div>
    </div>
  );
};

export default Auth;
