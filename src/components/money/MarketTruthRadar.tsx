import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

interface MarketSignal {
  asset: string;
  price: string;
  change: number;
  signal: 'Bullish' | 'Bearish' | 'Neutral';
  insight: string;
}

const MOCK_SIGNALS: MarketSignal[] = [
  { asset: 'S&P 500', price: '$5,842', change: +1.24, signal: 'Bullish', insight: 'Above 200-day MA. Institutional accumulation strong.' },
  { asset: 'Bitcoin', price: '$98,450', change: +3.67, signal: 'Bullish', insight: 'ETF inflows exceed $1B weekly. Halving effect compounding.' },
  { asset: 'NVIDIA (NVDA)', price: '$1,042', change: +2.15, signal: 'Bullish', insight: 'AI chip demand exceeds supply through 2026. P/E compressing.' },
  { asset: 'US Treasuries (10Y)', price: '4.32%', change: -0.08, signal: 'Neutral', insight: 'Yield curve steepening. Rate cut expectations shifting.' },
  { asset: 'Gold', price: '$2,685', change: +0.92, signal: 'Bullish', insight: 'Central bank buying at record levels. Safe haven demand up.' },
  { asset: 'Real Estate (VNQ)', price: '$88.42', change: -0.45, signal: 'Bearish', insight: 'Rate sensitivity weighing on REITs. CRE exposure concerns.' },
  { asset: 'Ethereum', price: '$3,890', change: +2.81, signal: 'Bullish', insight: 'DeFi activity surging. L2 scaling driving adoption.' },
  { asset: 'Oil (WTI)', price: '$72.15', change: -1.33, signal: 'Bearish', insight: 'OPEC+ supply increase expected. Demand growth slowing.' },
];

const ARROW = (n: number) => (n > 0 ? '▲' : n < 0 ? '▼' : '◆');

export function MarketTruthRadar() {
  const [signals] = useState<MarketSignal[]>(MOCK_SIGNALS);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setPulse((p) => !p), 2000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="glass-card">
      <div className="glass-card__header flex items-center justify-between">
        <div>
          <h2 className="font-heading text-[17px] font-bold tracking-[-0.02em]" style={{ color: 'var(--text-0)' }}>
            📡 Market Truth Radar
          </h2>
          <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-3)' }}>
            Live signals — where the evidence points
          </p>
        </div>
        <span
          className="inline-flex h-2 w-2 rounded-full transition-all duration-1000"
          style={{
            background: pulse ? 'var(--accent-em)' : 'var(--accent-cy)',
            boxShadow: pulse
              ? '0 0 8px var(--accent-em)'
              : '0 0 8px var(--accent-cy)',
          }}
        />
      </div>

      <div className="p-4 space-y-2">
        {signals.map((s, i) => (
          <motion.div
            key={s.asset}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
            className="flex items-center justify-between rounded-lg px-3.5 py-2.5 transition-all duration-200 hover:brightness-110"
            style={{ background: 'var(--surface-0)' }}
          >
            <div className="flex items-center gap-3 min-w-0">
              <span
                className="text-[10px] font-bold uppercase tracking-[0.06em] px-2 py-0.5 rounded-md shrink-0"
                style={{
                  background: s.signal === 'Bullish'
                    ? 'rgba(52,211,153,0.12)'
                    : s.signal === 'Bearish'
                      ? 'rgba(248,113,113,0.12)'
                      : 'rgba(148,163,184,0.10)',
                  color: s.signal === 'Bullish'
                    ? 'var(--accent-em)'
                    : s.signal === 'Bearish'
                      ? 'var(--accent-ro)'
                      : 'var(--text-3)',
                }}
              >
                {s.signal}
              </span>
              <div className="min-w-0">
                <span className="text-[13px] font-semibold truncate block" style={{ color: 'var(--text-0)' }}>
                  {s.asset}
                </span>
                <span className="text-[10px] truncate block" style={{ color: 'var(--text-4)' }}>
                  {s.insight}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-3">
              <span className="text-[13px] font-bold tabular-nums" style={{ color: 'var(--text-0)' }}>
                {s.price}
              </span>
              <span
                className="text-[12px] font-semibold tabular-nums"
                style={{
                  color: s.change > 0 ? 'var(--accent-em)' : s.change < 0 ? 'var(--accent-ro)' : 'var(--text-3)',
                }}
              >
                {ARROW(s.change)} {Math.abs(s.change).toFixed(2)}%
              </span>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
