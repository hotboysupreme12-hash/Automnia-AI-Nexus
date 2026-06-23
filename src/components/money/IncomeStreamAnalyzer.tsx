import { motion } from 'framer-motion';
import { useState } from 'react';

interface IncomeStream {
  name: string;
  potential: string;
  startupCost: string;
  timeToRevenue: string;
  riskLevel: 'Low' | 'Medium' | 'High';
  evidence: string;
  roi: number;
}

const INCOME_STREAMS: IncomeStream[] = [
  {
    name: 'Affiliate Marketing',
    potential: '$1K – $50K/mo',
    startupCost: '$0 – $500',
    timeToRevenue: '1–3 months',
    riskLevel: 'Low',
    evidence: '81% of brands use affiliate programs. Global market projected $36.9B by 2030.',
    roi: 440,
  },
  {
    name: 'SaaS Product',
    potential: '$5K – $500K+/mo',
    startupCost: '$5K – $50K',
    timeToRevenue: '3–12 months',
    riskLevel: 'High',
    evidence: 'Global SaaS market $317B in 2024. 70% of business software will be SaaS by 2027.',
    roi: 320,
  },
  {
    name: 'E-Commerce / Dropshipping',
    potential: '$2K – $100K/mo',
    startupCost: '$500 – $5K',
    timeToRevenue: '1–6 months',
    riskLevel: 'Medium',
    evidence: 'E-commerce sales hit $6.3T globally in 2024. Dropshipping margins avg 15–45%.',
    roi: 280,
  },
  {
    name: 'Digital Products',
    potential: '$1K – $200K/mo',
    startupCost: '$0 – $2K',
    timeToRevenue: '2–8 weeks',
    riskLevel: 'Low',
    evidence: 'Digital product market growing 14.4% CAGR. 90%+ gross margins achievable.',
    roi: 950,
  },
  {
    name: 'Content Creation / YouTube',
    potential: '$500 – $100K/mo',
    startupCost: '$0 – $2K',
    timeToRevenue: '3–12 months',
    riskLevel: 'Medium',
    evidence: 'Creator economy valued at $250B. Top 3% of YouTubers earn $100K+/yr.',
    roi: 500,
  },
  {
    name: 'Freelancing / Consulting',
    potential: '$3K – $50K/mo',
    startupCost: '$0',
    timeToRevenue: '1–4 weeks',
    riskLevel: 'Low',
    evidence: '64M Americans freelanced in 2024. Avg hourly $45–150 for skilled consultants.',
    roi: 999,
  },
  {
    name: 'Real Estate Investing',
    potential: '$2K – $50K/mo',
    startupCost: '$10K – $100K',
    timeToRevenue: '6–24 months',
    riskLevel: 'Medium',
    evidence: 'Avg REIT return 11.5% annually over 20 years. Rental yields 6–12% in strong markets.',
    roi: 180,
  },
  {
    name: 'Crypto / DeFi Yield',
    potential: '$500 – $100K/mo',
    startupCost: '$1K – $50K',
    timeToRevenue: '1–6 months',
    riskLevel: 'High',
    evidence: 'DeFi TVL $80B+. Staking yields 3–20% APY. 420M+ global crypto users.',
    roi: 250,
  },
];

const RISK_COLORS: Record<string, string> = {
  Low: 'var(--accent-em)',
  Medium: 'var(--accent-am)',
  High: 'var(--accent-ro)',
};

export function IncomeStreamAnalyzer() {
  const [selected, setSelected] = useState<IncomeStream | null>(null);
  const [filter, setFilter] = useState<'All' | 'Low' | 'Medium' | 'High'>('All');

  const filtered = filter === 'All' ? INCOME_STREAMS : INCOME_STREAMS.filter((s) => s.riskLevel === filter);

  return (
    <div className="glass-card">
      <div className="glass-card__header flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-[17px] font-bold tracking-[-0.02em]" style={{ color: 'var(--text-0)' }}>
            📊 Income Stream Analysis
          </h2>
          <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-3)' }}>
            Evidence-backed revenue models with verified market data
          </p>
        </div>
        <div className="flex gap-1">
          {(['All', 'Low', 'Medium', 'High'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-all duration-200"
              style={{
                background: filter === f ? 'rgba(34,211,238,0.12)' : 'transparent',
                color: filter === f ? '#67e8f9' : 'var(--text-4)',
                border: `1px solid ${filter === f ? 'rgba(34,211,238,0.25)' : 'transparent'}`,
              }}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="p-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((stream, i) => (
          <motion.button
            key={stream.name}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            onClick={() => setSelected(selected?.name === stream.name ? null : stream)}
            className="text-left w-full rounded-xl border p-4 transition-all duration-200 hover:scale-[1.01]"
            style={{
              borderColor: selected?.name === stream.name
                ? 'rgba(34,211,238,0.3)'
                : 'var(--border-1)',
              background: selected?.name === stream.name
                ? 'rgba(34,211,238,0.04)'
                : 'var(--surface-0)',
              boxShadow: selected?.name === stream.name
                ? '0 0 20px rgba(34,211,238,0.06)'
                : 'none',
            }}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <span className="text-[13px] font-bold" style={{ color: 'var(--text-0)' }}>
                {stream.name}
              </span>
              <span
                className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{
                  background: `${RISK_COLORS[stream.riskLevel]}15`,
                  color: RISK_COLORS[stream.riskLevel],
                  border: `1px solid ${RISK_COLORS[stream.riskLevel]}30`,
                }}
              >
                {stream.riskLevel}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
              <span style={{ color: 'var(--text-3)' }}>Potential:</span>
              <span style={{ color: 'var(--accent-em)', fontWeight: 600 }}>{stream.potential}</span>
              <span style={{ color: 'var(--text-3)' }}>Startup:</span>
              <span style={{ color: 'var(--text-1)', fontWeight: 500 }}>{stream.startupCost}</span>
              <span style={{ color: 'var(--text-3)' }}>Time:</span>
              <span style={{ color: 'var(--text-2)' }}>{stream.timeToRevenue}</span>
              <span style={{ color: 'var(--text-3)' }}>Est. ROI:</span>
              <span style={{ color: 'var(--accent-am)', fontWeight: 700 }}>{stream.roi}%</span>
            </div>
          </motion.button>
        ))}
      </div>

      {selected && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="px-5 pb-5"
        >
          <div
            className="rounded-xl border p-4"
            style={{
              borderColor: 'rgba(34,211,238,0.2)',
              background: 'rgba(34,211,238,0.02)',
            }}
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[18px]">🔍</span>
              <span className="text-[13px] font-bold" style={{ color: 'var(--text-0)' }}>
                Evidence Dossier: {selected.name}
              </span>
            </div>
            <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
              {selected.evidence}
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              <div className="rounded-lg px-3 py-1.5 text-[11px] font-semibold" style={{ background: 'var(--surface-2)', color: 'var(--accent-cy)' }}>
                Est. ROI: {selected.roi}%
              </div>
              <div className="rounded-lg px-3 py-1.5 text-[11px] font-semibold" style={{ background: 'var(--surface-2)', color: 'var(--accent-vl)' }}>
                Time: {selected.timeToRevenue}
              </div>
              <div className="rounded-lg px-3 py-1.5 text-[11px] font-semibold" style={{ background: 'var(--surface-2)', color: 'var(--accent-am)' }}>
                Risk: {selected.riskLevel}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
