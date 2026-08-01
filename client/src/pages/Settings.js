import { useContext, useState, useEffect } from 'react';
import { ThemeContext, themePresets } from '../context/ThemeContext';
import { AuthContext } from '../context/AuthContext';
import AppDropdown from '../components/AppDropdown';
import SessionSecurityPanel from '../components/SessionSecurityPanel';
import axios from '../lib/api';

const Settings = () => {
  const { theme, applyPreset, setCustomColor, resetToDefault } = useContext(ThemeContext);
  const { user, setUser } = useContext(AuthContext);

  const [privacySettings, setPrivacySettings] = useState({
    whoCanFollow: 'everyone',
    whoCanViewPosts: 'everyone',
    whoCanViewComments: 'everyone',
    whoCanViewProfileInfo: 'everyone',
  });
  const [savingPrivacy, setSavingPrivacy] = useState(false);

  useEffect(() => {
    if (user?.privacySettings) {
      setPrivacySettings({
        whoCanFollow: user.privacySettings.whoCanFollow || 'everyone',
        whoCanViewPosts: user.privacySettings.whoCanViewPosts || 'everyone',
        whoCanViewComments: user.privacySettings.whoCanViewComments || 'everyone',
        whoCanViewProfileInfo: user.privacySettings.whoCanViewProfileInfo || 'everyone',
      });
    }
  }, [user]);

  const handlePrivacySave = async () => {
    setSavingPrivacy(true);
    try {
      const res = await axios.put('/api/user/me', { privacySettings });
      setUser(res.data);
      alert('Privacy settings updated successfully!');
    } catch {
      alert('Failed to update privacy settings.');
    }
    setSavingPrivacy(false);
  };

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
                  aria-pressed={theme.preset === key}
                  key={key}
                  className={`preset-card ${theme.preset === key ? 'active' : ''}`}
                  onClick={() => applyPreset(key)}
                  type="button"
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
                  {theme.preset === key && <div className="preset-active-badge">✓</div>}
                </button>
              ))}
            </div>

            {/* Custom Color Tuning */}
            <h3 className="subsection-title">Custom Colors</h3>
            <p className="subsection-desc">Fine-tune the individual gradient colors</p>
            <div className="color-pickers">
              <div className="color-picker-group">
                <label htmlFor="theme-primary-color">Primary</label>
                <div className="color-input-wrapper">
                  <input
                    aria-label="Primary theme color"
                    id="theme-primary-color"
                    type="color"
                    value={theme.color1}
                    onChange={(e) => setCustomColor('color1', e.target.value)}
                  />
                  <span className="color-hex">{theme.color1}</span>
                </div>
              </div>
              <div className="color-picker-group">
                <label htmlFor="theme-secondary-color">Secondary</label>
                <div className="color-input-wrapper">
                  <input
                    aria-label="Secondary theme color"
                    id="theme-secondary-color"
                    type="color"
                    value={theme.color2}
                    onChange={(e) => setCustomColor('color2', e.target.value)}
                  />
                  <span className="color-hex">{theme.color2}</span>
                </div>
              </div>
              <div className="color-picker-group">
                <label htmlFor="theme-accent-color">Accent</label>
                <div className="color-input-wrapper">
                  <input
                    aria-label="Accent theme color"
                    id="theme-accent-color"
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

            <button className="reset-btn" onClick={resetToDefault} type="button">
              Reset to Default (Ocean)
            </button>
          </div>
        </div>

        <SessionSecurityPanel />

        {/* Social Section */}
        <div className="settings-section active-section">
          <div className="section-header">
            <div className="section-icon">👥</div>
            <div>
              <h2>Social Privacy</h2>
              <p>Manage who can see your activity and connect with you</p>
            </div>
          </div>

          <div className="section-content">
            <div
              className="privacy-settings-grid"
              style={{ display: 'grid', gap: '1.5rem', marginTop: '1rem' }}
            >
              <div className="privacy-setting-item">
                <p
                  style={{
                    display: 'block',
                    fontWeight: 'bold',
                    marginBottom: '0.5rem',
                    color: '#fff',
                  }}
                >
                  Who can follow you?
                </p>
                <AppDropdown
                  label="Who can follow you"
                  options={[
                    { label: 'Anyone (Auto-approve)', value: 'everyone' },
                    { label: 'Require Request Approval', value: 'request_required' },
                    { label: 'Nobody', value: 'nobody' },
                  ]}
                  value={privacySettings.whoCanFollow}
                  onChange={(val) => setPrivacySettings({ ...privacySettings, whoCanFollow: val })}
                />
              </div>

              <div className="privacy-setting-item">
                <p
                  style={{
                    display: 'block',
                    fontWeight: 'bold',
                    marginBottom: '0.5rem',
                    color: '#fff',
                  }}
                >
                  Who can view your Space Posts?
                </p>
                <AppDropdown
                  label="Who can view your Space posts"
                  options={[
                    { label: 'Everyone', value: 'everyone' },
                    { label: 'Followers Only', value: 'followers_only' },
                    { label: 'Nobody / Private', value: 'nobody' },
                  ]}
                  value={privacySettings.whoCanViewPosts}
                  onChange={(val) =>
                    setPrivacySettings({ ...privacySettings, whoCanViewPosts: val })
                  }
                />
              </div>

              <div className="privacy-setting-item">
                <p
                  style={{
                    display: 'block',
                    fontWeight: 'bold',
                    marginBottom: '0.5rem',
                    color: '#fff',
                  }}
                >
                  Who can view your Space Comments?
                </p>
                <AppDropdown
                  label="Who can view your Space comments"
                  options={[
                    { label: 'Everyone', value: 'everyone' },
                    { label: 'Followers Only', value: 'followers_only' },
                    { label: 'Nobody / Private', value: 'nobody' },
                  ]}
                  value={privacySettings.whoCanViewComments}
                  onChange={(val) =>
                    setPrivacySettings({ ...privacySettings, whoCanViewComments: val })
                  }
                />
              </div>

              <div className="privacy-setting-item">
                <p
                  style={{
                    display: 'block',
                    fontWeight: 'bold',
                    marginBottom: '0.5rem',
                    color: '#fff',
                  }}
                >
                  Who can view your full Profile Overview (Stats/Followers)?
                </p>
                <AppDropdown
                  label="Who can view your full profile overview"
                  options={[
                    { label: 'Everyone', value: 'everyone' },
                    { label: 'Followers Only', value: 'followers_only' },
                    { label: 'Nobody / Private', value: 'nobody' },
                  ]}
                  value={privacySettings.whoCanViewProfileInfo}
                  onChange={(val) =>
                    setPrivacySettings({ ...privacySettings, whoCanViewProfileInfo: val })
                  }
                />
              </div>

              <button
                className="reset-btn"
                style={{
                  background: '#4285F4',
                  color: '#fff',
                  border: 'none',
                  padding: '1rem',
                  marginTop: '1rem',
                  cursor: 'pointer',
                  borderRadius: '8px',
                  fontWeight: 'bold',
                }}
                onClick={handlePrivacySave}
                disabled={savingPrivacy}
              >
                {savingPrivacy ? 'Saving...' : 'Save Privacy Preferences'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;
