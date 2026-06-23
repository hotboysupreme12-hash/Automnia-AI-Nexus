interface SliderFieldProps {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (next: number) => void
}

export function SliderField({ label, value, min = 0, max = 100, step = 1, onChange }: SliderFieldProps) {
  return (
    <label className="grid gap-1">
      <span className="flex items-center justify-between text-sm text-slate-200">
        <span>{label}</span>
        <span className="rounded-md border border-slate-300/20 bg-slate-900/70 px-2 py-0.5 font-semibold text-cyan-100">{value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-slate-700"
      />
    </label>
  )
}
