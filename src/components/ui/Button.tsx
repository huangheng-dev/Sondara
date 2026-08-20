import { forwardRef, type ReactNode } from 'react'
import { Button as AntButton, type ButtonProps as AntButtonProps } from 'antd'

type ButtonProps = Omit<AntButtonProps, 'type' | 'size' | 'danger' | 'variant'> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  type?: 'button' | 'submit' | 'reset'
  children?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'secondary', size = 'md', type = 'button', children, className, ...props }, ref) {
  return <AntButton
    ref={ref}
    className={['app-button', `app-button-${variant}`, `app-button-${size}`, className].filter(Boolean).join(' ')}
    type={variant === 'primary' ? 'primary' : variant === 'ghost' ? 'text' : 'default'}
    danger={variant === 'danger'}
    size={size === 'sm' ? 'small' : 'middle'}
    htmlType={type}
    {...props}
  >{children}</AntButton>
})
