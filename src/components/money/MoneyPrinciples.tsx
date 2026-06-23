import { motion } from 'framer-motion';

interface MoneyPrinciple {
  id: number;
  principle: string;
  description: string;
  evidence: string;
  emoji: string;
}

const PRINCIPLES: MoneyPrinciple[] = [
  {
    id: 1,
    principle: 'Value Creation > Value Extraction',
    description: 'Money follows solved problems. Build something people need before asking for payment.',
    evidence: '87% of unicorns are B2B companies solving specific pain points. Revenue follows utility.',
    emoji: '💡',
  },
  {
    id: 2,
    principle: 'Compound Everything',
    description: 'Compound interest, compound skills, compound relationships. Small edges multiplied over time.',
    evidence: 'Investing $500/mo at 10% for 30 years = $1.13M. The first decade looks flat. The third is exponential.',
    emoji: '📈',
  },
  {
    id: 3,
    principle: 'Ownership > Labor',
    description: 'Trading time for money caps upside. Equity, IP, and assets scale without your presence.',
    evidence: 'Top 1% wealth is 90%+ invested assets, not wage income. Median millionaire has 7 income streams.',
    emoji: '🏗️',
  },
  {
    id: 4,
    principle: 'Risk Management Is Profit Protection',
    description: 'Surviving downturns matters more than maximizing upturns. Never risk what you cannot replace.',
    evidence: 'A portfolio dropping 50% needs 100% gain to recover. Diversification is the only free lunch.',
    emoji: '🛡️',
  },
  {
    id: 5,
    principle: 'Tax Efficiency Is Real Returns',
    description: 'A dollar saved in taxes is worth more than a dollar earned. Structure matters as much as income.',
    evidence: 'Tax-advantaged accounts can boost net returns 30-40% over 30 years vs taxable equivalents.',
    emoji: '🧮',
  },
  {
    id: 6,
    principle: 'Information Asymmetry Wins',
    description: 'Learn what others don\'t know. Specialized knowledge compounds faster than general knowledge.',
    evidence: 'Niche experts command 10-50x premiums. Deep expertise in one domain beats broad generalism.',
    emoji: '🔬',
  },
  {
    id: 7,
    principle: 'Liquidity Is Optionality',
    description: 'Cash isn\'t trash — it\'s the ability to act when others can\'t. Dry powder wins during downturns.',
    evidence: 'Warren Buffett holds $300B+ in cash. The best opportunities appear when credit is tightest.',
    emoji: '💧',
  },
  {
    id: 8,
    principle: 'Systems Beat Willpower',
    description: 'Automate savings, investing, and bill payments. Remove yourself from the equation where possible.',
    evidence: 'Automatic enrollment increases 401(k) participation from 40% to 90%+. Defaults define outcomes.',
    emoji: '⚙️',
  },
];

export function MoneyPrinciples() {
  return (
    <div className="glass-card">
      <div className="glass-card__header">
        <h2 className="font-heading text-[17px] font-bold tracking-[-0.02em]" style={{ color: 'var(--text-0)' }}>
          📜 The Evidence-Based Money Principles
        </h2>
        <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-3)' }}>
          What the data actually says about building wealth
        </p>
      </div>

      <div className="p-5 grid gap-4 md:grid-cols-2">
        {PRINCIPLES.map((p, i) => (
          <motion.div
            key={p.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            className="rounded-xl border p-4 transition-all duration-200 hover:border-[var(--border-2)]"
            style={{ borderColor: 'var(--border-1)', background: 'var(--surface-0)' }}
          >
            <div className="flex items-start gap-3">
              <span className="text-2xl shrink-0">{p.emoji}</span>
              <div className="min-w-0">
                <h3 className="text-[13px] font-bold mb-1" style={{ color: 'var(--text-0)' }}>
                  {p.principle}
                </h3>
                <p className="text-[11px] leading-relaxed mb-2" style={{ color: 'var(--text-2)' }}>
                  {p.description}
                </p>
                <div
                  className="rounded-lg px-2.5 py-1.5 text-[10px] leading-relaxed"
                  style={{
                    background: 'rgba(167,139,250,0.06)',
                    border: '1px solid rgba(167,139,250,0.12)',
                    color: 'var(--accent-vl)',
                  }}
                >
                  📊 {p.evidence}
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
