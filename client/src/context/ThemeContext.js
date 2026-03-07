import React, { createContext, useState, useEffect, useContext, useRef, useCallback } from 'react';
import axios from 'axios';
import { AuthContext } from './AuthContext';

// Predefined theme presets
export const themePresets = {
  ocean: {
    name: 'Ocean',
    description: 'Deep blue and teal — the default look',
    color1: '#149ecc',
    color2: '#412ecc',
    color3: '#44cf87',
  },
  midnight: {
    name: 'Midnight',
    description: 'Dark purples and deep navy',
    color1: '#1a1a2e',
    color2: '#16213e',
    color3: '#0f3460',
  },
  aurora: {
    name: 'Aurora',
    description: 'Northern lights — greens and teals',
    color1: '#0d9276',
    color2: '#1c4e80',
    color3: '#40a578',
  },
  sunset: {
    name: 'Sunset',
    description: 'Warm oranges and deep reds',
    color1: '#e84545',
    color2: '#903749',
    color3: '#ee9b00',
  },
  nebula: {
    name: 'Nebula',
    description: 'Cosmic purples and pinks',
    color1: '#7b2d8e',
    color2: '#3d1a78',
    color3: '#c94d8a',
  },
  forest: {
    name: 'Forest',
    description: 'Rich greens and earthy tones',
    color1: '#1b4332',
    color2: '#2d6a4f',
    color3: '#52b788',
  },
  monochrome: {
    name: 'Monochrome',
    description: 'Clean greys — minimal and focused',
    color1: '#2d2d2d',
    color2: '#1a1a1a',
    color3: '#3d3d3d',
  },
  ember: {
    name: 'Ember',
    description: 'Fiery reds and amber glow',
    color1: '#b91c1c',
    color2: '#7c2d12',
    color3: '#f59e0b',
  },
};

const defaultTheme = {
  preset: 'ocean',
  color1: '#149ecc',
  color2: '#412ecc',
  color3: '#44cf87',
  customColors: false,
};

export const ThemeContext = createContext();

export const ThemeProvider = ({ children }) => {
  const { token, isAuthenticated } = useContext(AuthContext);

  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('cwm-theme');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return defaultTheme;
  });

  // Debounce timer for saving to backend
  const saveTimerRef = useRef(null);

  // Save to localStorage immediately (instant feedback)
  useEffect(() => {
    localStorage.setItem('cwm-theme', JSON.stringify(theme));
  }, [theme]);

  // Load theme from backend on login
  useEffect(() => {
    if (!isAuthenticated || !token) return;
    const loadTheme = async () => {
      try {
        const res = await axios.get('http://localhost:5001/api/user/theme', {
          headers: { 'x-auth-token': token },
        });
        if (res.data && res.data.preset) {
          const serverTheme = {
            preset: res.data.preset,
            color1: res.data.color1 || defaultTheme.color1,
            color2: res.data.color2 || defaultTheme.color2,
            color3: res.data.color3 || defaultTheme.color3,
            customColors: res.data.customColors || false,
          };
          setTheme(serverTheme);
          localStorage.setItem('cwm-theme', JSON.stringify(serverTheme));
        }
      } catch (err) {
        // Fall back to localStorage if backend is unavailable
        console.warn('Could not load theme from server, using local cache.');
      }
    };
    loadTheme();
  }, [isAuthenticated, token]);

  // Debounced save to backend
  const saveToBackend = useCallback((newTheme) => {
    if (!isAuthenticated || !token) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await axios.put('http://localhost:5001/api/user/theme', newTheme, {
          headers: { 'x-auth-token': token },
        });
      } catch (err) {
        console.warn('Could not save theme to server.');
      }
    }, 800); // Wait 800ms after last change before saving (prevents spam)
  }, [isAuthenticated, token]);

  const applyPreset = (presetKey) => {
    const preset = themePresets[presetKey];
    if (!preset) return;
    const newTheme = {
      preset: presetKey,
      color1: preset.color1,
      color2: preset.color2,
      color3: preset.color3,
      customColors: false,
    };
    setTheme(newTheme);
    saveToBackend(newTheme);
  };

  const setCustomColor = (colorKey, value) => {
    setTheme(prev => {
      const newTheme = {
        ...prev,
        [colorKey]: value,
        customColors: true,
        preset: 'custom',
      };
      saveToBackend(newTheme);
      return newTheme;
    });
  };

  const resetToDefault = () => {
    setTheme(defaultTheme);
    saveToBackend(defaultTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, applyPreset, setCustomColor, resetToDefault }}>
      {children}
    </ThemeContext.Provider>
  );
};
