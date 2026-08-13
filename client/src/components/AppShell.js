import AnimatedBackground from './AnimatedBackground';
import CustomCursor from './CustomCursor';
import Header from './Header';
import MobileOptimizationNotice from './MobileOptimizationNotice';
import NotesWidget from './NotesWidget';
import ScrollProgress from './ScrollProgress';
import './AppShell.css';

const SAFE_COLOR = /^#[0-9a-f]{6}$/i;

function colorOr(value, fallback) {
  return typeof value === 'string' && SAFE_COLOR.test(value) ? value : fallback;
}

function AppShell({ children, headerProps = {}, isAuthenticated, showHeader, theme }) {
  const primary = colorOr(theme?.color1, '#149ecc');
  const secondary = colorOr(theme?.color2, '#412ecc');
  const accent = colorOr(theme?.color3, '#44cf87');
  const themeStyle = {
    '--cwm-theme-accent': accent,
    '--cwm-theme-primary': primary,
    '--cwm-theme-secondary': secondary,
  };

  return (
    <div className="app-container" data-theme={theme?.preset || 'ocean'} style={themeStyle}>
      <a className="cwm-skip-link" href="#main-content">
        Skip to main content
      </a>
      <svg aria-hidden="true" className="cwm-svg-definitions" focusable="false">
        <defs>
          <filter id="goo">
            <feGaussianBlur in="SourceGraphic" result="blur" stdDeviation="10" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              result="goo"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7"
            />
            <feBlend in="SourceGraphic" in2="goo" />
          </filter>
        </defs>
      </svg>

      <ScrollProgress />
      <MobileOptimizationNotice />
      <AnimatedBackground color1={primary} color2={secondary} color3={accent} />
      {showHeader ? <Header {...headerProps} /> : null}

      <main
        className={`app-main${showHeader ? '' : ' app-main--without-header'}`}
        id="main-content"
        tabIndex="-1"
      >
        {children}
      </main>

      {isAuthenticated ? <NotesWidget /> : null}
      <CustomCursor />
    </div>
  );
}

export default AppShell;
