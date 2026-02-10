import React, { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useMobile } from "../hooks/useMobile";
import "./CustomCursor.css";

// Import the new assets
import ArrowIcon from "../assets/images/cursor-arrow.svg";
import HandIcon from "../assets/images/cursor-hand.svg";

const CustomCursor = () => {
  const isMobile = useMobile();
  const cursorRef = useRef(null);
  const [isHovering, setIsHovering] = useState(false);

  useEffect(() => {
    if (isMobile) return;

    // 1. Setup GSAP quickSetters for performance
    const xSet = gsap.quickSetter(cursorRef.current, "x", "px");
    const ySet = gsap.quickSetter(cursorRef.current, "y", "px");

    // 2. Mouse Movement
    const onMouseMove = (e) => {
      xSet(e.clientX);
      ySet(e.clientY);
    };

    // 3. Hover Detection (Event Delegation)
    const onMouseOver = (e) => {
      const target = e.target;
      // Check if target is interactive
      const isInteractive =
        target.tagName === "A" ||
        target.tagName === "BUTTON" ||
        target.closest("a") ||
        target.closest("button") ||
        target.getAttribute("role") === "button" ||
        target.classList.contains("clickable");

      setIsHovering(!!isInteractive);
    };

    // 4. Click Particle Effect
    const onMouseDown = (e) => {
      const particleCount = 8;
      const colors = ["#FFFFFF", "#E0E0E0"]; // White pixels

      for (let i = 0; i < particleCount; i++) {
        // Create particle
        const particle = document.createElement("div");
        particle.style.position = "fixed";
        particle.style.width = "4px";
        particle.style.height = "4px";
        particle.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        particle.style.pointerEvents = "none";
        particle.style.zIndex = "10000";
        particle.style.left = `${e.clientX}px`;
        particle.style.top = `${e.clientY}px`;
        document.body.appendChild(particle);

        // Animate explosion
        const angle = Math.random() * Math.PI * 2;
        const velocity = 20 + Math.random() * 40; // Pixel distance
        const tx = Math.cos(angle) * velocity;
        const ty = Math.sin(angle) * velocity;

        gsap.to(particle, {
          x: tx,
          y: ty,
          opacity: 0,
          duration: 0.6,
          ease: "power2.out",
          onComplete: () => {
            particle.remove();
          },
        });
      }
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseover", onMouseOver);
    window.addEventListener("mousedown", onMouseDown);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseover", onMouseOver);
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [isMobile]);

  if (isMobile) return null;

  return (
    <img
      ref={cursorRef}
      src={isHovering ? HandIcon : ArrowIcon}
      alt="cursor"
      className="Cursor"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        zIndex: 99999,
        pointerEvents: "none",
        width: "24px",
        height: "auto",
        display: "block", // Ensure not hidden
        willChange: "transform"
      }}
    />
  );
};

export default CustomCursor;