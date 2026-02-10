import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter as Router } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google'; // <-- Import
import './index.css';
import App from './App';

import { AuthProvider } from './context/AuthContext';



const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    {/* --- MODIFICATION START --- */}
    <GoogleOAuthProvider clientId="1010795942517-79d5qtumb10k34f1bm9m8sr8ob5srvpi.apps.googleusercontent.com">
      <Router>
        <AuthProvider>
          <App />
        </AuthProvider>
      </Router>
    </GoogleOAuthProvider>
    {/* --- MODIFICATION END --- */}
  </React.StrictMode>
);
