import React, { useState, useEffect } from 'react';
import './MobileWarningOverlay.css';

const MobileWarningOverlay = () => {
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        const checkMobile = () => {
            // Check if width is less than 769px (mobile/tablet)
            // AND we haven't dismissed it yet this session? 
            // For now, let's just show it on load if mobile, but allow dismissing.
            if (window.innerWidth <= 768) {
                // Check session storage to see if already dismissed this session
                const dismissed = sessionStorage.getItem('mobileWarningDismissed');
                if (!dismissed) {
                    setIsVisible(true);
                }
            } else {
                setIsVisible(false);
            }
        };

        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    const handleDismiss = () => {
        setIsVisible(false);
        // Remember dismissal for this session
        sessionStorage.setItem('mobileWarningDismissed', 'true');
    };

    if (!isVisible) return null;

    return (
        <div className="mobile-warning-overlay">
            <div className="mobile-warning-content">
                <span className="warning-icon">💻</span>
                <h3>Desktop Recommended</h3>
                <p>
                    This platform is optimized for laptop and desktop use. <br/>
                    The UI might not be fully optimized for mobile displays.
                </p>
                <button className="dismiss-btn" onClick={handleDismiss}>
                    I understand, continue anyway
                </button>
            </div>
        </div>
    );
};

export default MobileWarningOverlay;
