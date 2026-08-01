import { useEffect, useState, useRef, useContext } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ScrollToPlugin } from 'gsap/ScrollToPlugin';
import { TypeAnimation } from 'react-type-animation';
import { AuthContext } from '../context/AuthContext';
import HeroSection from '../components/HeroSection';
import LanguageNetwork from '../components/LanguageNetwork';

gsap.registerPlugin(ScrollTrigger, ScrollToPlugin);

const SectionHopper = ({ sections, activeSection, onSectionClick }) => {
  return createPortal(
    <nav className="section-hopper">
      <ul>
        {sections.map((section) => (
          <li
            key={section.id}
            className={`hopper-item ${activeSection === section.id ? 'active' : ''}`}
          >
            <button
              aria-current={activeSection === section.id ? 'true' : undefined}
              className="hopper-button"
              onClick={() => onSectionClick(section.id)}
              type="button"
            >
              {section.title}
            </button>
          </li>
        ))}
      </ul>
    </nav>,
    document.body,
  );
};

const AnimatedTitle = ({ text }) => (
  <h2 aria-label={text} className="animated-title">
    <TypeAnimation
      aria-hidden="true"
      sequence={['', 1500, text, 3000, '']}
      wrapper="span"
      cursor={true}
      repeat={Infinity}
      speed={50}
    />
  </h2>
);

const ContentSection = ({ title, children, id }) => (
  <section id={id} className="content-section">
    <div className="content-container">
      {title}
      <div className="content-body">{children}</div>
    </div>
  </section>
);

const ToolkitCarousel = () => {
  const [activeIndex, setActiveIndex] = useState(0);
  const tools = [
    {
      id: 'pomodoro',
      title: 'Pomodoro Timer',
      description:
        'Stay focused and manage your study sessions effectively with a built-in Pomodoro timer. Break down your work into manageable intervals to maximize productivity and prevent burnout.',
      icon: '⏱️',
    },
    {
      id: 'notes',
      title: 'Integrated Notes',
      description:
        'Take notes side-by-side with your code and videos, keeping everything in one place. Never lose track of important concepts or code snippets again.',
      icon: '📝',
    },
    {
      id: 'ai',
      title: 'AI Assistant',
      description:
        'When an AI provider is configured, ask for explanations and code suggestions from the learning workspace.',
      icon: '✨',
    },
    {
      id: 'dsa',
      title: 'DSA Practice',
      description:
        'Browse coding problems and practice solutions in the current challenge workspace.',
      icon: '⌨️',
    },
  ];

  const getCardClassName = (index) => {
    const count = tools.length;
    const offset = (index - activeIndex + count) % count;

    switch (offset) {
      case 0:
        return 'card-center';
      case 1:
        return 'card-right';
      case count - 1:
        return 'card-left';
      default:
        return 'card-hidden';
    }
  };

  return (
    <div className="toolkit-carousel-container">
      {tools.map((tool, index) => (
        <button
          aria-pressed={index === activeIndex}
          key={tool.id}
          className={`toolkit-card ${getCardClassName(index)}`}
          onClick={() => setActiveIndex(index)}
          type="button"
        >
          <span className="card-content">
            <h3>{tool.title}</h3>
            <p>{tool.description}</p>
          </span>
          <span aria-hidden="true" className="card-image toolkit-card-icon">
            {tool.icon}
          </span>
        </button>
      ))}
    </div>
  );
};

