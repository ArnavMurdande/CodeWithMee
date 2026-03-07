import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter as Router } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google'; // <-- Import
import './index.css';
import App from './App';

import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';

// Safety net: suppress any stray ResizeObserver loop warnings
window.addEventListener('error', (e) => {
  if (e.message?.includes('ResizeObserver')) {
    e.stopImmediatePropagation();
    e.preventDefault();
  }
}, true);

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <GoogleOAuthProvider clientId="1010795942517-79d5qtumb10k34f1bm9m8sr8ob5srvpi.apps.googleusercontent.com">
      <Router>
        <AuthProvider>
          <ThemeProvider>
            <App />
          </ThemeProvider>
        </AuthProvider>
      </Router>
    </GoogleOAuthProvider>
  </React.StrictMode>
);
