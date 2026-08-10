import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';

/**
 * Shared portal menu-select. The trigger and choices stay native buttons while
 * the menu exposes radio semantics and complete keyboard navigation.
 */
const AppDropdown = ({
  className = '',
  label = 'Select option',
  onChange,
  options = [],
  placeholder = 'Select option',
  value,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0, isDropUp: false });
  const dropdownRef = useRef(null);
  const menuRef = useRef(null);
  const optionRefs = useRef([]);
  const menuId = useId();

  const matchedIndex = options.findIndex((option) => option.value === value);
  const selectedIndex = Math.max(0, matchedIndex);
  const selectedOption =
    matchedIndex >= 0 ? options[matchedIndex] : { label: value || placeholder, value };

  const updateCoords = () => {
    if (!dropdownRef.current) return;
    const rect = dropdownRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const isDropUp = spaceBelow < 220 && spaceAbove > 200;

    const triggerWidth = rect.width;
    const minMenuWidth = Math.max(triggerWidth, 200);

    // Clamp left position so menu stays within screen boundaries and doesn't overflow adjacent panels
    let left = rect.left;
    if (left + minMenuWidth > window.innerWidth - 16) {
      left = Math.max(16, window.innerWidth - minMenuWidth - 16);
    }
    left = Math.max(16, left);

    setCoords({
      top: isDropUp ? rect.top - 8 : rect.bottom + 8,
      left,
      width: triggerWidth,
      isDropUp,
    });
  };

  const closeMenu = (restoreFocus = false) => {
    setIsOpen(false);
    if (restoreFocus)
      requestAnimationFrame(() => dropdownRef.current?.querySelector('button')?.focus());
  };

  const openMenu = () => {
    updateCoords();
    setIsOpen(true);
  };

  const toggleOpen = (event) => {
    event.stopPropagation();
    if (isOpen) closeMenu();
    else openMenu();
  };

  const handleSelect = (optionValue) => {
    onChange(optionValue);
    closeMenu(true);
  };

  const focusOption = (index) => {
    if (options.length === 0) return;
    const normalizedIndex = (index + options.length) % options.length;
    optionRefs.current[normalizedIndex]?.focus();
  };

  const handleTriggerKeyDown = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!isOpen) openMenu();
      requestAnimationFrame(() => focusOption(selectedIndex));
    } else if (event.key === 'Escape' && isOpen) {
      event.preventDefault();
      closeMenu(true);
    }
  };

  const handleOptionKeyDown = (event, index) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusOption(index + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusOption(index - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusOption(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusOption(options.length - 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu(true);
    } else if (event.key === 'Tab') {
      closeMenu();
    }
  };

  useLayoutEffect(() => {
    if (isOpen) updateCoords();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    requestAnimationFrame(() => focusOption(selectedIndex));

    const handleScrollOrResize = () => updateCoords();
    const handleCloseEvent = () => closeMenu();
    const handleClickOutside = (event) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target) &&
        menuRef.current &&
        !menuRef.current.contains(event.target)
      ) {
        closeMenu();
      }
    };

    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    window.addEventListener('cwm:close-dropdowns', handleCloseEvent);
    document.addEventListener('mousedown', handleClickOutside);

    let ro = null;
    if (typeof ResizeObserver !== 'undefined' && dropdownRef.current) {
      ro = new ResizeObserver(() => updateCoords());
      ro.observe(dropdownRef.current);
    }

    return () => {
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('cwm:close-dropdowns', handleCloseEvent);
      document.removeEventListener('mousedown', handleClickOutside);
      if (ro) ro.disconnect();
    };
  }, [isOpen, selectedIndex]);

  const menuContent = isOpen ? (
    <div
      aria-label={label}
      className={`app-dropdown-menu portal-menu ${coords.isDropUp ? 'drop-up' : ''}`}
      id={menuId}
      ref={menuRef}
      role="menu"
      style={{
        position: 'fixed',
        top: coords.isDropUp ? 'auto' : `${coords.top}px`,
        bottom: coords.isDropUp ? `${window.innerHeight - coords.top}px` : 'auto',
        left: `${coords.left}px`,
        width: `${coords.width}px`,
        minWidth: `${Math.max(coords.width, 160)}px`,
        maxWidth: '380px',
        zIndex: 999999,
      }}
    >
      <div className="app-dropdown-scroll-wrapper">
        {options.map((option, index) => {
          const isSelected = option.value === value;
          return (
            <button
              aria-checked={isSelected}
              className={`app-dropdown-item ${isSelected ? 'selected' : ''}`}
              key={option.value}
              onClick={() => handleSelect(option.value)}
              onKeyDown={(event) => handleOptionKeyDown(event, index)}
              ref={(element) => {
                optionRefs.current[index] = element;
              }}
              role="menuitemradio"
              title={option.label}
              type="button"
            >
              <span>{option.label}</span>
              {isSelected ? (
                <svg
                  aria-hidden="true"
                  fill="none"
                  height="14"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2.5"
                  viewBox="0 0 24 24"
                  width="14"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  ) : null;

  return (
    <div
      className={`app-dropdown-container ${isOpen ? 'is-open' : ''} ${className}`}
      ref={dropdownRef}
    >
      <button
        aria-controls={isOpen ? menuId : undefined}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={`${label}: ${selectedOption.label}`}
        className="app-dropdown-button"
        onClick={toggleOpen}
        onKeyDown={handleTriggerKeyDown}
        title={selectedOption.label}
        type="button"
      >
        <span className="app-dropdown-label">{selectedOption.label}</span>
        <svg
          aria-hidden="true"
          className={`app-dropdown-chevron ${isOpen ? 'open' : ''}`}
          fill="none"
          height="14"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.5"
          viewBox="0 0 24 24"
          width="14"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {isOpen ? ReactDOM.createPortal(menuContent, document.body) : null}
    </div>
  );
};

export default AppDropdown;
