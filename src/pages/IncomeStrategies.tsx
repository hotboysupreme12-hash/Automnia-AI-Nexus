import { motion, useInView } from 'framer-motion'
import { useRef, useState } from 'react'

interface Strategy {
  emoji: string
  title: string
  tagline: string
  description: string
  steps: string[]
  risk: string
  potential: string
  timeframe: string
  color: string
}

const strategies: Strategy[] = [
  {
    emoji: '📈',
    title: 'Stock Market Investing',
    tagline: 'Let your money work for you',
    description: 'Build long-term wealth through disciplined, strategic stock market investing with index funds, dividend stocks, and growth portfolios.',
    steps: [
      'Open a brokerage account (Fidelity, Vanguard, or Schwab)',
      'Start with low-cost index funds like S&P 500 ETFs',
      'Dollar-cost average: invest fixed amount monthly regardless of price',
      'Reinvest all dividends to compound your returns exponentially',
      'Hold for 10+ years — time in the market beats timing the market',
    ],
    risk: 'Medium',
    potential: '$500K – $2M+',
    timeframe: '10-30 years',
    color: '#22d3ee',
  },
  {
    emoji: '💻',
    title: 'Digital Products Empire',
    tagline: 'Create once, sell forever',
    description: 'Build digital assets — ebooks, courses, templates, software — that generate passive income with zero inventory and near-infinite margins.',
    steps: [
      'Identify a skill or knowledge you have that others will pay for',
      'Create a digital product (Notion template, ebook, online course, code boilerplate)',
      'Set up on Gumroad, Teachable, or your own website with Stripe',
      'Build an audience on Twitter/X, LinkedIn, or YouTube with free content',
      'Automate email marketing funnel to convert visitors into buyers 24/7',
    ],
    risk: 'Low',
    potential: '$5K – $100K+/month',
    timeframe: '3-12 months',
    color: '#a78bfa',
  },
  {
    emoji: '🏠',
    title: 'Real Estate Wealth',
    tagline: 'Bricks, mortar, and passive income',
    description: 'Generate cash flow and build equity through real estate — whether through physical rentals, REITs, or crowdfunding platforms.',
    steps: [
      'Start with REITs for passive exposure (Fundrise, RealtyMogul, public REIT ETFs)',
      'House hack: buy a multi-unit property, live in one, rent the others',
      'Use FHA loans with 3.5% down payment for first property',
      'Target cash-flowing markets with growing populations and job markets',
      'Build to 5+ properties then 1031 exchange into commercial real estate',
    ],
    risk: 'Medium-High',
    potential: '$200K – $5M+ equity',
    timeframe: '5-20 years',
    color: '#34d399',
  },
  {
    emoji: '🤖',
    title: 'AI & Automation Income',
    tagline: 'Machines working while you sleep',
    description: 'Leverage artificial intelligence to create automated businesses, content channels, and service platforms that run without your time.',
    steps: [
      'Build AI-powered SaaS micro-tools solving one specific problem',
      'Create faceless YouTube/TikTok channels with AI video generation',
      'Offer AI automation consulting to local businesses (chatbots, workflows)',
      'Build and sell AI prompt packs, agents, or custom GPTs',
      'Use no-code tools (Bubble, Make, n8n) to automate client services',
    ],
    risk: 'Low-Medium',
    potential: '$10K – $500K+/month',
    timeframe: '1-6 months',
    color: '#fbbf24',
  },
  {
    emoji: '₿',
    title: 'Crypto & Web3 Strategy',
    tagline: 'Navigate the digital frontier',
    description: 'Strategically allocate into crypto and decentralized finance for asymmetric returns while managing downside risk.',
    steps: [
      'Allocate 5-10% max of portfolio to crypto — never more than you can lose',
      'Focus on BTC and ETH as foundation (70% of crypto allocation)',
      'Stake ETH and stablecoins for 4-8% APY passive yield',
      'DCA (dollar-cost average) weekly into top 5 by market cap',
      'Use hardware wallet (Ledger/Trezor) — not your keys, not your coins',
    ],
    risk: 'Very High',
    potential: '$50K – $1M+',
    timeframe: '2-10 years',
    color: '#f87171',
  },
  {
    emoji: '🛠️',
    title: 'High-Income Side Hustles',
    tagline: 'Turn skills into cash quickly',
    description: 'Monetize your existing skills or learn high-demand ones to generate immediate cash flow that funds your long-term investments.',
    steps: [
      'Freelance on Upwork/Toptal in: dev, design, writing, or consulting',
      'Tutoring: earn $30-80/hr on Wyzant teaching subjects you know',
      'Flip items: buy underpriced goods on FB Marketplace, resell on eBay',
      'Pet sitting/dog walking via Rover — $500-2K/month part-time',
      'Notion/Excel templates: create once, sell infinitely on Etsy or Gumroad',
    ],
    risk: 'Low',
    potential: '$1K – $20K+/month',
    timeframe: '1 week – 3 months',
    color: '#60a5fa',
  },
]

