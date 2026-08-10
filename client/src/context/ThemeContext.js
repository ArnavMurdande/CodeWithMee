import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import axios from '../lib/api';
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

const THEME_COLOR = /^#[0-9a-f]{6}$/i;
const THEME_COLOR_KEYS = new Set(['color1', 'color2', 'color3']);

function normalizeTheme(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return defaultTheme;
  }
  const preset = Object.prototype.hasOwnProperty.call(themePresets, candidate.preset)
    ? candidate.preset
    : candidate.preset === 'custom'
      ? 'custom'
      : defaultTheme.preset;
  const presetFallback = themePresets[preset] || defaultTheme;
  return {
    preset,
    color1: THEME_COLOR.test(candidate.color1) ? candidate.color1 : presetFallback.color1,
    color2: THEME_COLOR.test(candidate.color2) ? candidate.color2 : presetFallback.color2,
    color3: THEME_COLOR.test(candidate.color3) ? candidate.color3 : presetFallback.color3,
    customColors: preset === 'custom' && candidate.customColors === true,
  };
}

export const ThemeContext = createContext();

export const ThemeProvider = ({ children }) => {
  const { isAuthenticated, user } = useContext(AuthContext);

  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('cwm-theme');
      if (saved) return normalizeTheme(JSON.parse(saved));
    } catch {
      // Ignore invalid or unavailable local persistence and use the safe default.
    }
    return defaultTheme;
  });

  // Debounce timer for saving to backend
  const saveTimerRef = useRef(null);

  // Save to localStorage immediately (instant feedback)
  useEffect(() => {
    try {
      localStorage.setItem('cwm-theme', JSON.stringify(theme));
      const userId = user?.id || user?._id;
      if (userId) localStorage.setItem(`cwm_${userId}_theme`, JSON.stringify(theme));
    } catch {
      // Theme persistence is optional; the in-memory theme remains usable.
    }
  }, [theme, user?.id, user?._id]);

  // Load theme from backend on login
  useEffect(() => {
    if (!isAuthenticated) return;
    const loadTheme = async () => {
      try {
        const userId = user?.id || user?._id;
        const cached = userId ? localStorage.getItem(`cwm_${userId}_theme`) : null;
        if (cached) setTheme(normalizeTheme(JSON.parse(cached)));
        const res = await axios.get('/api/v1/me/preferences/theme');
        const stored = res.data?.theme;
        if (stored?.preset) {
          const serverTheme = normalizeTheme({
            preset: stored.preset,
            color1: stored.color1 || defaultTheme.color1,
            color2: stored.color2 || defaultTheme.color2,
            color3: stored.color3 || defaultTheme.color3,
            customColors: stored.customColors || false,
          });
          setTheme(serverTheme);
        }
      } catch {
        // Fall back to localStorage if backend is unavailable
        console.warn('Could not load theme from server, using local cache.');
      }
    };
    loadTheme();
  }, [isAuthenticated, user?.id, user?._id]);

  // Debounced save to backend
  const saveToBackend = useCallback(
    (newTheme) => {
      if (!isAuthenticated) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(async () => {
        try {
          await axios.put('/api/v1/me/preferences/theme', newTheme);
        } catch {
          console.warn('Could not save theme to server.');
        }
      }, 800); // Wait 800ms after last change before saving (prevents spam)
    },
    [isAuthenticated],
  );

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
    if (!THEME_COLOR_KEYS.has(colorKey) || !THEME_COLOR.test(value)) return;
    setTheme((prev) => {
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
