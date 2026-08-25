'use client'

import dynamic from 'next/dynamic'
import { Bot, Cpu, Wrench } from 'lucide-react'

const DotGridCanvas = dynamic(
  () => import('./dot-grid').then((m) => m.DotGrid),
  { ssr: false }
)

export function DotGridClient() {
  return (
    <>
      <DotGridCanvas />
      {/* Aesthetic Background Doodles */}
      <div 
        className="fixed inset-0 pointer-events-none z-[-1] overflow-hidden" 
        style={{ opacity: 0.04 }} // Very faint, notebook doodle vibe
        aria-hidden
      >
        {/* Wrench doodle - top right */}
        <div className="absolute top-[10%] right-[15%] rotate-45 transform">
          <Wrench size={400} strokeWidth={1} />
        </div>

        {/* Robot head doodle - bottom left */}
        <div className="absolute bottom-[5%] left-[5%] -rotate-12 transform">
          <Bot size={500} strokeWidth={1} />
        </div>

        {/* Circuit doodle - middle right */}
        <div className="absolute top-[40%] right-[-5%] -rotate-6 transform">
          <Cpu size={600} strokeWidth={1} />
        </div>

        {/* Squiggly doodle line 1 */}
        <svg className="absolute top-[20%] left-[20%]" width="300" height="300" viewBox="0 0 300 300" fill="none">
          <path d="M 0 150 Q 50 50, 100 150 T 200 150 T 300 150" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="8 8" />
        </svg>

        {/* Squiggly doodle line 2 */}
        <svg className="absolute bottom-[20%] right-[30%]" width="400" height="200" viewBox="0 0 400 200" fill="none">
          <path d="M 50 150 C 100 50, 200 250, 350 100" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="12 6" />
        </svg>
      </div>
    </>
  )
}

