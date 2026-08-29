import { Card, Flex, Skeleton, Spin, Typography } from 'antd'

type PageLoadingProps = {
  title?: string
  description?: string
}

export function PageLoading({ title = '正在加载', description }: PageLoadingProps) {
  return <Flex className="ui-page-loading" role="status" aria-live="polite" aria-busy="true" vertical align="center" justify="center" gap={12}>
    <Spin size="large" />
    <Flex vertical align="center" gap={2}>
      <Typography.Text strong>{title}</Typography.Text>
      {description ? <Typography.Text type="secondary">{description}</Typography.Text> : null}
    </Flex>
  </Flex>
}

export function ContentSkeleton({ rows = 4, card = false }: { rows?: number; card?: boolean }) {
  const content = <Skeleton
    className="ui-content-skeleton"
    active
    title={{ width: '32%' }}
    paragraph={{ rows, width: Array.from({ length: rows }, (_, index) => index === rows - 1 ? '58%' : '100%') }}
  />
  return card ? <Card className="ui-loading-card" role="status" aria-label="内容加载中" aria-busy="true">{content}</Card> : <div role="status" aria-label="内容加载中" aria-busy="true">{content}</div>
}

export function DetailSkeleton({ rows = 5 }: { rows?: number }) {
  return <Flex role="status" aria-label="详情加载中" aria-busy="true" vertical gap={20}>
    <Skeleton active avatar paragraph={{ rows: 2 }} />
    <Skeleton active title={false} paragraph={{ rows }} />
  </Flex>
}
