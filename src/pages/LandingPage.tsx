import { motion, useInView, useMotionValue, useSpring, useTransform } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'

function AnimatedCounter({ value, label, suffix = '', prefix = '' }: { value: number; label: string; suffix?: string; prefix?: string }) {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-80px' })
  const motionVal = useMotionValue(0)
  const springVal = useSpring(motionVal, { stiffness: 60, damping: 18 })
  const display = useTransform(springVal, (v) => Math.floor(v))
  const [text, setText] = useState('0')

  useEffect(() => {
    if (inView) motionVal.set(value)
  }, [inView, value, motionVal])

  useEffect(() => {
    const unsub = display.on('change', (v) => setText(prefix + v.toLocaleString() + suffix))
    return unsub
  }, [display, prefix, suffix])

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 24 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6 }}
      className="text-center"
    >
      <div className="font-heading text-4xl sm:text-5xl font-black bg-gradient-to-b from-amber-300 to-amber-500 bg-clip-text text-transparent">
        {text}
      </div>
      <div className="mt-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</div>
    </motion.div>
  )
}

function GlowButton({ children, className = '', onClick }: { children: React.ReactNode; className?: string; onClick?: () => void }) {
  return (
    <motion.button
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      className={`relative overflow-hidden rounded-2xl border px-8 py-4 text-sm font-bold tracking-[0.03em] transition-all duration-300 ${className}`}
      style={{
        borderColor: 'rgba(251,191,36,0.35)',
        background: 'linear-gradient(135deg, rgba(251,191,36,0.12) 0%, rgba(245,158,11,0.06) 100%)',
        color: '#fde68a',
        boxShadow: '0 0 40px rgba(251,191,36,0.08)',
      }}
    >
      <div
        className="absolute inset-0 opacity-0 hover:opacity-100 transition-opacity duration-500"
        style={{ background: 'linear-gradient(135deg, rgba(251,191,36,0.18) 0%, rgba(245,158,11,0.1) 100%)' }}
      />
      <span className="relative z-10 flex items-center gap-2">{children}</span>
    </motion.button>
  )
}

export function LandingPage({ onNavigate }: { onNavigate: (page: string) => void }) {
  const heroRef = useRef(null)
  const heroInView = useInView(heroRef, { once: true })

  return (
    <div className="space-y-24 pb-16">
      {/* ── HERO ── */}
      <motion.section
        ref={heroRef}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="relative pt-8 sm:pt-16 pb-12 text-center"
      >
        {/* Background glow orbs */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full blur-[120px] opacity-20 pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(251,191,36,0.3) 0%, transparent 70%)' }} />
        <div className="absolute top-20 right-0 w-[300px] h-[300px] rounded-full blur-[100px] opacity-10 pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(96,165,250,0.3) 0%, transparent 70%)' }} />

        <motion.div
          initial={{ opacity: 0, y: 32 }}
          animate={heroInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7, delay: 0.1 }}
        >
          <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] mb-6"
            style={{ borderColor: 'rgba(251,191,36,0.25)', background: 'rgba(251,191,36,0.06)', color: '#fde68a' }}>
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            The #1 Wealth Building Platform
          </span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 32 }}
          animate={heroInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7, delay: 0.2 }}
          className="font-heading text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-black tracking-[-0.03em] leading-[1.05] max-w-5xl mx-auto"
        >
          <span className="bg-gradient-to-b from-white via-amber-100 to-amber-400 bg-clip-text text-transparent">
            Build Your Wealth Empire
          </span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 24 }}
          animate={heroInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7, delay: 0.35 }}
          className="mt-6 text-base sm:text-lg text-slate-400 max-w-2xl mx-auto leading-relaxed"
        >
          Proven strategies, powerful tools, and expert guidance to unlock multiple income streams
          and achieve true financial freedom. Join thousands already building their empire.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={heroInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7, delay: 0.5 }}
          className="mt-8 flex flex-wrap items-center justify-center gap-3"
        >
          <GlowButton onClick={() => onNavigate('strategies')}>
            Explore Strategies <span className="text-base">→</span>
          </GlowButton>
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => onNavigate('calculator')}
            className="rounded-2xl border px-8 py-4 text-sm font-bold tracking-[0.03em] transition-all duration-300"
            style={{
              borderColor: 'var(--border-2)',
              background: 'var(--surface-0)',
              color: 'var(--text-2)',
            }}
          >
            Try the Calculator
          </motion.button>
        </motion.div>

        {/* Stats Row */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={heroInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7, delay: 0.7 }}
          className="mt-16 grid grid-cols-3 gap-6 max-w-xl mx-auto"
        >
          <AnimatedCounter value={125000} label="Active Members" suffix="+" />
          <AnimatedCounter value={420000000} label="Wealth Generated" prefix="$" suffix="M+" />
          <AnimatedCounter value={47} label="Proven Strategies" suffix="+" />
        </motion.div>
      </motion.section>

      {/* ── FEATURES GRID ── */}
      <FeaturesSection />

      {/* ── CTA BANNER ── */}
      <CTABanner onNavigate={onNavigate} />

      {/* ── TRUST LOGOS ── */}
      <TrustStrip />
    </div>
  )
}

