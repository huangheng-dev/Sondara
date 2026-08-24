import { Flex, Spin } from 'antd'

export function PageLoader() {
  return <Flex align="center" justify="center" style={{ minHeight: '60vh' }}><Spin size="large" description="加载中" /></Flex>
}
