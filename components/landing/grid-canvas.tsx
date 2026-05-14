"use client";

import { useEffect, useRef } from "react";

/**
 * An animated canvas background that draws a perspective grid
 * with scanning beams, simulating live infrastructure recon.
 * Pure canvas, no DOM nodes, no layout cost.
 */
export function GridCanvas({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf: number;
    let t = 0;

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas!.getBoundingClientRect();
      canvas!.width = rect.width * dpr;
      canvas!.height = rect.height * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function draw() {
      const w = canvas!.getBoundingClientRect().width;
      const h = canvas!.getBoundingClientRect().height;

      // Prevent NaN math errors if layout hasn't assigned dimensions yet
      if (w <= 0 || h <= 0) {
        raf = requestAnimationFrame(draw);
        return;
      }

      ctx!.clearRect(0, 0, w, h);

      // Horizontal grid lines with perspective fade
      const lineCount = 28;
      for (let i = 0; i < lineCount; i++) {
        const progress = i / lineCount;
        const y = h * 0.3 + progress * h * 0.7;
        const opacity = 0.02 + progress * 0.08;
        ctx!.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
        ctx!.lineWidth = 0.5;
        ctx!.beginPath();
        ctx!.moveTo(0, y);
        ctx!.lineTo(w, y);
        ctx!.stroke();
      }

      // Vertical grid lines
      const vLines = 20;
      for (let i = 0; i <= vLines; i++) {
        const x = (i / vLines) * w;
        const opacity = 0.01 + Math.abs(i / vLines - 0.5) * 0.06;
        ctx!.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
        ctx!.lineWidth = 0.5;
        ctx!.beginPath();
        ctx!.moveTo(x, h * 0.3);
        ctx!.lineTo(x, h);
        ctx!.stroke();
      }

      // Scanning beam (horizontal)
      const beamY = h * 0.3 + ((t * 0.3) % (h * 0.7));
      const beamGrad = ctx!.createLinearGradient(0, beamY - 1, 0, beamY + 40);
      beamGrad.addColorStop(0, "rgba(255, 255, 255, 0.08)");
      beamGrad.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx!.fillStyle = beamGrad;
      ctx!.fillRect(0, beamY, w, 40);

      // Dot pulse at intersections near the beam
      const dotCount = 6;
      for (let i = 0; i < dotCount; i++) {
        const dx = (w / (dotCount + 1)) * (i + 1);
        const dy = beamY + Math.sin(t * 0.02 + i) * 8;
        if (dy > h * 0.3 && dy < h) {
          const pulse = 0.1 + Math.sin(t * 0.05 + i * 1.2) * 0.15;
          ctx!.beginPath();
          ctx!.arc(dx, dy, 2, 0, Math.PI * 2);
          ctx!.fillStyle = `rgba(255, 255, 255, ${pulse})`;
          ctx!.fill();
        }
      }

      // Vertical scan line
      const scanX = w * 0.5 + Math.sin(t * 0.008) * w * 0.4;
      const scanGrad = ctx!.createLinearGradient(scanX - 30, 0, scanX + 30, 0);
      scanGrad.addColorStop(0, "rgba(255, 255, 255, 0)");
      scanGrad.addColorStop(0.5, "rgba(255, 255, 255, 0.03)");
      scanGrad.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx!.fillStyle = scanGrad;
      ctx!.fillRect(scanX - 30, h * 0.3, 60, h * 0.7);

      t += 1;
      raf = requestAnimationFrame(draw);
    }

    resize();
    draw();
    window.addEventListener("resize", resize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
      aria-hidden="true"
    />
  );
}
