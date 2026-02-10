import React, { useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import { useGoogleLogin } from '@react-oauth/google';
import './Auth.css';

const Auth = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
  });
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const auth = useContext(AuthContext);

  const { username, email, password } = formData;

  const onChange = e => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const switchModeHandler = () => {
    setIsLogin(prevState => !prevState);
    setError('');
  };

  const handleGoogleLogin = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      try {
        const res = await axios.post('http://localhost:5001/api/auth/google-profile', {
          access_token: tokenResponse.access_token,
        });
        auth.login(res.data.token);
      } catch (err) {
        setError('Google Sign-In failed. Please try again.');
        console.error(err);
      }
    },
    onError: () => {
      setError('Google Sign-In was unsuccessful.');
    }
  });

  const onSubmit = async e => {
    e.preventDefault();
    setError('');

    const endpoint = isLogin ? 'login' : 'register';
    const url = `http://localhost:5001/api/auth/${endpoint}`;

    try {
      const body = isLogin ? { email, password } : { username, email, password };
      const res = await axios.post(url, body, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      auth.login(res.data.token);
    } catch (err) {
      const errorMessage = err.response?.data?.message || 'Something went wrong. Please try again.';
      setError(errorMessage);
      console.error('Authentication error:', errorMessage);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h2>{isLogin ? 'Login' : 'Sign Up'}</h2>
        
        <form onSubmit={onSubmit}>
          {!isLogin && (
            <div className="form-group">
              <label htmlFor="username">Username</label>
              <input type="text" id="username" name="username" value={username} onChange={onChange} required />
            </div>
          )}
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input type="email" id="email" name="email" value={email} onChange={onChange} required />
          </div>
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input type="password" id="password" name="password" value={password} onChange={onChange} required minLength="6" />
          </div>

          {error && <p className="error-message">{error}</p>}
          
          <div className="button-group">
            <button type="submit" className="auth-button">
              {isLogin ? 'Login' : 'Create Account'}
            </button>
            <button type="button" onClick={() => handleGoogleLogin()} className="google-button">
               {isLogin ? 'Log in with ' : 'Sign up with '}
               <span className="g-blue">G</span>
               <span className="g-red">o</span>
               <span className="g-yellow">o</span>
               <span className="g-blue">g</span>
               <span className="g-green">l</span>
               <span className="g-red">e</span>
            </button>
          </div>
        </form>

        <button onClick={switchModeHandler} className="switch-button">
          {isLogin ? 'Switch to Sign Up' : 'Switch to Login'}
        </button>
      </div>
    </div>
  );
};

export default Auth;