function StrategyCard({ strategy, index }: { strategy: Strategy; index: number }) {
  const [expanded, setExpanded] = useState(false)
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-40px' })

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 24 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5, delay: index * 0.07 }}
      className="glass-card overflow-hidden cursor-pointer group"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="p-6">
        <div className="flex items-start gap-4">
          <div
            className="flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center text-2xl transition-transform duration-300 group-hover:scale-110"
            style={{ background: `${strategy.color}10`, border: `1px solid ${strategy.color}20` }}
          >
            {strategy.emoji}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-white text-sm mb-0.5">{strategy.title}</h3>
            <p className="text-[11px] text-slate-500 font-medium">{strategy.tagline}</p>
          </div>
          <motion.span
            animate={{ rotate: expanded ? 180 : 0 }}
            className="flex-shrink-0 text-slate-600 text-sm mt-1"
          >
            ▼
          </motion.span>
        </div>

        <p className="mt-3 text-xs text-slate-400 leading-relaxed">{strategy.description}</p>

        <div className="mt-3 flex flex-wrap gap-2">
          <span className="badge">{strategy.risk} Risk</span>
          <span className="badge badge--success">{strategy.potential}</span>
          <span className="badge">{strategy.timeframe}</span>
        </div>
      </div>

      <motion.div
        initial={{ height: 0 }}
        animate={{ height: expanded ? 'auto' : 0 }}
        transition={{ duration: 0.3 }}
        className="overflow-hidden"
      >
        <div
          className="px-6 pb-6 pt-0 border-t mx-6"
          style={{ borderColor: 'var(--border-0)' }}
        >
          <h4 className="mt-4 text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500 mb-3">
            Action Plan
          </h4>
          <ol className="space-y-2.5">
            {strategy.steps.map((step, i) => (
              <li key={i} className="flex gap-3 text-xs text-slate-300 leading-relaxed">
                <span className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
                  style={{ background: `${strategy.color}15`, color: strategy.color }}>
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        </div>
      </motion.div>
    </motion.div>
  )
}

export function IncomeStrategies({ onNavigate }: { onNavigate: (page: string) => void }) {
  const headerRef = useRef(null)
  const headerInView = useInView(headerRef, { once: true })

  return (
    <div className="space-y-8 pb-16">
      <motion.div
        ref={headerRef}
        initial={{ opacity: 0, y: 20 }}
        animate={headerInView ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.5 }}
        className="text-center pt-4"
      >
        <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] mb-4"
          style={{ borderColor: 'rgba(34,211,238,0.25)', background: 'rgba(34,211,238,0.06)', color: '#67e8f9' }}>
          📋 Strategy Playbook
        </span>
        <h1 className="font-heading text-3xl sm:text-4xl font-bold text-white">
          Proven Paths to <span className="text-amber-400">Financial Freedom</span>
        </h1>
        <p className="mt-2 text-sm text-slate-500 max-w-xl mx-auto">
          Click any card to reveal the step-by-step action plan. Pick your path. Execute relentlessly.
        </p>
      </motion.div>

      <div className="grid md:grid-cols-2 gap-4 max-w-5xl mx-auto px-4">
        {strategies.map((s, i) => (
          <StrategyCard key={s.title} strategy={s} index={i} />
        ))}
      </div>

      {/* Bottom CTA */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={headerInView ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.5, delay: 0.6 }}
        className="text-center pt-4"
      >
        <p className="text-sm text-slate-500 mb-4">Want to see what these strategies could earn you?</p>
        <button
          onClick={() => onNavigate('calculator')}
          className="btn btn--primary px-8 py-3 text-sm"
        >
          Run the Numbers →
        </button>
      </motion.div>
    </div>
  )
}
