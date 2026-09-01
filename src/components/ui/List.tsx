import { Fragment, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react'
import { Flex, Skeleton, Spin, Typography, theme } from 'antd'
import { EmptyState } from './EmptyState'

type ListProps<T> = {
  className?: string
  dataSource?: readonly T[]
  footer?: ReactNode
  header?: ReactNode
  loading?: boolean | object
  locale?: { emptyText?: ReactNode }
  preserveLastDivider?: boolean
  renderItem?: (item: T, index: number) => ReactNode
  style?: CSSProperties
}

type ListItemProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  actions?: ReactNode[]
  children?: ReactNode
  extra?: ReactNode
}

type ListItemMetaProps = {
  avatar?: ReactNode
  description?: ReactNode
  style?: CSSProperties
  title?: ReactNode
}

function ListBase<T>({ className, dataSource = [], footer, header, loading, locale, preserveLastDivider = false, renderItem, style }: ListProps<T>) {
  const { token } = theme.useToken()
  const hasItems = dataSource.length > 0 && Boolean(renderItem)
  const initialLoading = Boolean(loading) && !hasItems
  const content = initialLoading
    ? <Flex role="status" aria-label="列表加载中" aria-busy="true" vertical gap={token.paddingSM}>
        {Array.from({ length: 5 }, (_, index) => <Flex key={index} align="flex-start" gap={token.marginSM} style={{ padding: `${token.paddingSM}px 0` }}>
          <Skeleton.Avatar active size={36}/>
          <Flex vertical gap={token.marginXS} style={{ flex: 1 }}>
            <Skeleton.Input active size="small" style={{ width: index % 2 ? '36%' : '48%' }}/>
            <Skeleton.Input active size="small" style={{ width: index % 2 ? '72%' : '86%' }}/>
          </Flex>
        </Flex>)}
      </Flex>
    : hasItems
    ? dataSource.map((item, index) => {
        const record = item && typeof item === 'object' ? item as Record<string, unknown> : undefined
        const key = String(record?.id ?? record?.key ?? record?.name ?? index)
        return <Fragment key={key}>{renderItem?.(item, index)}</Fragment>
      })
    : locale?.emptyText ?? <EmptyState title="暂无数据" description="相关记录产生后会显示在这里。" />

  return (
    <Spin spinning={Boolean(loading) && hasItems} description="正在更新…">
      <div className={['ui-list', footer ? 'ui-list--with-footer' : '', preserveLastDivider ? 'ui-list--keep-last-divider' : '', className].filter(Boolean).join(' ')} style={style}>
        {header ? <div style={{ padding: `${token.paddingSM}px 0`, borderBottom: `${token.lineWidth}px solid ${token.colorBorderSecondary}` }}>{header}</div> : null}
        {hasItems ? <div role="list">{content}</div> : content}
        {footer ? <div style={{ padding: `${token.paddingSM}px 0`, color: token.colorTextSecondary }}>{footer}</div> : null}
      </div>
    </Spin>
  )
}

function ListItemBase({ actions, children, extra, style, ...props }: ListItemProps) {
  const { token } = theme.useToken()
  return (
    <Flex
      {...props}
      align="center"
      gap={token.marginSM}
      justify="space-between"
      role="listitem"
      style={{
        minWidth: 0,
        padding: `${token.paddingSM}px 0`,
        borderBottom: `${token.lineWidth}px solid ${token.colorBorderSecondary}`,
        ...style,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      {extra ? <div style={{ flex: 'none' }}>{extra}</div> : null}
      {actions?.length ? <Flex align="center" gap={token.marginXS}>{actions}</Flex> : null}
    </Flex>
  )
}

function ListItemMeta({ avatar, description, style, title }: ListItemMetaProps) {
  const { token } = theme.useToken()
  return (
    <Flex align="flex-start" gap={token.marginSM} style={{ minWidth: 0, ...style }}>
      {avatar ? <div style={{ flex: 'none', color: token.colorTextSecondary }}>{avatar}</div> : null}
      <Flex vertical gap={token.marginXXS} style={{ flex: 1, minWidth: 0 }}>
        {title ? <Typography.Text>{title}</Typography.Text> : null}
        {description ? <div style={{ color: token.colorTextSecondary }}>{description}</div> : null}
      </Flex>
    </Flex>
  )
}

const ListItem = Object.assign(ListItemBase, { Meta: ListItemMeta })

export const List = Object.assign(ListBase, { Item: ListItem })
