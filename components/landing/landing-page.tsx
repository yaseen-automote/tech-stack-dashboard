"use client";

import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import {
  Radar,
  Globe,
  Network,
  ArrowRight,
  Zap,
  Shield,
  Eye,
  Cpu,
} from "lucide-react";
import Link from "next/link";
import { GridCanvas } from "@/components/landing/grid-canvas";

/* ── Easing ───────────────────────────────────────────────── */
const easeOutQuart = [0.25, 1, 0.5, 1] as const;

/* ── Fade-in wrapper ──────────────────────────────────────── */
function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  return (
    <motion.div
      ref={ref}
      className={className}
      initial={{ opacity: 0, y: 24 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.7, delay, ease: easeOutQuart }}
    >
      {children}
    </motion.div>
  );
}

/* ── Staggered text reveal ────────────────────────────────── */
function StaggerText({ text, className }: { text: string; className?: string }) {
  const words = text.split(" ");
  return (
    <span className={className}>
      {words.map((word, i) => (
        <motion.span
          key={`${word}-${i}`}
          className="inline-block mr-[0.3em]"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.5,
            delay: 0.15 + i * 0.06,
            ease: easeOutQuart,
          }}
        >
          {word}
        </motion.span>
      ))}
    </span>
  );
}

/* ── Animated counter ─────────────────────────────────────── */
function AnimatedNumber({ value, suffix = "" }: { value: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });

  return (
    <motion.span
      ref={ref}
      initial={{ opacity: 0 }}
      animate={inView ? { opacity: 1 } : {}}
      transition={{ duration: 0.4 }}
    >
      {inView ? (
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          {value.toLocaleString()}{suffix}
        </motion.span>
      ) : (
        "0"
      )}
    </motion.span>
  );
}

/* ── Live pulse dot ───────────────────────────────────────── */
function PulseDot() {
  return (
    <span className="relative flex size-2">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-white opacity-40" />
      <span className="relative inline-flex size-2 rounded-full bg-white" />
    </span>
  );
}

/* ══════════════════════════════════════════════════════════════
   LANDING PAGE
   ══════════════════════════════════════════════════════════ */

