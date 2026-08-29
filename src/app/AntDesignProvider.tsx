import type { ReactNode } from 'react'
import { App, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'

export function AntDesignProvider({ children }: { children: ReactNode }) {
  return <ConfigProvider
    locale={zhCN}
    theme={{
      token: {
        colorPrimary: '#4f46e5',
        colorInfo: '#1d4ed8',
        colorSuccess: '#047857',
        colorWarning: '#9a5b00',
        colorError: '#b91c1c',
        colorText: '#172033',
        colorTextSecondary: '#526079',
        colorTextTertiary: '#526079',
        colorTextDescription: '#526079',
        colorTextPlaceholder: '#667085',
        colorBgLayout: '#f3f6fb',
        colorBgContainer: '#ffffff',
        colorBorder: '#dce3ed',
        colorBorderSecondary: '#e9edf4',
        colorSplit: '#edf1f6',
        borderRadius: 10,
        borderRadiusLG: 14,
        borderRadiusSM: 8,
        controlHeight: 38,
        controlHeightLG: 44,
        controlHeightSM: 30,
        fontSize: 14,
        fontFamily: 'Inter, "SF Pro Text", "PingFang SC", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        boxShadow: '0 10px 30px rgba(30, 41, 59, 0.08)',
        boxShadowSecondary: '0 16px 48px rgba(30, 41, 59, 0.14)',
      },
      components: {
        Layout: {
          bodyBg: '#f3f6fb',
          headerBg: 'rgba(255, 255, 255, 0.9)',
          siderBg: '#10172a',
        },
        Menu: {
          darkItemBg: 'transparent',
          darkSubMenuItemBg: 'rgba(5, 10, 24, 0.28)',
          darkItemColor: '#aeb9cf',
          darkItemHoverColor: '#ffffff',
          darkItemHoverBg: 'rgba(255, 255, 255, 0.08)',
          darkItemSelectedColor: '#ffffff',
          darkItemSelectedBg: '#4f46e5',
          itemBorderRadius: 9,
          itemMarginInline: 10,
          itemMarginBlock: 3,
          itemHeight: 42,
        },
        Button: {
          borderRadius: 9,
          fontWeight: 600,
          primaryShadow: '0 5px 14px rgba(79, 70, 229, 0.24)',
          defaultShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
        },
        Checkbox: {
          borderRadiusSM: 4,
        },
        Card: {
          headerBg: 'transparent',
          headerHeight: 56,
          bodyPadding: 20,
          bodyPaddingSM: 16,
        },
        Table: {
          headerBg: '#f7f9fc',
          headerColor: '#41506a',
          rowHoverBg: '#f8f9ff',
          borderColor: '#e6ebf2',
          cellPaddingBlock: 14,
          cellPaddingInline: 16,
          cellPaddingBlockSM: 11,
          cellPaddingInlineSM: 12,
        },
        Input: {
          activeBorderColor: '#6366f1',
          hoverBorderColor: '#818cf8',
          activeShadow: '0 0 0 3px rgba(79, 70, 229, 0.10)',
        },
        Select: {
          activeBorderColor: '#6366f1',
          hoverBorderColor: '#818cf8',
          activeOutlineColor: 'rgba(79, 70, 229, 0.10)',
          optionSelectedBg: '#eef2ff',
        },
        DatePicker: {
          activeBorderColor: '#6366f1',
          hoverBorderColor: '#818cf8',
          activeShadow: '0 0 0 3px rgba(79, 70, 229, 0.10)',
        },
        Modal: {
          titleFontSize: 18,
          headerBg: '#ffffff',
          contentBg: '#ffffff',
          footerBg: '#ffffff',
        },
        Drawer: {
          colorBgElevated: '#ffffff',
        },
        Tabs: {
          itemSelectedColor: '#4f46e5',
          itemHoverColor: '#6366f1',
          inkBarColor: '#4f46e5',
        },
        Segmented: {
          itemSelectedBg: '#ffffff',
          itemSelectedColor: '#4338ca',
          trackBg: '#eef1f6',
          trackPadding: 4,
        },
        Tag: {
          borderRadiusSM: 999,
          defaultBg: '#f2f4f8',
          defaultColor: '#4b5870',
        },
        Statistic: {
          contentFontSize: 28,
          titleFontSize: 13,
        },
        Progress: {
          defaultColor: '#4f46e5',
          remainingColor: '#edf0f5',
        },
        Alert: {
          borderRadiusLG: 12,
          withDescriptionPadding: '14px 16px',
        },
        Form: {
          labelColor: '#34415a',
          labelFontSize: 14,
          labelHeight: 20,
          itemMarginBottom: 20,
          verticalLabelPadding: '0 0 6px',
        },
        Pagination: {
          itemActiveBg: '#eef2ff',
          itemBg: 'transparent',
        },
      },
    }}
  ><App>{children}</App></ConfigProvider>
}
