# 适中 Shizhong · v3

面向马来西亚华人的生活服务 + 同城社交 + 直播 + 聊天应用。

- **v3（当前）**：接入真实后端。ASP.NET Core 8 + SQL Server（`server/`）同时提供用户端网页、管理后台（`/admin`，Vue 3 + Element Plus，源码在 `admin/`）、接口和实时通道；安卓/苹果 App 用 Capacitor 打开同一个网站（`app/`）。
  - 部署：`部署说明.md`；开发约定：`docs/BACKEND-DEV.md`；需求与已确认的决定：`docs/需求整理.md`；测试数据：`docs/测试数据.md`。
  - 本地运行：`dotnet build server`，在 `server/Shizhong.Api/appsettings.Local.json` 配置数据库连接，然后运行 `server/Shizhong.Api`（默认 http://localhost:5080/），后台 `/admin`（初始账号 admin / 123123）。
- **离线演示**：双击 `index.html` 仍可运行（没有后端时自动使用浏览器本地数据），下文是这个模式的说明。

> 当前版本：`20260929-v2`（见 `index.html` 的 `shizhong-build`）

## 怎么打开

- **最简单**：双击 `index.html`。
- **推荐**（语音录制、分享等功能在 `file://` 下受浏览器限制）：在项目目录运行
  `python -m http.server 8080`，然后打开 `http://localhost:8080/`。
- 首次打开会看到欢迎页，可以：
  - **体验账号**一键登录：手机 `+60 12-345 6789` 或邮箱 `demo@shizhong.my`，密码 `shizhong2026`。体验账号保留了旧版所有数据（订单、聊天、藏品、演示大额余额）。
  - **手机号注册**：验证码是演示用的，会显示在页面顶部的"演示短信"横幅里。新账号从零开始（RM 100 余额、1,000 金豆、新人优惠券）。
  - **游客浏览**：可以随便看；下单、发消息、送礼、关注等操作会提示先登录。
- 右上角可切换 **简体中文 / English**；「我的 › 设置」里也能切换语言和**浅色 / 深色 / 跟随系统**主题。

## v2 做了什么

| 方面 | 变化 |
|---|---|
| 设计 | 全新设计系统（`core/tokens.css` 设计令牌 + `core/components.css` 组件库），五个页面统一风格，文字对比度达到无障碍标准，支持暗色模式、320px 小屏和桌面预览框 |
| 登录注册 | 欢迎页、手机验证码注册/登录、邮箱登录、找回密码、资料设置（头像、昵称、城市、兴趣）、多账号切换、游客模式；每个账号的数据独立保存 |
| 双语 | 界面全部中英双语（约 3,000 条词条）；演示内容（服务、人物、动态、群聊、会话、服务详情）也有英文版，人名统一罗马化、地名还原为当地真实名称 |
| 导航 | 真正的页面栈：手机/浏览器返回键逐层返回，返回后保留滚动位置和未发送的草稿 |
| 下单 | 确认订单页（地址、优惠券抵扣、钱包 / Touch 'n Go / DuitNow / FPX / 银行卡）、订单时间线、商家模拟确认、取消退款、完成后评价、购物车（超市、外送、鲜花） |
| 聊天 | 长按菜单（复制、引用、转发、撤回、删除）、对方自动回复和"正在输入"、已读状态、图片缩略图、语音气泡内播放、按会话类型显示工具、群红包拼手气与 24 小时退回 |
| 直播 | 上下滑切换直播间（跟手动画）、评论历史与"N 条新评论"、连击送礼、举报/屏蔽、横屏布局、开播预览 |
| 一对一 | 离开确认、余额可聊时长与不足提醒、网络状态、通话记录详情 |
| 礼物素材 | 替换 18 款授权不明的抖音图标为 MIT 授权素材；盛世华章压缩为三种尺寸；新增原创「大马风情」12 款（拉茶、椰浆饭、榴莲、双峰塔、月亮风筝等）；礼物素材总体积 22MB → 4MB |
| 其他 | 通知中心、优惠券与地址管理、屏蔽名单、数据导出/重置、地区选择器修正马来西亚地名错误；照片等大文件存到 IndexedDB，不再撑爆浏览器存储 |

## 添加新语言（例如马来语）

```bash
node tools/i18n.js scaffold ms "Bahasa Melayu" ms-MY   # 生成 locales/ms.js，并自动加入 index.html
node tools/i18n.js export ms > ms.csv                  # 导出表格（key / 中文 / 英文 / 马来文）给译者
node tools/i18n.js import ms ms.csv                    # 导回译文
node tools/i18n.js check                               # 检查缺漏
```

新语言会自动出现在语言切换列表里；没翻译的词条先显示英文。演示内容也可以用 `tools/l10n/` 的流水线翻译。详见 `docs/I18N.md`。

## 目录结构

```text
index.html                入口（适中-H5原稿.html 会跳转到这里）
core/                     核心：导航栈、账号与存储、翻译运行时、设计令牌、基础组件、启动
locales/                  界面语言包：zh-CN.js（源语言）、en.js
app.js                    外壳：底部导航、"我的"页、公共助手函数
catalog.js lazy.js        首页、服务、搜索、发现、消息列表、数据按需加载
checkout.js               确认订单、支付、订单详情、评价、购物车
flows.js                  设置、钱包、金豆与任务、优惠券、地址、通知、表单等
chat-tools.js             聊天界面
gifts.js gift-data.js     礼物商城、装扮、藏品、挂件；friend-showcase.js 好友陈列；personal-qr.js 个人二维码
live-*.js oriental-effects.js  直播间与礼物特效
private-room.js           一对一聊天
vip*.js                   VIP 等级与进场特效
regions.js                国家/城市选择
auth.js                   欢迎、登录、注册
data/                     演示数据（data/i18n/en/ 是英文内容包，data/regions/ 是全球地名库）
assets/                   图片素材（assets/gift-art/ 是新的礼物素材与授权说明）
tools/                    i18n 工具、内容翻译流水线、自动化测试、发布打包
docs/                     架构、设计规范、翻译指南、模块接口；docs/archive/ 是 v1 的旧文档
```

## 开发与测试

- 先读 `docs/ARCHITECTURE.md`（架构与规则）、`docs/DESIGN.md`（设计规范）、`docs/CONTRACTS.md`（各模块的接口）。
- 自动化回归（需要 Chrome 和 `pip install websockets`）：
  `python tools/qa/smoke.py`（中文）、`--locale en`（英文，会报告漏翻的中文）、`--theme dark`、`--width 320 --height 740`。
  场景文件在 `tools/qa/scenarios/`，截图在 `.qa/`。
- 代码格式：Prettier（`.prettierrc.json`）。
- 打包发布：`python tools/release.py`，见 `部署说明.md`。

## 素材与授权

- 礼物：Microsoft Fluent Emoji 3D（MIT，见 `assets/gift-art/LICENSE-MICROSOFT.txt`）；盛世华章与大马风情为本项目原创；来源明细见 `assets/gift-art/CREDITS.md`。
- 照片与头像来自免费图库，来源见 `assets/sources*.json`、`assets/avatar-sources.json`；人物、商家、评价均为虚构。
- 全球地名：CSC 数据快照（ODbL 1.0），见 `data/regions/`；马来西亚地名的人工修正记录在 `data/regions/CHANGES-MY.md`。
- 二维码库：qrcode-generator（MIT，`vendor/QR-LICENSE.txt`）。

## 限制

这是交互原型：支付、短信验证码、第三方登录、聊天、直播和音视频都是本地模拟，不连接真实服务；所有数据只保存在当前浏览器（换浏览器或清除网站数据就会消失）。
