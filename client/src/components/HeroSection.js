import React from 'react';
import { TypeAnimation } from 'react-type-animation';
import './HeroSection.css';

const HeroSection = () => {
  return (
    <section className="hero-section">
      {/* The title is now outside and above the box */}
      <h1 className="hero-title">
        <TypeAnimation
          sequence={[
            '',
            1000,
            'Code With Mee', // Changed text to include spaces
          ]}
          wrapper="span"
          cursor={true}
          speed={40} // Adjusted speed for a slightly slower, more deliberate effect
          repeat={0}
        />
      </h1>

      {/* The hero-box now only contains the subtitle */}
      <div className="hero-box">
        <p className="hero-subtitle">
            <span className="bracket">&lt;</span>
            Your Interactive Coding Sandbox
            <span className="bracket">&gt;</span>
        </p>
      </div>
    </section>
  );
};

export default HeroSection;