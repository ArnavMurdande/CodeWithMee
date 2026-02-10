import React, { useEffect, useRef } from 'react';

// Styles are embedded directly to prevent import errors.
const LanguageNetworkStyles = () => (
  <style>
    {`
      .language-network-canvas {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 0;
      }
    `}
  </style>
);


const LanguageNetwork = () => {
  const canvasRef = useRef(null);
  let animationFrameId;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let nodes = [];
    let links = [];

    const languages = [
      'Python', 'Java', 'C++', 'SQL', 'Go', 'C#', 'Ruby', 'PHP', 'R', 'Swift',
      'Kotlin', 'TS', 'Rust', 'Scala', 'Perl', 'MATLAB', 'Dart', 'Assembly'
    ];

    let width, height;

    const resizeCanvas = () => {
      width = canvas.offsetWidth;
      height = canvas.offsetHeight;
      canvas.width = width * window.devicePixelRatio;
      canvas.height = height * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };

    const init = () => {
      resizeCanvas();

      nodes = languages.map((lang) => {
        const radius = window.innerWidth < 768 ? 20 : 30;
        return {
          id: lang,
          x: radius + Math.random() * (width - radius * 2),
          y: radius + Math.random() * (height - radius * 2),
          // MODIFIED: Reduced the initial velocity for a slower floating speed.
          vx: (Math.random() - 0.5) * 0.5,
          vy: (Math.random() - 0.5) * 0.5,
          radius: radius,
          mass: 1,
          shake: 0,
        };
      });

      links = [];
      // MODIFIED: Decreased the chance of a link forming to reduce connectivity.
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          if (Math.random() > 0.95) { // Was 0.9, now creates fewer links
            links.push({ source: nodes[i], target: nodes[j] });
          }
        }
      }

      // Ensure every node has at least one connection.
      nodes.forEach(node => {
        const isConnected = links.some(link => link.source === node || link.target === node);
        if (!isConnected && nodes.length > 1) {
          let otherNode;
          do {
            otherNode = nodes[Math.floor(Math.random() * nodes.length)];
          } while (otherNode === node);
          links.push({ source: node, target: otherNode });
        }
      });
    };
    
    const createShakeRipple = (clickedNode) => {
        if (clickedNode.shake > 0) return;
        clickedNode.shake = 30;
        links.forEach(link => {
            if (link.source === clickedNode && link.target.shake <= 0) {
                link.target.shake = 20;
            }
            if (link.target === clickedNode && link.source.shake <= 0) {
                link.source.shake = 20;
            }
        });
    };

    const handleClick = (event) => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      nodes.forEach(node => {
        const dist = Math.sqrt((x - node.x) ** 2 + (y - node.y) ** 2);
        if (dist < node.radius) {
          createShakeRipple(node);
        }
      });
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);

      ctx.strokeStyle = 'rgba(200, 200, 255, 0.4)';
      // MODIFIED: Increased line thickness for better visibility.
      ctx.lineWidth = 2;
      links.forEach(link => {
        ctx.beginPath();
        ctx.moveTo(link.source.x, link.source.y);
        ctx.lineTo(link.target.x, link.target.y);
        ctx.stroke();
      });

      nodes.forEach(node => {
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, 2 * Math.PI);
        ctx.fillStyle = '#FFFFFF';
        ctx.fill();
        ctx.strokeStyle = '#CCCCCC';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = '#1E1E23';
        ctx.font = `bold ${window.innerWidth < 768 ? '11px' : '12px'} 'Martian Mono', monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(node.id, node.x, node.y);
      });
    };

    const update = () => {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const nodeA = nodes[i];
          const nodeB = nodes[j];
          const dx = nodeB.x - nodeA.x;
          const dy = nodeB.y - nodeA.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          const min_dist = nodeA.radius + nodeB.radius;

          if (distance < min_dist) {
            const overlap = (min_dist - distance) / 2;
            const nx = dx / distance;
            const ny = dy / distance;
            nodeA.x -= overlap * nx;
            nodeA.y -= overlap * ny;
            nodeB.x += overlap * nx;
            nodeB.y += overlap * ny;

            const p = 2 * (nodeA.vx * nx + nodeA.vy * ny - nodeB.vx * nx - nodeB.vy * ny) / (nodeA.mass + nodeB.mass);
            nodeA.vx -= p * nodeB.mass * nx;
            nodeA.vy -= p * nodeB.mass * ny;
            nodeB.vx += p * nodeA.mass * nx;
            nodeB.vy += p * nodeA.mass * ny;
          }
        }
      }

      nodes.forEach(node => {
        if (node.shake > 0) {
            node.shake -= 1;
            const shakeFrequency = 0.8;
            const shakeAmplitude = 0.2;
            node.vx += Math.sin(node.shake * shakeFrequency) * shakeAmplitude;
            node.vy += Math.cos(node.shake * shakeFrequency) * shakeAmplitude;
        }
        
        node.x += node.vx;
        node.y += node.vy;

        if (node.x - node.radius < 0) {
            node.x = node.radius;
            node.vx *= -1;
        } else if (node.x + node.radius > width) {
            node.x = width - node.radius;
            node.vx *= -1;
        }

        if (node.y - node.radius < 0) {
            node.y = node.radius;
            node.vy *= -1;
        } else if (node.y + node.radius > height) {
            node.y = height - node.radius;
            node.vy *= -1;
        }
      });
    };

    const animate = () => {
      update();
      draw();
      animationFrameId = requestAnimationFrame(animate);
    };

    init();
    animate();

    const resizeObserver = new ResizeObserver(init);
    resizeObserver.observe(canvas.parentElement);
    canvas.addEventListener('click', handleClick);

    return () => {
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      canvas.removeEventListener('click', handleClick);
    };
  }, []);

  return (
    <>
      <LanguageNetworkStyles />
      <canvas ref={canvasRef} className="language-network-canvas"></canvas>
    </>
  );
};

export default LanguageNetwork;