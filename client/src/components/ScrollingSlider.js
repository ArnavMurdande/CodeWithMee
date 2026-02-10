    import React, { useEffect, useRef } from 'react';
    import { gsap } from 'gsap';
    import { ScrollTrigger } from 'gsap/ScrollTrigger';
    import './ScrollingSlider.css';

    gsap.registerPlugin(ScrollTrigger);

    const ScrollingSlider = () => {
        const componentRef = useRef(null);
        
        useEffect(() => {
            const ctx = gsap.context(() => {
                const slides = gsap.utils.toArray('.slide');
                const slidesContainer = document.querySelector('.slide-container');

                gsap.timeline({
                    scrollTrigger: {
                        trigger: slidesContainer,
                        start: "top top",
                        end: () => "+=" + (slidesContainer.offsetWidth * (slides.length -1)),
                        scrub: 1,
                        pin: true,
                        anticipatePin: 1,
                        snap: {
                            snapTo: 1 / (slides.length - 1),
                            duration: 0.3,
                            ease: "power1.inOut"
                        }
                    }
                })
                .to(slides, {
                    xPercent: -100 * (slides.length - 1),
                    ease: "none"
                });

            }, componentRef);
            return () => ctx.revert(); // cleanup
        }, []);

        return (
            <div ref={componentRef}>
                <div className="slide-container">
                    <section id="slide-1" className="slide">
                        <img src="https://placehold.co/1920x1080/1a1a1a/ffffff?text=Section+1" className="bg-img" alt="Section 1"/>
                        <h2 className="slide-title">Section One</h2>
                    </section>
                    <section id="slide-2" className="slide">
                        <img src="https://placehold.co/1920x1080/2a2a2a/ffffff?text=Section+2" className="bg-img" alt="Section 2"/>
                        <h2 className="slide-title">Section Two</h2>
                    </section>
                    <section id="slide-3" className="slide">
                        <img src="https://placehold.co/1920x1080/3a3a3a/ffffff?text=Section+3" className="bg-img" alt="Section 3"/>
                        <h2 className="slide-title">Section Three</h2>
                    </section>
                    <section id="slide-4" className="slide">
                        <img src="https://placehold.co/1920x1080/4a4a4a/ffffff?text=Section+4" className="bg-img" alt="Section 4"/>
                        <h2 className="slide-title">Section Four</h2>
                    </section>
                </div>
            </div>
        );
    };

    export default ScrollingSlider;
    