export function LandingPage() {
  return (
    <div className="min-h-screen bg-black text-neutral-100 overflow-x-hidden selection:bg-white/20 selection:text-white">
      {/* ── Nav ─────────────────────────────────────────── */}
      <nav className="fixed top-0 inset-x-0 z-50 border-b border-white/[0.08] bg-black/60 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2.5 transition-opacity hover:opacity-80">
              <div className="flex size-7 items-center justify-center rounded-lg bg-white/[0.05] text-white border border-white/[0.1] shadow-sm">
                <Radar className="size-4" />
              </div>
              <span className="text-[15px] font-semibold tracking-tight text-white">
                Automote
              </span>
            </Link>
            
            <div className="hidden md:flex items-center gap-6 text-[14px] font-medium text-neutral-400">
              <a href="#capabilities" className="transition-colors hover:text-white">Features</a>
              <a href="#how-it-works" className="transition-colors hover:text-white">Working</a>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="hidden lg:flex items-center gap-2 text-[13px] font-medium text-neutral-400 border border-white/[0.1] rounded-full px-3 py-1 bg-white/[0.02] shadow-sm">
              <PulseDot />
              <span>All systems operational</span>
            </div>
            <Link
              href="/dashboard"
              className="flex h-9 items-center gap-2 rounded-lg bg-white px-4 text-[14px] font-medium text-black transition-all hover:bg-neutral-200 active:scale-[0.98] shadow-[0_0_15px_rgba(255,255,255,0.1)]"
            >
              Open Dashboard
              <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────── */}
      <section className="relative pt-14 border-b border-white/[0.08]">
        <div className="relative min-h-[92vh] flex flex-col justify-center overflow-hidden bg-black">
          <GridCanvas />

          {/* Gradient overlay for text readability */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black" />

          <div className="relative z-10 mx-auto max-w-4xl px-5 py-24 sm:py-32">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, ease: easeOutQuart }}
              className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/[0.1] bg-[#0a0a0a] shadow-sm px-3.5 py-1.5"
            >
              <PulseDot />
              <span className="text-[12px] font-medium text-neutral-300">
                Live DNS intelligence
              </span>
            </motion.div>            <h1 className="text-[clamp(2.4rem,6vw,4.2rem)] font-bold leading-[1.08] tracking-tight text-white">
              <StaggerText text="Know what's running behind every domain." />
            </h1>

            <motion.p
              className="mt-5 max-w-xl text-[15px] leading-7 text-neutral-400"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.5, ease: easeOutQuart }}
            >
              Subdomain enumeration, CNAME resolution, reverse DNS lookups, and tech stack detection.
              Point at a domain, see its infrastructure. No agents, no waiting.
            </motion.p>

            <motion.div
              className="mt-8 flex flex-wrap items-center gap-3"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.65, ease: easeOutQuart }}
            >
              <Link
                href="/dashboard"
                className="inline-flex h-11 items-center gap-2 rounded-lg bg-white px-6 text-[14px] font-semibold text-black transition-all hover:bg-neutral-200 active:scale-[0.98] shadow-md"
              >
                Start scanning
                <ArrowRight className="size-4" />
              </Link>
              <a
                href="#capabilities"
                className="inline-flex h-11 items-center gap-2 rounded-lg border border-white/[0.1] bg-[#0a0a0a] px-6 text-[14px] font-medium text-neutral-300 transition-colors hover:bg-white/[0.05] shadow-sm"
              >
                See capabilities
              </a>
            </motion.div>

            {/* Inline stats */}
            <motion.div
              className="mt-14 flex flex-wrap gap-x-10 gap-y-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.9, ease: easeOutQuart }}
            >
              {[
                { value: 5.78, suffix: "B+", label: "Domains/DNS indexed" },
                { value: 4, suffix: "", label: "Lookup modes" },
                { value: 0.5, suffix: "s", label: "Avg response time" },
              ].map((stat) => (
                <div key={stat.label} className="flex flex-col">
                  <span className="text-2xl font-bold tabular-nums text-white">
                    <AnimatedNumber value={stat.value} suffix={stat.suffix} />
                  </span>
                  <span className="text-[12px] font-medium text-neutral-500">{stat.label}</span>
                </div>
              ))}
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── Capabilities ────────────────────────────────── */}
      <section id="capabilities" className="border-b border-white/[0.08]">
        <div className="mx-auto max-w-6xl px-5 py-24 sm:py-32">
          <Reveal>
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
              Capabilities
            </p>
            <h2 className="mt-3 text-[clamp(1.6rem,4vw,2.6rem)] font-bold leading-[1.12] tracking-tight text-white max-w-lg">
              Four views into any target
            </h2>
          </Reveal>

          <div className="mt-16 grid gap-px bg-white/[0.08] sm:grid-cols-2 lg:grid-cols-4 rounded-xl overflow-hidden border border-white/[0.08] shadow-sm">
            {[
              {
                icon: Radar,
                title: "Domain & Subdomain Discovery",
                description: "Enumerate live subdomains from passive DNS datasets. Classify each host by function: application, CDN, mail, API, internal.",
                delay: 0,
              },
              {
                icon: Globe,
                title: "CNAME Lookup",
                description: "Resolve CNAME chains to find where traffic actually lands. Surface third-party services, CDN configurations, and hosting providers.",
                delay: 0.1,
              },
              {
                icon: Network,
                title: "Reverse DNS",
                description: "Map IP addresses back to hostnames. Identify what else runs on the same infrastructure and discover shared hosting patterns.",
                delay: 0.2,
              },
              {
                icon: Cpu,
                title: "Tech Stack",
                description: "Identify the technologies behind a domain. Detect frameworks, CMS, analytics, CDNs, and security headers in seconds.",
                delay: 0.3,
              },
            ].map((cap) => (
              <Reveal key={cap.title} delay={cap.delay}>
                <div className="bg-black p-8 sm:p-10 h-full">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-white/[0.05] border border-white/[0.05] text-white shadow-sm">
                    <cap.icon className="size-5" />
                  </div>
                  <h3 className="mt-5 text-[16px] font-semibold text-white">
                    {cap.title}
                  </h3>
                  <p className="mt-3 text-[14px] leading-6 text-neutral-400 max-w-xs">
                    {cap.description}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ────────────────────────────────── */}
      <section id="how-it-works" className="border-b border-white/[0.08] bg-[#050505]">
        <div className="mx-auto max-w-6xl px-5 py-24 sm:py-32">
          <Reveal>
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
              How it works
            </p>
            <h2 className="mt-3 text-[clamp(1.6rem,4vw,2.6rem)] font-bold leading-[1.12] tracking-tight text-white max-w-lg">
              From domain to intelligence in seconds
            </h2>
          </Reveal>

          <div className="mt-16 grid gap-12 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                step: "01",
                title: "Enter a target",
                description: "Type a domain name or IP address. The system normalizes your input and validates the target before scanning.",
                icon: Zap,
              },
              {
                step: "02",
                title: "Live enumeration",
                description: "Queries run against passive DNS datasets in real time. Results stream back as they're discovered, no batch processing.",
                icon: Eye,
              },
              {
                step: "03",
                title: "Classified results",
                description: "Each record is automatically classified by type, status, and infrastructure role. Filter, paginate, and export the data you need.",
                icon: Shield,
              },
            ].map((item, i) => (
              <Reveal key={item.step} delay={i * 0.12}>
                <div className="relative">
                  <span className="text-[11px] font-bold tabular-nums text-neutral-600 tracking-wider">
                    {item.step}
                  </span>
                  <h3 className="mt-3 text-[16px] font-semibold text-white">
                    {item.title}
                  </h3>
                  <p className="mt-2.5 text-[14px] leading-6 text-neutral-400">
                    {item.description}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>



      {/* ── CTA ─────────────────────────────────────────── */}
      <section className="bg-[#050505]">
        <div className="mx-auto max-w-6xl px-5 py-24 sm:py-32 text-center">
          <Reveal>
            <h2 className="text-[clamp(1.6rem,4vw,2.8rem)] font-bold leading-[1.1] tracking-tight text-white">
              Stop guessing. Start scanning.
            </h2>
            <p className="mx-auto mt-4 max-w-md text-[15px] leading-7 text-neutral-400">
              Open the dashboard and run your first lookup. No signup, no API keys, no friction.
            </p>
            <div className="mt-8">
              <Link
                href="/dashboard"
                className="inline-flex h-12 items-center gap-2 rounded-lg bg-white px-8 text-[15px] font-semibold text-black transition-all hover:bg-neutral-200 active:scale-[0.98] shadow-lg shadow-white/5"
              >
                Open Dashboard
                <ArrowRight className="size-4" />
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────── */}
      <footer className="border-t border-white/[0.08] py-8 bg-black">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 text-[12px] font-medium text-neutral-500">
          <span>Automote</span>
          <span>DNS intelligence tooling</span>
        </div>
      </footer>
    </div>
  );
}

/* ── Terminal line animation ───────────────────────────────── */

function TerminalLine({
  delay,
  prefix,
  text,
  color = "text-neutral-400",
}: {
  delay: number;
  prefix: string;
  text: string;
  color?: string;
}) {
  return (
    <motion.div
      className="flex gap-3"
      initial={{ opacity: 0, x: -8 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.4, delay, ease: easeOutQuart }}
    >
      <span className="shrink-0 w-4 text-right text-neutral-600">{prefix}</span>
      <span className={color}>{text}</span>
    </motion.div>
  );
}
