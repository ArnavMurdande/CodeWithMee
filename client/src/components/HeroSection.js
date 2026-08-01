import { TypeAnimation } from 'react-type-animation';

const HeroSection = () => {
  return (
    <section className="hero-section">
      <h1 aria-label="Code With Mee" className="hero-title">
        <TypeAnimation
          aria-hidden="true"
          sequence={['', 1000, 'Code With Mee']}
          wrapper="span"
          cursor={true}
          speed={40}
          repeat={0}
        />
      </h1>

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
