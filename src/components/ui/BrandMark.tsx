type BrandMarkProps = {
  className?: string
  size?: number
}

export function BrandMark({ className, size = 40 }: BrandMarkProps) {
  return <img className={className} src="/favicon.svg" width={size} height={size} alt="" aria-hidden="true" />
}
