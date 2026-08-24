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
    colorFillAlter: '#f7f9fc',
    colorTextHeading: '#182230',
    borderRadius: 9,
    borderRadiusLG: 13,
    controlHeight: 40,
    controlHeightSM: 34,
    fontSize: 14,
    fontSizeSM: 12,
    lineHeight: 1.55,
    fontFamily: '"Microsoft YaHei", "微软雅黑", system-ui, sans-serif',
    boxShadowSecondary: '0 18px 50px rgba(16, 24, 40, 0.16)',
  },
  components: {
    Button: { controlHeight: 40, controlHeightSM: 34, fontWeight: 600, primaryShadow: '0 3px 8px rgba(11, 92, 255, 0.18)' },
    Card: { bodyPadding: 18, headerHeight: 58, headerFontSize: 15 },
    Drawer: { paddingLG: 20 },
    Dropdown: { paddingBlock: 6 },
    Input: { activeBorderColor: '#0b5cff', hoverBorderColor: '#8facdb', paddingInline: 12 },
    Form: { itemMarginBottom: 18, labelColor: '#344054', labelFontSize: 13, verticalLabelPadding: '0 0 7px' },
    Menu: { itemHeight: 44, itemBorderRadius: 9, itemMarginInline: 10, itemMarginBlock: 3 },
    Modal: { titleFontSize: 18, contentBg: '#ffffff', headerBg: '#ffffff' },
    Pagination: { itemSize: 32, itemActiveBg: '#eef4ff' },
    Segmented: { itemSelectedBg: '#ffffff', trackBg: '#f2f4f7' },
    Select: { optionSelectedBg: '#eef4ff', optionActiveBg: '#f5f8ff' },
    Table: { headerBg: '#f7f9fc', headerColor: '#475467', rowHoverBg: '#f8fbff', cellPaddingBlock: 14, cellPaddingInline: 16, borderColor: '#e7ebf1' },
    Tag: { defaultBg: '#f2f4f7', defaultColor: '#475467' },
    Tooltip: { colorBgSpotlight: '#182230' },
  },
} as const

export function AntDesignProvider({ children }: { children: ReactNode }) {
  return <ConfigProvider locale={zhCN} theme={sondaraTheme}><App className="sondara-ant-app">{children}</App></ConfigProvider>
}
