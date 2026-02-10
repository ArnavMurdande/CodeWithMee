import React, { useState, useContext, useEffect } from 'react';
import { useNavigate, useLocation, Link, NavLink } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import ProfileDropdown from './ProfileDropdown';
import PomodoroTimer from './PomodoroTimer';
import './Header.css';

// SVG Icons for Mobile Nav
const Icons = {
    Dashboard: (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7"></rect>
            <rect x="14" y="3" width="7" height="7"></rect>
            <rect x="14" y="14" width="7" height="7"></rect>
            <rect x="3" y="14" width="7" height="7"></rect>
        </svg>
    ),
    Pathways: (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="6" y1="3" x2="6" y2="15"></line>
            <circle cx="18" cy="6" r="3"></circle>
            <circle cx="6" cy="18" r="3"></circle>
            <path d="M18 9a9 9 0 0 1-9 9"></path>
        </svg>
    ),
    Challenges: (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
        </svg>
    ),
    Courses: (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
            <line x1="12" y1="6" x2="16" y2="6"></line>
            <line x1="12" y1="10" x2="16" y2="10"></line>
        </svg>
    ),
    Space: (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon>
        </svg>
    )
};

const navItems = [
    { label: 'Dashboard', path: '/dashboard', icon: Icons.Dashboard },
    { label: 'Pathways', path: '/pathways', icon: Icons.Pathways },
    { label: 'Challenges', path: '/challenges', icon: Icons.Challenges },
    { label: 'Courses', path: '/courses', icon: Icons.Courses },
    { label: 'Space', path: '/space', icon: Icons.Space }
];

const Header = ({ onViewRoadmapsClick, pageTitle }) => {
    const navigate = useNavigate();
    const location = useLocation();
    const auth = useContext(AuthContext);
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [profilePicUrl, setProfilePicUrl] = useState('https://i.imgur.com/3YQeY9r.png');

    useEffect(() => {
        if (auth.user && auth.user.profilePictureUrl) {
            if (auth.user.profilePictureUrl.startsWith('/uploads')) {
                setProfilePicUrl(`http://localhost:5001${auth.user.profilePictureUrl}?t=${new Date().getTime()}`);
            } else {
                setProfilePicUrl(auth.user.profilePictureUrl);
            }
        } else {
            setProfilePicUrl('https://i.imgur.com/3YQeY9r.png');
        }
    }, [auth.user]);

    const handleLogout = () => {
        auth.logout();
        setDropdownOpen(false);
    };

    const handleAuthClick = () => {
        navigate('/auth');
    };

    const handleLogoClick = () => {
        navigate('/');
    };

    const toggleDropdown = () => {
        setDropdownOpen(prev => !prev);
    }

    const showViewRoadmapsButton = location.pathname === '/pathways' && auth.isAuthenticated;

    return (
        <>
            <header className="header-pill">
                {/* Left Side - Logo and Brand */}
                <div className="header-left">
                    <div className="logo-container" onClick={handleLogoClick}>
                        <div className="logo-circles">
                            <div className="circle circle-1"></div>
                            <div className="circle circle-2"></div>
                        </div>
                        <span className="brand-name">CodewithMee</span>
                    </div>
                </div>

                {/* Center - Desktop Navigation (Visible only on Desktop) */}
                {auth.isAuthenticated && (
                    <nav className="desktop-nav">
                        {navItems.map((item) => (
                            <NavLink 
                                key={item.path} 
                                to={item.path}
                                className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                            >
                                {item.label}
                            </NavLink>
                        ))}
                    </nav>
                )}

                {/* Right Side - User Tools */}
                <div className="header-right">
                    {auth.isAuthenticated ? (
                        <div className="user-controls">
                            {/* Desktop only: Dashboard Icon was removed in favor of central nav */}
                            
                            <PomodoroTimer />
                            
                            <div className="control-divider"></div>
                            
                            <div className="header-profile-container" onClick={toggleDropdown}>
                                <div className="profile-icon">
                                    <img src={profilePicUrl} alt="Profile" key={profilePicUrl} />
                                </div>
                                {dropdownOpen && <ProfileDropdown onLogout={handleLogout} />}
                            </div>
                        </div>
                    ) : (
                        <button className="signup-login-button" onClick={handleAuthClick}>
                            Signup / Login
                        </button>
                    )}
                </div>
            </header>

            {/* Bottom Dock - Mobile Navigation (Visible only on Mobile) */}
            {auth.isAuthenticated && (
                <nav className="mobile-dock">
                    {navItems.map((item) => (
                        <NavLink 
                            key={item.path} 
                            to={item.path}
                            className={({ isActive }) => `dock-item ${isActive ? 'active' : ''}`}
                        >
                            <span className="dock-icon">{item.icon}</span>
                        </NavLink>
                    ))}
                </nav>
            )}
        </>
    );
};

export default Header;