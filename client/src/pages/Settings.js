import React, { useContext } from 'react';
import { ThemeContext, themePresets } from '../context/ThemeContext';
import './Settings.css';

const Settings = () => {
  const { theme, applyPreset, setCustomColor, resetToDefault } = useContext(ThemeContext);

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h1>Settings</h1>
        <p className="settings-subtitle">Customize your CodeWithMee experience</p>
      </div>

      <div className="settings-sections">
        {/* Theme Section */}
        <div className="settings-section active-section">
          <div className="section-header">
            <div className="section-icon">🎨</div>
            <div>
              <h2>Theme</h2>
              <p>Change the background &amp; UI color scheme</p>
            </div>
          </div>

          <div className="section-content">
            {/* Presets Grid */}
            <h3 className="subsection-title">Presets</h3>
            <div className="presets-grid">
              {Object.entries(themePresets).map(([key, preset]) => (
                <button
                  key={key}
                  className={`preset-card ${theme.preset === key ? 'active' : ''}`}
                  onClick={() => applyPreset(key)}
                >
                  <div className="preset-preview">
                    <div
                      className="preview-gradient"
                      style={{
                        background: `linear-gradient(135deg, ${preset.color1}, ${preset.color2}, ${preset.color3})`,
                      }}
                    />
                  </div>
                  <div className="preset-info">
                    <span className="preset-name">{preset.name}</span>
                    <span className="preset-desc">{preset.description}</span>
                  </div>
                  {theme.preset === key && (
                    <div className="preset-active-badge">✓</div>
                  )}
                </button>
              ))}
            </div>

            {/* Custom Color Tuning */}
            <h3 className="subsection-title">Custom Colors</h3>
            <p className="subsection-desc">Fine-tune the individual gradient colors</p>
            <div className="color-pickers">
              <div className="color-picker-group">
                <label>Primary</label>
                <div className="color-input-wrapper">
                  <input
                    type="color"
                    value={theme.color1}
                    onChange={(e) => setCustomColor('color1', e.target.value)}
                  />
                  <span className="color-hex">{theme.color1}</span>
                </div>
              </div>
              <div className="color-picker-group">
                <label>Secondary</label>
                <div className="color-input-wrapper">
                  <input
                    type="color"
                    value={theme.color2}
                    onChange={(e) => setCustomColor('color2', e.target.value)}
                  />
                  <span className="color-hex">{theme.color2}</span>
                </div>
              </div>
              <div className="color-picker-group">
                <label>Accent</label>
                <div className="color-input-wrapper">
                  <input
                    type="color"
                    value={theme.color3}
                    onChange={(e) => setCustomColor('color3', e.target.value)}
                  />
                  <span className="color-hex">{theme.color3}</span>
                </div>
              </div>
            </div>

            {/* Live Preview */}
            <h3 className="subsection-title">Preview</h3>
            <div className="theme-preview-bar">
              <div
                className="preview-swatch large"
                style={{
                  background: `linear-gradient(135deg, ${theme.color1}, ${theme.color2}, ${theme.color3})`,
                }}
              >
                <span>Your current gradient</span>
              </div>
            </div>

            <button className="reset-btn" onClick={resetToDefault}>
              Reset to Default (Ocean)
            </button>
          </div>
        </div>

        {/* Tutorials & AI Section - Coming Soon */}
        <div className="settings-section disabled-section">
          <div className="section-header">
            <div className="section-icon">🤖</div>
            <div>
              <h2>Tutorials &amp; AI Assistance</h2>
              <p>Manage AI suggestions, guides, and onboarding info</p>
            </div>
            <span className="coming-soon-badge">Coming Soon</span>
          </div>
        </div>

        {/* Social Section - Coming Soon */}
        <div className="settings-section disabled-section">
          <div className="section-header">
            <div className="section-icon">👥</div>
            <div>
              <h2>Social</h2>
              <p>Manage profile visibility and social settings</p>
            </div>
            <span className="coming-soon-badge">Coming Soon</span>
          </div>
        </div>

        {/* Courses Section - Coming Soon */}
        <div className="settings-section disabled-section">
          <div className="section-header">
            <div className="section-icon">📚</div>
            <div>
              <h2>Courses</h2>
              <p>Manage courses and subscription preferences</p>
            </div>
            <span className="coming-soon-badge">Coming Soon</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;
