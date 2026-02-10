import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { gsap } from 'gsap';
import './Sidebar.css';

const menuItems = [
  { label: 'HOME', path: '/' },
  { label: 'DASHBOARD', path: '/dashboard' },
  { label: 'PATHWAYS', path: '/pathways' },
  { label: 'CHALLENGES', path: '/challenges' },
  { label: 'COURSES', path: '/courses' },
  { label: 'SPACE', path: '/space' },
  { label: 'PROFILE', path: '/profile' },
];

const Sidebar = ({ isOpen, closeSidebar }) => {
  const navigate = useNavigate();
  const sidebarRef = useRef(null);
  const menuItemsRef = useRef([]);
  const curtainRef = useRef(null);
  const closeButtonRef = useRef(null);

  // Reset refs array on each render
  menuItemsRef.current = [];

  const addToRefs = (el) => {
    if (el && !menuItemsRef.current.includes(el)) {
      menuItemsRef.current.push(el);
    }
  };

  // Open/Close Animation
  useEffect(() => {
    const ctx = gsap.context(() => {
      if (isOpen) {
        // Open animation - curtain reveal
        gsap.timeline()
          .set(sidebarRef.current, { display: 'flex' })
          .fromTo(
            curtainRef.current,
            { scaleY: 0, transformOrigin: 'top' },
            { scaleY: 1, duration: 0.5, ease: 'power4.inOut' }
          )
          .fromTo(
            closeButtonRef.current,
            { opacity: 0, rotate: -90 },
            { opacity: 1, rotate: 0, duration: 0.3, ease: 'power2.out' },
            '-=0.2'
          )
          .fromTo(
            menuItemsRef.current,
            { 
              y: 80, 
              opacity: 0,
              skewY: 5
            },
            { 
              y: 0, 
              opacity: 1, 
              skewY: 0,
              duration: 0.6, 
              stagger: 0.08, 
              ease: 'power3.out' 
            },
            '-=0.3'
          );
      } else {
        // Close animation
        gsap.timeline()
          .to(menuItemsRef.current, {
            y: -40,
            opacity: 0,
            duration: 0.3,
            stagger: 0.03,
            ease: 'power2.in'
          })
          .to(curtainRef.current, {
            scaleY: 0,
            transformOrigin: 'bottom',
            duration: 0.4,
            ease: 'power4.inOut'
          }, '-=0.1')
          .set(sidebarRef.current, { display: 'none' });
      }
    }, sidebarRef);

    return () => ctx.revert();
  }, [isOpen]);

  // Handle navigation with page transition
  const handleNavigation = (path) => {
    const tl = gsap.timeline({
      onComplete: () => {
        navigate(path);
        closeSidebar();
      }
    });

    // Curtain close animation (slides up to reveal new page)
    tl.to(menuItemsRef.current, {
      y: -60,
      opacity: 0,
      duration: 0.25,
      stagger: 0.02,
      ease: 'power2.in'
    })
    .to(curtainRef.current, {
      scaleY: 0,
      transformOrigin: 'bottom',
      duration: 0.5,
      ease: 'power4.inOut'
    }, '-=0.1');
  };

  return (
    <nav ref={sidebarRef} className={`neo-sidebar ${isOpen ? 'open' : ''}`}>
      {/* Background Curtain */}
      <div ref={curtainRef} className="sidebar-curtain"></div>
      
      {/* Close Button */}
      <button 
        ref={closeButtonRef} 
        className="neo-close-button" 
        onClick={closeSidebar}
        aria-label="Close menu"
      >
        <span className="close-line"></span>
        <span className="close-line"></span>
      </button>

      {/* Menu Items */}
      <ul className="neo-menu">
        {menuItems.map((item, index) => (
          <li 
            key={item.path} 
            ref={addToRefs}
            className="neo-menu-item"
            style={{ '--item-index': index }}
          >
            <button 
              className="neo-menu-link"
              onClick={() => handleNavigation(item.path)}
            >
              <span className="link-number">0{index + 1}</span>
              <span className="link-text">{item.label}</span>
              <span className="link-arrow">→</span>
            </button>
          </li>
        ))}
      </ul>

      {/* Decorative Elements */}
      <div className="neo-footer">
        <span className="neo-tagline">CODE WITH MEE</span>
        <span className="neo-year">© 2026</span>
      </div>
    </nav>
  );
};

export default Sidebar;