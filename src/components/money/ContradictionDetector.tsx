import { motion } from 'framer-motion';

interface Contradiction {
  id: number;
  myth: string;
  reality: string;
  evidence: string;
  impact: string;
}

const CONTRADICTIONS: Contradiction[] = [
  {
    id: 1,
    myth: '"You need money to make money"',
    reality: 'Information + execution > capital. Most $1M+ online businesses started with < $1,000.',
    evidence: '34% of millionaires inherited zero. 76% of startup founders bootstrapped with personal savings under $10K.',
    impact: 'This myth stops millions from starting. The real barrier is skill acquisition, not capital access.',
  },
  {
    id: 2,
    myth: '"Passive income requires no work"',
    reality: 'Passive income requires massive upfront work, then maintenance. Nothing is truly passive.',
    evidence: 'Kindle authors spend 100-300 hours per book. Rental properties require 10-15 hours/mo management.',
    impact: 'Expectation mismatch causes 90%+ dropout in "passive income" pursuits within 6 months.',
  },
  {
    id: 3,
    myth: '"The stock market is gambling"',
    reality: 'Long-term diversified investing has never lost money over any 20-year period in US history.',
    evidence: 'S&P 500 returned 10.2% annualized over the last 100 years. 0 losing 20-year periods since 1871.',
    impact: 'Fear keeps 39% of Americans out of the stock market entirely — costing an estimated $3.3T in lost wealth.',
  },
  {
    id: 4,
    myth: '"Rich people are just lucky"',
    reality: '76% of millionaires are self-made. Consistent habits, not windfalls, build wealth.',
    evidence: 'Average millionaire saves 20%+ of income, invests consistently for 28+ years before hitting $1M.',
    impact: 'Attribution to luck removes agency. Believing wealth is luck-based reduces financial effort by 40%.',
  },
  {
    id: 5,
    myth: '"Debt is always bad"',
    reality: 'Strategic leverage amplifies returns. Bad debt consumes. Good debt produces.',
    evidence: 'Real estate investors average 60-80% LTV. Business credit lines fund inventory at 3-5x ROI.',
    impact: 'Debt aversion costs entrepreneurs an estimated $2.1T in missed growth opportunities annually.',
  },
  {
    id: 6,
    myth: '"You need a high income to build wealth"',
    reality: 'Savings rate matters more than income level. A teacher can out-save a doctor.',
    evidence: 'Households earning $50K-$75K have a 12% millionaire rate. High income with low savings = zero wealth.',
    impact: 'Income comparison creates learned helplessness. Focus shifts from what you earn to what you keep.',
  },
];

export function ContradictionDetector() {
  return (
    <div className="glass-card">
      <div className="glass-card__header">
        <h2 className="font-heading text-[17px] font-bold tracking-[-0.02em]" style={{ color: 'var(--text-0)' }}>
          🔍 Contradiction Detector
        </h2>
        <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-3)' }}>
          Popular money myths vs. what the evidence actually shows
        </p>
      </div>

      <div className="p-5 space-y-3">
        {CONTRADICTIONS.map((c, i) => (
          <motion.div
            key={c.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            className="rounded-xl border overflow-hidden"
            style={{ borderColor: 'var(--border-1)' }}
          >
            <div className="p-4 grid gap-3 md:grid-cols-2">
              {/* Myth side */}
              <div
                className="rounded-lg p-3"
                style={{
                  background: 'rgba(248,113,113,0.04)',
                  border: '1px solid rgba(248,113,113,0.10)',
                }}
              >
                <span
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider mb-1.5"
                  style={{
                    background: 'rgba(248,113,113,0.12)',
                    color: 'var(--accent-ro)',
                  }}
                >
                  ❌ THE MYTH
                </span>
                <p className="text-[12px] font-semibold leading-snug" style={{ color: 'var(--text-1)' }}>
                  {c.myth}
                </p>
              </div>

              {/* Reality side */}
              <div
                className="rounded-lg p-3"
                style={{
                  background: 'rgba(52,211,153,0.04)',
                  border: '1px solid rgba(52,211,153,0.10)',
                }}
              >
                <span
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider mb-1.5"
                  style={{
                    background: 'rgba(52,211,153,0.12)',
                    color: 'var(--accent-em)',
                  }}
                >
                  ✅ THE TRUTH
                </span>
                <p className="text-[12px] font-semibold leading-snug" style={{ color: 'var(--text-1)' }}>
                  {c.reality}
                </p>
              </div>
            </div>

            <div
              className="px-4 py-3 flex flex-wrap items-start gap-4"
              style={{ background: 'var(--surface-1)', borderTop: '1px solid var(--border-0)' }}
            >
              <div className="flex items-start gap-1.5 flex-1 min-w-0">
                <span className="text-[10px] shrink-0">📊</span>
                <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-3)' }}>
                  {c.evidence}
                </p>
              </div>
              <div className="flex items-start gap-1.5 flex-1 min-w-0">
                <span className="text-[10px] shrink-0">⚠️</span>
                <p className="text-[11px] leading-relaxed" style={{ color: 'var(--accent-am)' }}>
                  {c.impact}
                </p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
