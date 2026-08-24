import { Button as AntButton } from 'antd'
import type { ButtonProps as AntButtonProps } from 'antd'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps {
  variant?: Variant
  size?: Size | 'small' | 'middle' | 'large'
  danger?: boolean
  loading?: boolean
  disabled?: boolean
  icon?: React.ReactNode
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
  children?: React.ReactNode
  type?: 'button' | 'submit' | 'reset' | 'primary' | 'default' | 'text' | 'link'
  className?: string
  style?: React.CSSProperties
  block?: boolean
  href?: string
  target?: string
  htmlType?: 'button' | 'submit' | 'reset'
  form?: string
  title?: string
  ariaLabel?: string
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}

const variantToType: Record<Variant, AntButtonProps['type']> = {
  primary: 'primary',
  secondary: 'default',
  ghost: 'text',
  danger: 'primary',
}

const sizeToAnt: Record<string, AntButtonProps['size']> = {
  sm: 'small',
  small: 'small',
  md: 'middle',
  middle: 'middle',
  lg: 'large',
  large: 'large',
}

export function Button({ variant = 'secondary', size = 'md', danger, type, htmlType, ...props }: ButtonProps) {
  const isDanger = danger || variant === 'danger'
  // Allow direct Ant Design type values to pass through
  const antType = (type && ['primary', 'default', 'text', 'link', 'dashed'].includes(type)
    ? type
    : variantToType[variant]) as AntButtonProps['type']
  return (
    <AntButton
      {...props}
      type={antType}
      size={sizeToAnt[size] || 'middle'}
      danger={isDanger}
      htmlType={htmlType || (['button', 'submit', 'reset'].includes(type as string) ? type as 'button' | 'submit' | 'reset' : undefined) || 'button'}
    />
  )
}
