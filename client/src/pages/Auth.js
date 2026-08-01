import { useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { AuthContext } from '../context/AuthContext';
import { resolveBackendUrl } from '../config/runtime';
import { apiProblemCode } from '../lib/api';

function authenticationMessage(error) {
  const code = apiProblemCode(error);
  const messages = {
    account_unavailable: 'This account is currently unavailable.',
    google_auth_unavailable: 'Google sign-in is not configured for this environment.',
    invalid_credentials: 'The email or password is incorrect.',
    invalid_or_expired_token: 'This link is invalid or has expired.',
    password_compromised: 'Choose a password that has not appeared in known breaches.',
    password_policy_failed: 'Use a unique password between 12 and 128 characters.',
    registration_unavailable: 'An account with those details cannot be created.',
  };
  return messages[code] || 'The request could not be completed. Please try again.';
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

  useEffect(() => {
    if (!verificationToken) return;
    let active = true;
    confirmEmailVerification(verificationToken)
      .then(() => {
        if (!active) return;
        setNotice('Email verified. You can now sign in or continue learning.');
        setSearchParams({}, { replace: true });
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
  }, [confirmEmailVerification, setSearchParams, verificationToken]);

  const heading = useMemo(() => {
    if (mode === 'register') return 'Create your account';
    if (mode === 'forgot') return 'Reset your password';
    if (mode === 'reset') return 'Choose a new password';
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
        await auth.signIn({ email: form.email, password: form.password });
        navigate('/dashboard', { replace: true });
      } else if (mode === 'register') {
        await auth.register({
          displayName: form.displayName,
          email: form.email,
          password: form.password,
        });
        navigate('/dashboard', { replace: true });
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
                <input
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  id="password"
                  maxLength="128"
                  minLength={mode === 'login' ? 1 : 12}
                  onChange={(event) => setForm({ ...form, password: event.target.value })}
                  required
                  type="password"
                  value={form.password}
                />
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
                  Continue with Google
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
          {mode !== 'login' && mode !== 'reset' && (
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
