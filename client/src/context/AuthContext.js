import React, { createContext, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const fetchUser = useCallback(async (currentToken) => {
    if (currentToken) {
      localStorage.setItem('token', currentToken);
      try {
        const res = await axios.get('http://localhost:5001/api/user/me', {
          headers: { 'x-auth-token': currentToken },
        });
        setUser(res.data);
      } catch (err) {
        console.error('Token validation failed. Logging out.');
        localStorage.removeItem('token');
        setToken(null);
        setUser(null);
        navigate('/auth');
      }
    }
  }, [navigate]);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
    navigate('/auth');
  }, [navigate]);

  useEffect(() => {
    const initialAuthCheck = async () => {
      if (token) {
        await fetchUser(token);
      }
      setLoading(false);
    };
    initialAuthCheck();
  }, [token, fetchUser]);

  const login = async (newToken) => {
    setToken(newToken);
    await fetchUser(newToken); // Immediately fetch user data after getting the token
    navigate('/dashboard');
  };

  const authContextValue = {
    token,
    user,
    setUser,
    login,
    logout,
    isAuthenticated: !!token,
    loading,
  };

  return (
    <AuthContext.Provider value={authContextValue}>
      {!loading && children}
    </AuthContext.Provider>
  );
};
