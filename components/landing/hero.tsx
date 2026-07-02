'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowRight, Search, Activity, CheckCircle2 } from 'lucide-react'
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion'
import {
  DISPATCH_SEASON_LABEL,
  HERO_DESCRIPTION,
  HERO_MORPHING_WORDS
} from '@/lib/site-config'
import { StatCard } from '@/components/ui/stat-card'
import { WindowDots } from '@/components/ui/window-dots'
import { ContainerScroll } from '@/components/ui/container-scroll-animation'

function MorphingWord() {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % HERO_MORPHING_WORDS.length)
    }, 2500)
    return () => clearInterval(id)
  }, [])

  return (
    <span className="relative text-left text-primary inline-flex justify-center" style={{ width: '280px' }}>
      <AnimatePresence mode="wait">
        <motion.span
          key={index}
          initial={{ opacity: 0, y: 15, filter: 'blur(4px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -15, filter: 'blur(4px)' }}
          transition={{ duration: 0.4 }}
          className="absolute"
        >
          {HERO_MORPHING_WORDS[index]}
        </motion.span>
      </AnimatePresence>
      <span className="invisible">{HERO_MORPHING_WORDS[0]}</span>
    </span>
  )
}

function ProductHeroMock() {
  return (
    <div className="relative mx-auto mt-20 w-full max-w-5xl pb-10">
      <div
        className="relative rounded-xl border border-border/80 bg-background/50 shadow-2xl backdrop-blur-md overflow-hidden"
      >
        {/* Browser Chrome */}
        <div className="flex h-12 items-center gap-2 border-b border-border bg-card/80 px-4 backdrop-blur-sm">
          <WindowDots size="md" />
          <div className="ml-4 flex-1">
            <div className="h-6 w-1/3 max-w-[200px] rounded-md bg-muted/50 flex items-center px-2">
               <Search className="w-3 h-3 text-muted-foreground mr-2" aria-hidden="true" />
               <span className="text-xs text-muted-foreground">app.ftcmatchmaker.com</span>
            </div>
          </div>
        </div>
        {/* Mock Content */}
        <div className="p-6 md:p-10 bg-card text-left">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <StatCard 
              icon={Search}
              label="Potential Matches"
              value="12"
              description="3 high-confidence fits"
              className="bg-background shadow-sm hover:shadow-md transition-shadow"
            />
            <StatCard 
              icon={Activity}
              label="Active Pitches"
              value="4"
              description="Awaiting response"
              progress={65}
              className="bg-background shadow-sm hover:shadow-md transition-shadow"
            />
            <StatCard 
              icon={CheckCircle2}
              label="Funds Secured"
              value="$4,200"
              description="Goal: $5,000"
              progress={84}
              className="bg-background shadow-sm hover:shadow-md transition-shadow"
            />
          </div>
          {/* Mock Submissions List */}
          <div className="mt-8">
             <div className="text-sm font-medium text-foreground mb-4 px-1 flex items-center justify-between">
               <span>Recent Activity</span>
               <span className="text-xs text-muted-foreground hover:text-primary cursor-pointer transition-colors">View all</span>
             </div>
             <div className="space-y-3">
               <motion.div 
                 whileHover={{ scale: 1.01 }}
                 className="group rounded-xl border border-border bg-background p-4 flex items-center justify-between shadow-sm hover:border-primary/30 transition-all cursor-pointer"
               >
                  <div className="flex items-center gap-4">
                     <div className="h-10 w-10 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                       <span className="text-blue-600 font-bold text-xs tracking-wider">TF</span>
                     </div>
                     <div className="flex flex-col">
                       <span className="text-sm font-semibold text-foreground">TechFlow Systems</span>
                       <span className="text-xs text-muted-foreground">98% match • Tech company looking to sponsor</span>
                     </div>
                  </div>
                  <div className="px-3 py-1 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
                    <span className="text-xs font-medium text-primary">New Match</span>
                  </div>
               </motion.div>
               
               <motion.div 
                 whileHover={{ scale: 1.01 }}
                 className="group rounded-xl border border-border bg-background p-4 flex items-center justify-between shadow-sm hover:border-amber-500/30 transition-all cursor-pointer"
               >
                  <div className="flex items-center gap-4">
                     <div className="h-10 w-10 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
                       <span className="text-purple-600 font-bold text-xs tracking-wider">AR</span>
                     </div>
                     <div className="flex flex-col">
                       <span className="text-sm font-semibold text-foreground">Apex Robotics</span>
                       <span className="text-xs text-muted-foreground">Currently reviewing your pitch deck</span>
                     </div>
                  </div>
                  <div className="px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                    <span className="text-xs font-medium text-amber-600">In Progress</span>
                  </div>
               </motion.div>

               <motion.div 
                 whileHover={{ scale: 1.01 }}
                 className="group rounded-xl border border-border bg-background p-4 flex items-center justify-between shadow-sm hover:border-emerald-500/30 transition-all cursor-pointer opacity-80"
               >
                  <div className="flex items-center gap-4">
                     <div className="h-10 w-10 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
                       <span className="text-rose-600 font-bold text-xs tracking-wider">ND</span>
                     </div>
                     <div className="flex flex-col">
                       <span className="text-sm font-semibold text-foreground">Nexus Dynamics</span>
                       <span className="text-xs text-muted-foreground">Sponsorship secured • Funds transferred</span>
                     </div>
                  </div>
                  <div className="px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                    <span className="text-xs font-medium text-emerald-600">+$2,500</span>
                  </div>
               </motion.div>
             </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function Hero() {
  const reduce = useReducedMotion()
  const [shouldShow, setShouldShow] = useState(false)
  const init = reduce ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }
  const show = { opacity: 1, y: 0 }

  useEffect(() => {
    const handleComplete = () => setShouldShow(true)
    window.addEventListener('initial-loader-complete', handleComplete)
    const fallback = setTimeout(() => setShouldShow(true), 5000)
    return () => {
      window.removeEventListener('initial-loader-complete', handleComplete)
      clearTimeout(fallback)
    }
  }, [])

  return (
    <section className="relative pt-32 pb-10 lg:pt-40 lg:pb-16 flex flex-col items-center overflow-hidden">
      {/* warm radial glow */}
      <div aria-hidden className="absolute left-1/2 top-0 -z-10 h-[600px] w-[800px] -translate-x-1/2 rounded-full bg-primary/5 blur-[100px]" />

      <div className="mx-auto max-w-[1440px] px-6 lg:px-10 w-full flex flex-col items-center text-center">
        {/* season pill */}
        <motion.div
          initial={init}
          animate={show}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-mono text-muted-foreground shadow-sm"
        >
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
          </span>
          {DISPATCH_SEASON_LABEL}
        </motion.div>

        {/* headline */}
        <motion.h1
          initial={init}
          animate={show}
          transition={{ duration: 0.7, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          className="mt-8 max-w-4xl text-5xl sm:text-6xl lg:text-7xl font-medium tracking-tight text-foreground leading-[1.1] md:leading-[1.15]"
        >
          <div className="block pb-2">Land your next</div>
          <div className="block pb-2">
            <MorphingWord />
          </div>
          <div className="block">and fuel your FTC journey.</div>
        </motion.h1>

        <motion.p
          initial={init}
          animate={show}
          transition={{ duration: 0.7, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="mt-6 max-w-2xl text-lg sm:text-xl leading-relaxed text-muted-foreground mx-auto"
        >
          {HERO_DESCRIPTION}
        </motion.p>

        {/* CTAs - Pill style */}
        <motion.div
          initial={init}
          animate={show}
          transition={{ duration: 0.7, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="mt-10 flex flex-wrap items-center justify-center gap-3"
        >
          <Link
            href="/signup"
            className="group inline-flex items-center gap-2 rounded-full bg-ink px-7 py-3.5 text-sm font-medium text-white hover:bg-ink/90 transition-colors active:scale-[0.98] shadow-sm"
          >
            Get started
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" strokeWidth={1.8} />
          </Link>
          <Link
            href="/sponsors/apply"
            className="inline-flex items-center gap-2 rounded-full bg-primary px-7 py-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors active:scale-[0.98] shadow-sm"
          >
            Sponsor a team
          </Link>
        </motion.div>

        {/* Product UI Showcase */}
        <motion.div
          initial={reduce ? { opacity: 1, scale: 1 } : { opacity: 0, y: 40 }}
          animate={shouldShow ? { opacity: 1, y: 0 } : { opacity: 0, y: 40 }}
          transition={{ duration: 1.0, delay: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="w-full"
        >
          <ContainerScroll>
            <ProductHeroMock />
          </ContainerScroll>
        </motion.div>
      </div>
    </section>
  )
}
