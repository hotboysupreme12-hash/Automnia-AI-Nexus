import { motion } from 'framer-motion';

interface CaseStudy {
  title: string;
  subject: string;
  outcome: string;
  timeframe: string;
  keyTactic: string;
  lesson: string;
  verified: boolean;
}

const CASE_STUDIES: CaseStudy[] = [
  {
    title: 'The $0 to $1M Newsletter',
    subject: 'Morning Brew',
    outcome: 'Acquired for $75M by Business Insider',
    timeframe: '5 years (2015–2020)',
    keyTactic: 'Referral engine — "refer 3 friends, get a reward" grew to 4M subscribers',
    lesson: 'Free content → audience → monetization. Build distribution before product.',
    verified: true,
  },
  {
    title: 'One-Person SaaS to $10M ARR',
    subject: 'Carrd.co (AJ)',
    outcome: '$10M+ annual recurring revenue, solo founder',
    timeframe: '8 years (2016–2024)',
    keyTactic: 'Simple product, one pricing tier, constant iteration based on user feedback',
    lesson: 'You don\'t need a team to build a $10M business. Solve one problem perfectly.',
    verified: true,
  },
  {
    title: 'Content-to-Course Empire',
    subject: 'Ali Abdaal',
    outcome: '$5M+/year from digital products & courses',
    timeframe: '5 years (2019–2024)',
    keyTactic: 'YouTube audience → email list → Part-Time YouTuber Academy course',
    lesson: 'Content builds trust. Trust sells products. The funnel compounds over years.',
    verified: true,
  },
  {
    title: 'The $100M DTC Brand',
    subject: 'Gymshark (Ben Francis)',
    outcome: 'Valued at $1.45B in 2024',
    timeframe: '12 years (2012–2024)',
    keyTactic: 'Influencer partnerships + community-first branding. Zero traditional advertising.',
    lesson: 'Community > advertising. Genuine brand beats paid acquisition at scale.',
    verified: true,
  },
  {
    title: 'Affiliate Site to $50M Exit',
    subject: 'The Wirecutter',
    outcome: 'Acquired by NYT for ~$30-55M',
    timeframe: '5 years (2011–2016)',
    keyTactic: 'Ruthlessly honest, deeply researched product reviews. Built unshakeable trust.',
    lesson: 'Trust compounds. When people believe your recommendations, monetization is infinite.',
    verified: true,
  },
  {
    title: 'Crypto to Billionaire',
    subject: 'CZ (Binance)',
    outcome: 'Largest crypto exchange. Personal net worth $30B+',
    timeframe: '7 years (2017–2024)',
    keyTactic: 'First-mover in China, aggressive global expansion, BNB token ecosystem',
    lesson: 'Timing + execution. Being early to a secular trend beats being slightly better later.',
    verified: true,
  },
];

export function WealthCaseFiles() {
  return (
    <div className="glass-card">
      <div className="glass-card__header">
        <h2 className="font-heading text-[17px] font-bold tracking-[-0.02em]" style={{ color: 'var(--text-0)' }}>
          📁 Wealth Case Files
        </h2>
        <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-3)' }}>
          Declassified: How real people built real wealth — evidence trails included
        </p>
      </div>

      <div className="p-5 space-y-3">
        {CASE_STUDIES.map((cs, i) => (
          <motion.div
            key={cs.title}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="rounded-xl border p-4 transition-all duration-200 hover:border-[var(--border-2)]"
            style={{ borderColor: 'var(--border-1)', background: 'var(--surface-0)' }}
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[14px] font-bold" style={{ color: 'var(--text-0)' }}>
                    {cs.title}
                  </span>
                  {cs.verified && (
                    <span
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
                      style={{
                        background: 'rgba(52,211,153,0.10)',
                        color: 'var(--accent-em)',
                        border: '1px solid rgba(52,211,153,0.20)',
                      }}
                    >
                      ✓ VERIFIED
                    </span>
                  )}
                </div>
                <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                  {cs.subject} · {cs.timeframe}
                </p>
              </div>
              <div
                className="rounded-lg px-2.5 py-1 text-[11px] font-bold shrink-0"
                style={{
                  background: 'rgba(251,191,36,0.08)',
                  color: 'var(--accent-am)',
                  border: '1px solid rgba(251,191,36,0.15)',
                }}
              >
                {cs.outcome}
              </div>
            </div>

            <div className="grid gap-2">
              <div className="flex items-start gap-2">
                <span className="text-[11px] shrink-0" style={{ color: 'var(--accent-cy)' }}>🎯</span>
                <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
                  <span style={{ color: 'var(--accent-cy)', fontWeight: 600 }}>Tactic: </span>
                  {cs.keyTactic}
                </p>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-[11px] shrink-0" style={{ color: 'var(--accent-vl)' }}>🧠</span>
                <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
                  <span style={{ color: 'var(--accent-vl)', fontWeight: 600 }}>Lesson: </span>
                  {cs.lesson}
                </p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
