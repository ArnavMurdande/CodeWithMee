import { useEffect, useState } from 'react';

const STORAGE_KEY = 'cwm_mobile_optimization_notice_dismissed';

export default function MobileOptimizationNotice() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 768px)');
    const sync = () => setVisible(query.matches && sessionStorage.getItem(STORAGE_KEY) !== 'true');
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  if (!visible) return null;
  return (
    <div aria-describedby="mobile-optimization-description" aria-modal="true" className="mobile-optimization-overlay" role="dialog">
      <div className="mobile-optimization-card">
        <h2>Best experienced on a larger screen</h2>
        <p id="mobile-optimization-description">
          CodeWithMee works on mobile, but coding workspaces and advanced tools are not fully optimized for small screens yet.
        </p>
        <button
          autoFocus
          onClick={() => {
            sessionStorage.setItem(STORAGE_KEY, 'true');
            setVisible(false);
          }}
          type="button"
        >
          Continue on mobile
        </button>
      </div>
    </div>
  );
}
