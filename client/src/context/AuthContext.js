import { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import apiClient, { refreshAuthentication } from '../lib/api';
import {
  clearAccessToken,
  getAccessToken,
  setAccessToken,
  subscribeToAccessToken,
} from '../lib/auth-session';
import { cleanupObsoleteStorageKeys, clearUserScopedStorage } from '../lib/cache-isolation';

export const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [token, setTokenState] = useState(getAccessToken());
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const channelRef = useRef(null);

  const establishSession = useCallback((result) => {
    setAccessToken(result.accessToken);
    setUser(result.user);
    return result.user;
  }, []);

  const refreshSession = useCallback(async () => {
    const result = await refreshAuthentication();
    establishSession(result);
    return result;
  }, [establishSession]);

  useEffect(
    () =>
      subscribeToAccessToken((nextToken) => {
        setTokenState(nextToken);
        if (!nextToken) setUser(null);
      }),
    [],
  );

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return undefined;
    const channel = new BroadcastChannel('codewithmee-auth');
    channelRef.current = channel;
    channel.onmessage = async (event) => {
      if (event.data?.type === 'signed_out') {
        clearAccessToken();
        setUser(null);
      }
      if (event.data?.type === 'session_available') {
        try {
          await refreshSession();
        } catch {
          clearAccessToken();
        }
      }
    };
    return () => {
      channelRef.current = null;
      channel.close();
    };
  }, [refreshSession]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const result = await refreshAuthentication();
        if (active) establishSession(result);
      } catch {
        if (active) {
          clearAccessToken();
          setUser(null);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [establishSession]);

  const signIn = useCallback(
    async ({ email, password }) => {
      const response = await apiClient.post('/api/v1/auth/login', { email, password });
      const signedInUser = establishSession(response.data);
      channelRef.current?.postMessage({ type: 'session_available' });
      return signedInUser;
    },
    [establishSession],
  );

  const register = useCallback(
    async ({ displayName, email, password }) => {
      const response = await apiClient.post('/api/v1/auth/register', {
        displayName,
        email,
        password,
      });
      const registeredUser = establishSession(response.data);
      channelRef.current?.postMessage({ type: 'session_available' });
      return registeredUser;
    },
    [establishSession],
  );

  useEffect(() => {
    cleanupObsoleteStorageKeys();
  }, []);

  const clearLocalCaches = () => {
    clearUserScopedStorage();
  };

  const logout = useCallback(async () => {
    try {
      await apiClient.post('/api/v1/auth/logout');
    } finally {
      clearAccessToken();
      setUser(null);
      clearLocalCaches();
      channelRef.current?.postMessage({ type: 'signed_out' });
      navigate('/auth', { replace: true });
    }
  }, [navigate]);

  const logoutAll = useCallback(async () => {
    try {
      await apiClient.post('/api/v1/auth/logout-all');
    } finally {
      clearAccessToken();
      setUser(null);
      clearLocalCaches();
      channelRef.current?.postMessage({ type: 'signed_out' });
      navigate('/auth', { replace: true });
    }
  }, [navigate]);

  const requestEmailVerification = useCallback(
    () => apiClient.post('/api/v1/auth/email/verify/request'),
    [],
  );
  const refreshCurrentUser = useCallback(async () => {
    const response = await apiClient.get('/api/v1/me');
    setUser(response.data.user);
    return response.data.user;
  }, []);
  const confirmEmailVerification = useCallback(async (verificationToken) => {
    const response = await apiClient.post('/api/v1/auth/email/verify/confirm', {
      token: verificationToken,
    });
    setUser(response.data.user);
    return response.data.user;
  }, []);
  const requestPasswordReset = useCallback(
    (email) => apiClient.post('/api/v1/auth/password/forgot', { email }),
    [],
  );
  const resetPassword = useCallback(async ({ password, resetToken }) => {
    await apiClient.post('/api/v1/auth/password/reset', { password, token: resetToken });
    clearAccessToken();
    setUser(null);
  }, []);
  const listSessions = useCallback(async () => {
    const response = await apiClient.get('/api/v1/me/sessions');
    return response.data.sessions;
  }, []);
  const revokeSession = useCallback(async (sessionId) => {
    await apiClient.delete(`/api/v1/me/sessions/${encodeURIComponent(sessionId)}`);
  }, []);

  const authContextValue = useMemo(
    () => ({
      confirmEmailVerification,
      isAuthenticated: Boolean(token && user),
      listSessions,
      loading,
      logout,
      logoutAll,
      refreshSession,
      refreshCurrentUser,
      register,
      requestEmailVerification,
      requestPasswordReset,
      resetPassword,
      revokeSession,
      setUser,
      signIn,
      token,
      user,
    }),
    [
      confirmEmailVerification,
      listSessions,
      loading,
      logout,
      logoutAll,
      refreshSession,
      refreshCurrentUser,
      register,
      requestEmailVerification,
      requestPasswordReset,
      resetPassword,
      revokeSession,
      signIn,
      token,
      user,
    ],
  );

  return <AuthContext.Provider value={authContextValue}>{children}</AuthContext.Provider>;
};
