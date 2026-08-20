import type { ReactNode } from 'react'
import { App, ConfigProvider, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'

const sondaraTheme = {
  algorithm: theme.defaultAlgorithm,
  token: {
    colorPrimary: '#0b5cff',
    colorInfo: '#0b5cff',
    colorSuccess: '#079455',
    colorWarning: '#dc6803',
    colorError: '#d92d20',
    colorText: '#192230',
    colorTextSecondary: '#667085',
    colorBorder: '#d9e0e9',
    colorBgLayout: '#f6f8fb',
    colorBgContainer: '#ffffff',
    borderRadius: 9,
    borderRadiusLG: 13,
    controlHeight: 38,
    fontSize: 14,
    fontFamily: 'Inter, "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif',
    boxShadowSecondary: '0 18px 50px rgba(16, 24, 40, 0.16)',
  },
  components: {
    Button: { controlHeight: 38, controlHeightSM: 32, fontWeight: 600, primaryShadow: '0 3px 8px rgba(11, 92, 255, 0.18)' },
    Card: { bodyPadding: 18, headerHeight: 58, headerFontSize: 15 },
    Input: { activeBorderColor: '#0b5cff', hoverBorderColor: '#8facdb' },
    Form: { itemMarginBottom: 18, labelColor: '#344054', labelFontSize: 13, verticalLabelPadding: '0 0 7px' },
    Modal: { titleFontSize: 18 },
    Pagination: { itemSize: 32, itemActiveBg: '#eef4ff' },
    Select: { optionSelectedBg: '#eef4ff' },
    Table: { headerBg: '#f7f9fc', headerColor: '#475467', rowHoverBg: '#f8fbff', cellPaddingBlock: 13, cellPaddingInline: 14 },
    Tag: { defaultBg: '#f2f4f7', defaultColor: '#475467' },
  },
} as const

export function AntDesignProvider({ children }: { children: ReactNode }) {
  return <ConfigProvider locale={zhCN} theme={sondaraTheme}><App className="sondara-ant-app">{children}</App></ConfigProvider>
}
