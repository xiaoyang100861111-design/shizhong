# 适中 App（安卓 + 苹果）

App 用 [Capacitor](https://capacitorjs.com/) 做成：原生外壳里打开**同一个网站**（`capacitor.config.json` 的 `server.url`）。
所以网站、安卓、苹果只维护一套代码；网站更新后 App 立即生效，只有改原生能力（推送、图标、权限）时才需要重新打包上架。

## 准备

- 电脑：Node.js 18+；安卓需要 Android Studio；苹果需要 macOS + Xcode。
- 账号：Google Play 开发者（一次性 25 美元）、Apple Developer Program（每年 99 美元）。
- 网站已按 `部署说明.md` 上线并启用 HTTPS。

## 步骤

```bash
cd app
# 1. 把 capacitor.config.json 里的 app.example.com 换成你的域名（两处），appId 换成你的包名
npm install
npx cap add android
npx cap add ios          # 仅 macOS
npx cap sync
npx cap open android     # 在 Android Studio 里打包签名 (Build › Generate Signed Bundle)
npx cap open ios         # 在 Xcode 里设置签名团队后 Archive 上传
```

- 图标与启动图：`npx @capacitor/assets generate`（把 1024×1024 的 `assets/icon.png` 和 `assets/splash.png` 放进 `app/assets/`）。
- 权限说明（上架审核会看）：
  - iOS `Info.plist`：`NSCameraUsageDescription`（直播、视频通话、拍照）、`NSMicrophoneUsageDescription`（语音消息、通话）、`NSPhotoLibraryUsageDescription`（发送图片、头像）、`NSLocationWhenInUseUsageDescription`（附近的人、发送位置）。
  - Android `AndroidManifest.xml`：`CAMERA`、`RECORD_AUDIO`、`MODIFY_AUDIO_SETTINGS`、`ACCESS_FINE_LOCATION`、`POST_NOTIFICATIONS`。

## 网站如何识别 App

网页里 `window.Capacitor.getPlatform()` 返回 `android` / `ios`，所有接口请求会带上 `X-SZ-Platform` 头。服务器据此：

- 按平台显示金豆充值包价格（后台 › 礼物 › 金豆包可分别定价）；
- **在苹果 App 里隐藏加密货币充值**（苹果规定 App 内购买虚拟物品必须走苹果内购）。
- 后台 › 系统配置 › 站点与 App 可设置 App 最低版本、强制更新和下载地址。

## 上架注意

- 苹果、谷歌都要求 App 内购买**虚拟物品**（金豆、礼物、VIP）走各自的内购（苹果 IAP / Google Play Billing）。本版本未接入内购：苹果 App 已隐藏加密货币充值；如需在 App 内卖金豆，后续需要接入内购插件，并在服务器校验收据后发放金豆。
- 实物和线下服务（保洁、外卖、鲜花等订单）可以使用自己的支付方式。
- App 内已提供注销账号（我的 › 设置 › 删除账号）、举报与拉黑、用户协议和隐私政策——这些都是审核要求。
- 推送通知：需要在 Firebase（安卓）和 Apple Push（苹果）配置证书；服务器已预留设备 Token 接口 `POST /api/devices`，发送推送的服务商接入后即可使用。
