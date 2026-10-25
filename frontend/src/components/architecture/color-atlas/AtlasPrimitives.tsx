import type { ReactNode } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { architectureSourceUrl } from '@/data/architectureExperience'

export type AtlasText = (zh: string, en: string) => string

export function AtlasPaper({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`ca-paper ${className}`}>{children}</div>
}

/** A visual waveform, not the measured amplitude of a retrieved audio file. */
export function AtlasWaveform({ className = '', seed = 1 }: { className?: string; seed?: number }) {
  return <svg className={`ca-waveform ${className}`} viewBox="0 0 360 72" preserveAspectRatio="none" aria-hidden="true">
    {Array.from({ length: 72 }, (_, index) => {
      const height = 7 + Math.abs(Math.sin(index * 1.83 + seed) * Math.cos(index * .16 + seed)) * 57
      return <line key={index} x1={index * 5 + 2} x2={index * 5 + 2} y1={(72 - height) / 2} y2={(72 + height) / 2} stroke="currentColor" strokeWidth="1.7" />
    })}
  </svg>
}

export function AtlasSourceLink({ path, children }: { path: string; children: ReactNode }) {
  return <a className="ca-source-link" href={architectureSourceUrl(path)} target="_blank" rel="noreferrer">{children}<ArrowUpRight size={13} aria-hidden="true" /></a>
}
