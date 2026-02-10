import React, { useEffect, useState, useRef, useContext } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ScrollToPlugin } from "gsap/ScrollToPlugin";
import { TypeAnimation } from "react-type-animation";
import { AuthContext } from "../context/AuthContext";
import HeroSection from "../components/HeroSection";
import LanguageNetwork from "../components/LanguageNetwork";
import "./HomePage.css";
import promoVideo from "../assets/videos/Aaj Ki Raat.mp4";

gsap.registerPlugin(ScrollTrigger, ScrollToPlugin);

const soundManager = {
  sounds: {},
  isEnabled: false,
  init() {
    this.loadSound(
      "hover",
      "https://assets.codepen.io/7558/click-reverb-001.mp3",
      0.15,
    );
    this.loadSound(
      "click",
      "https://assets.codepen.io/7558/shutter-fx-001.mp3",
      0.3,
    );
  },
  loadSound(name, url, volume) {
    if (typeof Audio !== "undefined") {
      const audio = new Audio(url);
      audio.preload = "auto";
      audio.volume = volume;
      this.sounds[name] = audio;
    }
  },
  enableAudio() {
    if (!this.isEnabled && typeof Audio !== "undefined") {
      this.isEnabled = true;
      const silentSound = new Audio(
        "data:audio/mp3;base64,SUQzBAAAAAABEVRYWFgAAAAtAAADY29tbWVudABCaWdTb3VuZEJhbmsuY29tIC8gTGFTb25vdGhlcXVlLm9yZwBURU5DAAAAHQAAA1N3aXRjaCBQbHVzIMKpIE5DSCBTb2Z0d2FyZQBUSVQyAAAABgAAAzIyMzUAVFNTRQAAAA8AAANMYXZmNTcuODMuMTAw",
      );
      silentSound.play().catch(() => {});
    }
  },
  play(soundName) {
    if (this.isEnabled && this.sounds[soundName]) {
      this.sounds[soundName].currentTime = 0;
      this.sounds[soundName]
        .play()
        .catch((e) => console.log("Audio play failed.", e));
    }
  },
};
soundManager.init();

// ... imports

const SectionHopper = ({
  sections,
  activeSection,
  onSectionClick,
  onSectionHover,
}) => {
  return createPortal(
    <nav className="section-hopper">
      <ul>
        {sections.map((section) => (
          <li
            key={section.id}
            className={`hopper-item ${activeSection === section.id ? "active" : ""}`}
            onClick={() => onSectionClick(section.id)}
            onMouseEnter={onSectionHover}
          >
            {section.title}
          </li>
        ))}
      </ul>
    </nav>,
    document.body,
  );
};

const AnimatedTitle = ({ text }) => (
  <h2 className="animated-title">
    <TypeAnimation
      sequence={["", 1500, text, 3000, ""]}
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
      id: "pomodoro",
      title: "Pomodoro Timer",
      description:
        "Stay focused and manage your study sessions effectively with a built-in Pomodoro timer. Break down your work into manageable intervals to maximize productivity and prevent burnout.",
      image: "https://placehold.co/400x300/a900ff/FFFFFF?text=Timer+UI",
    },
    {
      id: "notes",
      title: "Integrated Notes",
      description:
        "Take notes side-by-side with your code and videos, keeping everything in one place. Never lose track of important concepts or code snippets again.",
      image: "https://placehold.co/400x300/00f8f1/FFFFFF?text=Notes+App",
    },
    {
      id: "ai",
      title: "AI Assistant",
      description:
        "Get instant help, explanations, and code suggestions from a powerful AI assistant. Overcome challenges and understand complex topics with personalized guidance.",
      image: "https://placehold.co/400x300/fe848f/FFFFFF?text=AI+Chat",
    },
    {
      id: "dsa",
      title: "DSA Practice",
      description:
        "Solve curated Data Structures & Algorithms problems to sharpen your coding skills. Rise through the ranks, earn badges, and prepare for technical interviews.",
      image: "https://placehold.co/400x300/ffbd1e/FFFFFF?text=Challenges",
    },
  ];

  const getCardClassName = (index) => {
    const count = tools.length;
    const offset = (index - activeIndex + count) % count;

    switch (offset) {
      case 0:
        return "card-center";
      case 1:
        return "card-right";
      case count - 1:
        return "card-left";
      default:
        return "card-hidden";
    }
  };

  return (
    <div className="toolkit-carousel-container">
      {tools.map((tool, index) => (
        <div
          key={tool.id}
          className={`toolkit-card ${getCardClassName(index)}`}
          onClick={() => setActiveIndex(index)}
        >
          <div className="card-content">
            <h3>{tool.title}</h3>
            <p>{tool.description}</p>
          </div>
          <div className="card-image">
            <img src={tool.image} alt={tool.title} />
          </div>
        </div>
      ))}
    </div>
  );
};

