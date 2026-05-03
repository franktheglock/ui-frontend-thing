import { useMemo, useState } from 'react'
import { Globe2 } from 'lucide-react'

function getFaviconUrl(sourceUrl: string) {
  return `https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(sourceUrl)}`
}

export function SiteFavicon({ sourceUrl, className }: { sourceUrl?: string, className?: string }) {
  const [failed, setFailed] = useState(false)

  const faviconUrl = useMemo(() => {
    if (!sourceUrl) return null
    try {
      return getFaviconUrl(sourceUrl)
    } catch {
      return null
    }
  }, [sourceUrl])

  if (!faviconUrl || failed) {
    return <Globe2 className={className} />
  }

  return (
    <img
      src={faviconUrl}
      alt=""
      className={className}
      onError={() => setFailed(true)}
    />
  )
}