const HomePage = () => {
  const componentRef = useRef(null);
  const [activeSection, setActiveSection] = useState('hero');
  const auth = useContext(AuthContext);

  const sections = [
    { id: 'hero', title: 'Intro' },
    { id: 'how-it-works', title: 'The Approach' },
    { id: 'features', title: 'Toolkit' },
    { id: 'mission', title: 'Our Mission' },
    { id: 'cta', title: 'Launch' },
  ];

  const handleHopperClick = (id) => {
    gsap.to(window, {
      duration: 1.5,
      scrollTo: `#${id}`,
      ease: 'power3.inOut',
    });
  };

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.utils.toArray('.content-section').forEach((section) => {
        gsap.from(section.querySelector('.content-container'), {
          scrollTrigger: {
            trigger: section,
            start: 'top 80%',
            end: 'bottom 20%',
            toggleActions: 'play none none reverse',
          },
          opacity: 0,
          y: 100,
          duration: 0.8,
          ease: 'power3.out',
        });
      });

      sections.forEach((section) => {
        ScrollTrigger.create({
          trigger: `#${section.id}`,
          start: 'top 50%',
          end: 'bottom 50%',
          onToggle: (self) => {
            if (self.isActive) {
              setActiveSection(section.id);
            }
          },
        });
      });
    }, componentRef);

    return () => {
      ctx.revert();
    };
  }, []);

  return (
    <div ref={componentRef} className="homepage">
      <SectionHopper
        sections={sections}
        activeSection={activeSection}
        onSectionClick={handleHopperClick}
      />

      <section id="hero">
        <HeroSection />
      </section>

      <ContentSection title={<AnimatedTitle text="A New Way to Learn" />} id="how-it-works">
        <div className="code-block">
          <p className="code-line">
            <span className="code-keyword">const</span>{' '}
            <span className="code-variable">learningJourney</span> ={' '}
            <span className="code-function">()</span> <span className="code-arrow">{'=>'}</span>{' '}
            {'{'}
          </p>
          <p className="code-line indent">
            <span className="code-comment">// Stop watching endless tutorials.</span>
          </p>
          <p className="code-line indent">
            <span className="code-variable">learnBy</span>(
            <span className="code-string">'doing'</span>,{' '}
            <span className="code-string">'not just watching'</span>);
          </p>
          <p className="code-line indent">
            <span className="code-keyword">return</span>{' '}
            <span className="code-string">'Your Personalized AI-Powered Roadmap'</span>;
          </p>
          <p className="code-line">{'}'};</p>
        </div>
      </ContentSection>
      <ContentSection title={<AnimatedTitle text="All-In-One Toolkit" />} id="features">
        <div className="code-block">
          <p className="code-line">
            <span className="code-keyword">import</span> {'{'}{' '}
            <span className="code-variable">Tools</span> {'}'}{' '}
            <span className="code-keyword">from</span>{' '}
            <span className="code-string">'@codewithmee'</span>;
          </p>
          <p className="code-line">
            <span className="code-comment">// Everything you need, right where you need it.</span>
          </p>
        </div>
        <ToolkitCarousel />
      </ContentSection>
      <ContentSection title={<AnimatedTitle text="Our Mission" />} id="mission">
        <div className="code-block">
          <p className="code-line">
            <span className="code-keyword">ourMission</span>(
            <span className="code-variable">learning</span>) {'{'}
          </p>
          <p className="code-line indent">
            <span className="code-keyword">if</span> (
            <span className="code-variable">learning</span> ==={' '}
            <span className="code-string">'a chore'</span>) {'{'}
          </p>
          <p className="code-line indent-2">
            <span className="code-keyword">return</span>{' '}
            <span className="code-string">'make it an adventure'</span>;
          </p>
          <p className="code-line indent">{'}'}</p>
          <p className="code-line">{'}'}</p>
        </div>
        <div className="network-container">
          <LanguageNetwork />
        </div>
      </ContentSection>
      <ContentSection title={<AnimatedTitle text="Ready to Start Your Journey?" />} id="cta">
        <div className="code-block">
          <p className="code-line">
            <span className="code-comment">// Your future self will thank you.</span>
          </p>
          <p className="code-line">
            <span className="code-variable">writeFirstLineOfCode</span>(
            <span className="code-string">'in_minutes'</span>);
          </p>
        </div>
        {!auth.isAuthenticated && (
          <Link to="/auth" className="cta-button">
            Signup / Login
          </Link>
        )}
      </ContentSection>
    </div>
  );
};

export default HomePage;