const HomePage = () => {
  const componentRef = useRef(null);
  const [activeSection, setActiveSection] = useState("hero");
  const auth = useContext(AuthContext);

  const sections = [
    { id: "hero", title: "Intro" },
    { id: "how-it-works", title: "The Approach" },
    { id: "features", title: "Toolkit" },
    { id: "mission", title: "Our Mission" },
    { id: "cta", title: "Launch" },
  ];

  const handleHopperClick = (id) => {
    soundManager.enableAudio();
    soundManager.play("click");
    gsap.to(window, {
      duration: 1.5,
      scrollTo: `#${id}`,
      ease: "power3.inOut",
    });
  };

  const handleHopperHover = () => {
    soundManager.enableAudio();
    soundManager.play("hover");
  };

  useEffect(() => {
    window.addEventListener("click", soundManager.enableAudio, { once: true });

    const ctx = gsap.context(() => {
      gsap.utils.toArray(".content-section").forEach((section) => {
        gsap.from(section.querySelector(".content-container"), {
          scrollTrigger: {
            trigger: section,
            start: "top 80%",
            end: "bottom 20%",
            toggleActions: "play none none reverse",
          },
          opacity: 0,
          y: 100,
          duration: 0.8,
          ease: "power3.out",
        });
      });

      sections.forEach((section) => {
        ScrollTrigger.create({
          trigger: `#${section.id}`,
          start: "top 50%",
          end: "bottom 50%",
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
      window.removeEventListener("click", soundManager.enableAudio);
    };
  }, []);

  return (
    <div ref={componentRef} className="homepage">
      <SectionHopper
        sections={sections}
        activeSection={activeSection}
        onSectionClick={handleHopperClick}
        onSectionHover={handleHopperHover}
      />

      <section id="hero">
        <HeroSection />
      </section>

      <ContentSection
        title={<AnimatedTitle text="A New Way to Learn" />}
        id="how-it-works"
      >
        <div className="code-block">
          <p className="code-line">
            <span className="code-keyword">const</span>{" "}
            <span className="code-variable">learningJourney</span> ={" "}
            <span className="code-function">()</span>{" "}
            <span className="code-arrow">{"=>"}</span> {"{"}
          </p>
          <p className="code-line indent">
            <span className="code-comment">
              // Stop watching endless tutorials.
            </span>
          </p>
          <p className="code-line indent">
            <span className="code-variable">learnBy</span>(
            <span className="code-string">'doing'</span>,{" "}
            <span className="code-string">'not just watching'</span>);
          </p>
          <p className="code-line indent">
            <span className="code-keyword">return</span>{" "}
            <span className="code-string">
              'Your Personalized AI-Powered Roadmap'
            </span>
            ;
          </p>
          <p className="code-line">{"}"};</p>
        </div>
        <div className="video-container">
          <video
            src={promoVideo}
            controls
            playsInline
            title="CodeWithMee promo video"
          />
        </div>
      </ContentSection>
      <ContentSection
        title={<AnimatedTitle text="All-In-One Toolkit" />}
        id="features"
      >
        <div className="code-block">
          <p className="code-line">
            <span className="code-keyword">import</span> {"{"}{" "}
            <span className="code-variable">Tools</span> {"}"}{" "}
            <span className="code-keyword">from</span>{" "}
            <span className="code-string">'@codewithmee'</span>;
          </p>
          <p className="code-line">
            <span className="code-comment">
              // Everything you need, right where you need it.
            </span>
          </p>
        </div>
        <ToolkitCarousel />
      </ContentSection>
      <ContentSection title={<AnimatedTitle text="Our Mission" />} id="mission">
        <div className="code-block">
          <p className="code-line">
            <span className="code-keyword">ourMission</span>(
            <span className="code-variable">learning</span>) {"{"}
          </p>
          <p className="code-line indent">
            <span className="code-keyword">if</span> (
            <span className="code-variable">learning</span> ==={" "}
            <span className="code-string">'a chore'</span>) {"{"}
          </p>
          <p className="code-line indent-2">
            <span className="code-keyword">return</span>{" "}
            <span className="code-string">'make it an adventure'</span>;
          </p>
          <p className="code-line indent">{"}"}</p>
          <p className="code-line">{"}"}</p>
        </div>
        <div className="network-container">
          <LanguageNetwork />
        </div>
      </ContentSection>
      <ContentSection
        title={<AnimatedTitle text="Ready to Start Your Journey?" />}
        id="cta"
      >
        <div className="code-block">
          <p className="code-line">
            <span className="code-comment">
              // Your future self will thank you.
            </span>
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