function FeaturesSection() {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-60px' })

  const features = [
    {
      emoji: '📈',
      title: 'Smart Investing',
      desc: 'AI-powered portfolio strategies that maximize returns while minimizing risk.',
    },
    {
      emoji: '💡',
      title: 'Side Hustle Engine',
      desc: 'Discover high-earning side hustles matched to your skills and schedule.',
    },
    {
      emoji: '🏠',
      title: 'Real Estate Roadmap',
      desc: 'From REITs to rental properties — build your real estate empire step by step.',
    },
    {
      emoji: '🤖',
      title: 'AI Automation',
      desc: 'Set up automated income streams that work for you 24/7 with zero ongoing effort.',
    },
    {
      emoji: '₿',
      title: 'Crypto & Web3',
      desc: 'Navigate the digital economy with expert-curated blockchain strategies.',
    },
    {
      emoji: '📊',
      title: 'Wealth Analytics',
      desc: 'Track your net worth, cash flow, and investments in one powerful dashboard.',
    },
  ]

  return (
    <section ref={ref} className="px-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={inView ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.5 }}
        className="text-center mb-12"
      >
        <h2 className="font-heading text-3xl sm:text-4xl font-bold text-white">
          Everything You Need to <span className="text-amber-400">Build Wealth</span>
        </h2>
        <p className="mt-3 text-slate-500 max-w-xl mx-auto">
          A complete ecosystem of tools, strategies, and insights to grow your money.
        </p>
      </motion.div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl mx-auto">
        {features.map((f, i) => (
          <motion.div
            key={f.title}
            initial={{ opacity: 0, y: 24 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.4, delay: 0.08 * i }}
            whileHover={{ scale: 1.02, y: -2 }}
            className="glass-card p-6 cursor-pointer group"
          >
            <div className="text-3xl mb-3 group-hover:scale-110 transition-transform duration-300">{f.emoji}</div>
            <h3 className="font-semibold text-white text-sm mb-1.5">{f.title}</h3>
            <p className="text-xs text-slate-500 leading-relaxed">{f.desc}</p>
          </motion.div>
        ))}
      </div>
    </section>
  )
}

function CTABanner({ onNavigate }: { onNavigate: (page: string) => void }) {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-60px' })

  return (
    <motion.section
      ref={ref}
      initial={{ opacity: 0, y: 30 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6 }}
      className="mx-4 max-w-4xl mx-auto"
    >
      <div
        className="relative overflow-hidden rounded-3xl border p-10 sm:p-14 text-center"
        style={{
          borderColor: 'rgba(251,191,36,0.18)',
          background: 'linear-gradient(135deg, rgba(251,191,36,0.06) 0%, rgba(245,158,11,0.02) 50%, rgba(251,191,36,0.04) 100%)',
        }}
      >
        <div className="absolute top-0 left-0 w-full h-full opacity-[0.03] pointer-events-none"
          style={{ backgroundImage: 'radial-gradient(circle at 20% 50%, #fbbf24 0%, transparent 60%), radial-gradient(circle at 80% 50%, #f59e0b 0%, transparent 60%)' }}
        />
        <h2 className="relative z-10 font-heading text-2xl sm:text-3xl font-bold text-white">
          Ready to Start Your <span className="text-amber-400">Wealth Journey</span>?
        </h2>
        <p className="relative z-10 mt-3 text-slate-400 max-w-lg mx-auto text-sm">
          Calculate your potential returns and discover the strategies that will transform your financial future.
        </p>
        <div className="relative z-10 mt-7">
          <GlowButton onClick={() => onNavigate('calculator')}>
            Calculate Your Wealth <span className="text-base">💰</span>
          </GlowButton>
        </div>
      </div>
    </motion.section>
  )
}

function TrustStrip() {
  const logos = ['Forbes', 'Bloomberg', 'CNBC', 'Yahoo Finance', 'Business Insider', 'WSJ']

  return (
    <section className="px-4">
      <p className="text-center text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-600 mb-5">
        As Featured In
      </p>
      <div className="flex flex-wrap items-center justify-center gap-8 sm:gap-12 opacity-30">
        {logos.map((logo) => (
          <span key={logo} className="text-sm font-bold text-slate-400 tracking-wider">{logo}</span>
        ))}
      </div>
    </section>
  )
}
