<div align="center">

# TimeRecoder

**本地优先的桌面时间管理应用 —— 把时间、任务、日程、专注串成一条线**

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-lightgrey.svg)](#)
[![Electron](https://img.shields.io/badge/Electron-latest-4ade80.svg)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18-61dafb.svg)](https://react.dev/)

</div>

---

## 简介

TimeRecoder 是一个**本地优先（local-first）桌面时间管理应用**，产品理念受 [Rize](https://rize.io/) 启发，但为完全独立开发，与 Rize 无任何关联。它不只是又一个待办清单，而是围绕一条核心链路设计：

> **TODO 决定做什么 → 日程决定何时做 → 专注模式执行并记录 → 时间统计复盘**

所有数据默认保存在本机、不上传任何服务器，隐私完全可控。

## 功能特性

- **专注模式**：预设时长（25/50/90 分钟，可自定义）、可关联任务/项目、暂停/继续/结束、完成落库、系统托盘常驻、全局快捷键、系统通知、每日专注目标追踪
- **日程安排**：日/周视图、时间轴、日程块增删改、拖拽移动/拉伸调整时长、当前进行中高亮、可从日程直接发起专注、通用 `.ics` 导入导出（Google/Outlook 兼容，导出带本地时区标识）
- **TODO 任务**：项目/优先级/状态/截止日期、自然语言一句话录入、子任务进度、重复任务（每天/工作日/每周/每月）、筛选与搜索、勾选完成、开始专注、查看任务投入时长
- **时间统计**：今日/本周/本月范围、总览卡片、项目分布饼图、每日趋势柱状图、专注热力图、时间明细与手动补录
- **周报生成**：按周汇总可视化周报，一键导出 Markdown / PNG / PDF
- **客户报告**：按项目/客户 + 时间范围汇总可交付工时报告，含工作项明细、类别分布、每日趋势、备注摘要，支持 Markdown / PNG / PDF 导出与自定义报告标题
- **效率洞察**：黄金时段、星期效率、专注质量指标、近 8 周趋势、专注占比与可行动建议
- **环境白噪音**：雨声/海浪/溪流/森林/咖啡馆/白噪音 6 种场景，Web Audio 实时合成、无需音频文件与联网，支持音量调节与场景切换，切页持续播放
- **自动活动追踪**（Windows）：按间隔采样前台窗口，依规则自动归类为时间记录；专注时自动暂停；可配置归类规则与最小持续时长
- **Obsidian 每日日志**：把当天时间记录自动写入 Obsidian Vault 指定文件夹的 Daily Note（YYYY-MM-DD.md）；文件夹、写入时间、Markdown 模板均可自定义，支持手动立即生成
- **本地智能归类**：从你手动修正自动记录的分类中学习个人偏好，给出个性化规则建议；采纳后优先生效，全程不联网、不调用外部 AI
- **专注守护**（Windows）：专注期间检测前台窗口，命中屏蔽关键词（应用名/标题）时弹出提醒并记录干扰次数；非侵入式，不强制拦截应用
- **数据与体验**：本地 IndexedDB 存储、JSON 备份导入导出、温润科技感 HUD 界面、IBM Plex 字体

## 技术栈

| 层次 | 选型 |
|---|---|
| 桌面壳 | Electron |
| UI 框架 | React 18 + TypeScript |
| 构建 | Vite |
| 样式 | 原生 CSS + CSS 变量（OKLCH 色板） |
| 状态管理 | Zustand |
| 本地数据库 | Dexie（IndexedDB） |
| 图表 | Recharts |
| 图标 | lucide-react |
| 日期处理 | date-fns |
| 打包 | electron-builder |

## 快速开始

### 环境要求

- Node.js 18+ 与 npm
- （开发/打包桌面应用需要）Git Bash 或兼容终端

### 安装与运行

```bash
# 克隆仓库
git clone https://github.com/IceTide/TimeRecoder.git
cd TimeRecoder

# 安装依赖
npm install

# 开发模式（同时启动 Vite + Electron）
npm run dev
```

### 构建与打包

```bash
# 类型检查 + 前端构建 + Electron 主进程编译
npm run build

# 启动已构建的应用
npm start

# 生成安装包（NSIS + 便携版，输出到 release/）
npm run dist:win

# 仅生成未打包目录，便于快速验证
npm run dist:dir

# macOS / Linux
npm run dist:mac
npm run dist:linux
```

> 未配置代码签名证书时安装包会跳过签名；Windows 首次运行可能触发 SmartScreen 提示，选择「更多信息 → 仍要运行」即可。安装包使用项目自带的 `build/icon` 图标。

## 使用说明

1. **首次启动**：进入「设置」可配置专注时长预设、休息提醒、每日专注目标；Windows 用户可开启自动活动追踪并设置归类规则。
2. **开始专注**：在「专注」页选择时长与关联任务，点击开始；支持暂停/继续/结束，完成后自动记录到时间统计。应用可最小化到系统托盘，后台持续计时。
3. **管理任务与日程**：在 TODO 页可用一句话快速添加（如「明天 15:00 评审 !高 @产品研发 #会议 预计60分 每周」），也可拆分子任务、设置重复；日程页支持拖拽调整时间，并可导入/导出 `.ics` 与 Google/Outlook 日历互通。
4. **复盘**：在「时间统计」查看分布、趋势与热力图；可手动补录或编辑时间条目。
5. **数据备份**：设置页提供 JSON 导入导出，数据始终留在本机。

## 项目结构

```text
src/
├── components/     # 通用组件
├── db/             # Dexie 数据层（repository）
├── pages/          # 专注 / 日程 / TODO / 统计 / 设置
├── store/          # Zustand 状态
├── utils/          # 时间与格式化工具
└── index.css       # 设计 token 与全局样式
electron/           # 主进程（托盘、快捷键、通知、窗口监控）
scripts/            # 启动与打包脚本
docs/               # 技术选型与功能规划
```

## 数据隐私

TimeRecoder 为本地优先设计：所有业务数据存储在浏览器 IndexedDB 中，不会自动上传。自动活动追踪与专注守护仅读取前台应用的名称与窗口标题用于归类/提醒，**不记录键盘输入、不截图、不强制拦截应用**。智能归类只在本机对修正日志做统计分析，不发送任何数据，也不需要 API Key；修正日志最多保留最近 500 条，采纳或忽略过的建议不会重复打扰你。`.ics` 日历文件也在本地解析，重复规则仅在本地展开，不会连接第三方日历服务。

## 路线图

- [x] 专注模式、日程、TODO、时间统计四大模块
- [x] 自动活动追踪与归类规则
- [x] 专注热力图、连续天数、每日目标
- [x] 专注守护（应用/网站关键词提醒，非侵入式）
- [x] 白噪音（Web Audio 实时合成 6 种场景，零音频文件）
- [x] 效率洞察（黄金时段 / 星期效率 / 专注质量 / 趋势）
- [x] AI 智能归类（本地学习版：从手动修正中学习，零外部 API）
- [x] 周报生成与导出（Markdown / PNG / PDF）
- [x] 客户报告导出（按项目 + 时间范围生成可交付工时报告）
- [x] 连接 Obsidian，自动生成每日日志（指定文件夹 + 自定义模板/时间）
- [x] TODO 自然语言录入、子任务与重复任务
- [x] 日程 `.ics` 导入导出与拖拽调整时间
- [ ] 云同步（可选）

## 贡献

欢迎 Issue 与 Pull Request。提交前请确保 `npm run build` 通过。

## 协议

本项目基于 [Apache License 2.0](./LICENSE) 开源，可自由使用、修改与分发，包括商业用途，但需保留版权与协议声明。

```
Copyright 2026 Liu Yisong

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```
