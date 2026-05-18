import { motion } from 'framer-motion'
import { PanelLeft } from 'lucide-react'
import { useSettingsStore } from '../stores/settingsStore'
import { cn } from '../lib/utils'

export function SidebarToggle() {
  const { sidebarOpen, toggleSidebar } = useSettingsStore()

  if (sidebarOpen) return null

  return (
    <motion.button
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      onClick={toggleSidebar}
      className={cn(
        'fixed left-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-[80] p-2 bg-card/95 border border-border rounded-sm backdrop-blur-sm',
        'hover:bg-secondary transition-colors shadow-lg md:left-3'
      )}
    >
      <PanelLeft className="w-4 h-4" />
    </motion.button>
  )
}
