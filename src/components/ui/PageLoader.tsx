import { Flex, Spin } from 'antd'

export function PageLoader() {
  return <Flex className="app-page-loader" align="center" justify="center"><Spin size="large" description="加载中" /></Flex>
}
