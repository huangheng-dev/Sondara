import { Button as AntButton } from 'antd'
import type { ButtonProps as AntButtonProps } from 'antd'
import { Children, isValidElement } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends Omit<AntButtonProps, 'size' | 'type' | 'danger' | 'variant'> {
  variant?: Variant
  size?: Size | 'small' | 'middle' | 'large'
  danger?: boolean
  loading?: boolean
  disabled?: boolean
  icon?: React.ReactNode
  type?: 'button' | 'submit' | 'reset' | 'primary' | 'default' | 'text' | 'link'
  ariaLabel?: string
}

const variantToType: Record<Variant, AntButtonProps['type']> = {
  primary: 'primary',
  secondary: 'default',
  ghost: 'text',
  danger: 'default',
}

const sizeToAnt: Record<string, AntButtonProps['size']> = {
  sm: 'small',
  small: 'small',
  md: 'middle',
  middle: 'middle',
  lg: 'large',
  large: 'large',
}

export function Button({ variant = 'secondary', size = 'md', danger, type, htmlType, ariaLabel, className, ...props }: ButtonProps) {
  const isDanger = danger || variant === 'danger'
  const children = Children.toArray(props.children)
  const onlyChild = children[0]
  const onlyChildProps = isValidElement(onlyChild) ? onlyChild.props as { children?: React.ReactNode } : null
  const isIconOnly = Boolean(
    (props.icon && children.length === 0)
    || (children.length === 1 && onlyChildProps && onlyChildProps.children == null),
  )
  const accessibleLabel = ariaLabel ?? props['aria-label'] ?? (isIconOnly && typeof props.title === 'string' ? props.title : undefined)
  // Allow direct Ant Design type values to pass through
  const antType = (type && ['primary', 'default', 'text', 'link', 'dashed'].includes(type)
    ? type
    : variantToType[variant]) as AntButtonProps['type']
  return (
    <AntButton
      {...props}
      className={['ui-button', isIconOnly && 'ui-button--icon-only', className].filter(Boolean).join(' ')}
      type={antType}
      size={sizeToAnt[size] || 'middle'}
      danger={isDanger}
      aria-label={accessibleLabel}
      htmlType={htmlType || (['button', 'submit', 'reset'].includes(type as string) ? type as 'button' | 'submit' | 'reset' : undefined) || 'button'}
    />
  )
}
