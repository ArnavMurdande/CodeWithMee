import { useRef, useState, useEffect } from 'react';

/**
 * Reusable Horizontal Scroll Container with a Persistent, Ultra-Thin White Scroll Line
 * 100% immune to OS native scrollbar auto-hide/fading bugs.
 */
const ScrollTrackRow = ({
  children,
  className = '',
  contentRole = 'region',
  label = 'Scrollable options',
  style = {},
}) => {
  const rowRef = useRef(null);
  const [scrollState, setScrollState] = useState({
    progress: 0,
    thumbRatio: 1,
    isScrollable: false,
  });

  const handleScroll = () => {
    if (!rowRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = rowRef.current;
    const maxScroll = scrollWidth - clientWidth;
    const isScrollable = maxScroll > 1;
    const progress = maxScroll > 0 ? scrollLeft / maxScroll : 0;
    const thumbRatio = scrollWidth > 0 ? Math.max(clientWidth / scrollWidth, 0.18) : 1;

    setScrollState({
      progress,
      thumbRatio,
      isScrollable,
    });
  };

  useEffect(() => {
    handleScroll();
    const t1 = setTimeout(handleScroll, 100);
    const t2 = setTimeout(handleScroll, 400);
    window.addEventListener('resize', handleScroll);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener('resize', handleScroll);
    };
  }, [children]);

  const thumbWidthPercent = scrollState.thumbRatio * 100;
  const thumbLeftPercent = scrollState.progress * (100 - thumbWidthPercent);

  return (
    <div className={`persistent-scroll-wrapper ${className}`} style={style}>
      <div
        aria-label={label}
        ref={rowRef}
        onScroll={handleScroll}
        className="persistent-scroll-content"
        role={contentRole}
        tabIndex={scrollState.isScrollable ? 0 : undefined}
      >
        {children}
      </div>

      {scrollState.isScrollable && (
        <div aria-hidden="true" className="persistent-track-line">
          <div
            className="persistent-thumb-line"
            style={{
              left: `${thumbLeftPercent}%`,
              width: `${thumbWidthPercent}%`,
            }}
          />
        </div>
      )}
    </div>
  );
};

export default ScrollTrackRow;
