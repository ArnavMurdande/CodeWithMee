import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter as Router } from 'react-router-dom';

import App from './App';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import './index.css';

window.addEventListener(
  'error',
  (event) => {
    if (event.message?.includes('ResizeObserver')) {
      event.stopImmediatePropagation();
      event.preventDefault();
    }
  },
  true,
);

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('CodeWithMee could not find the root application element.');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <Router>
      <AuthProvider>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </AuthProvider>
    </Router>
  </React.StrictMode>,
);
