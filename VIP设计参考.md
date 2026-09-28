# VIP 设计参考与演示规则

研究日期：2026-09-27。产品版本：`20260927-vip1`。

## 官方公开依据

1. 抖音直播“看播有礼”页面中的玩法指南说明，荣誉等级与累计消费金额相关，从 10 级起可解锁不同特权，等级身份可展示在进场效果、评论和个人主页。该页另把粉丝团描述为通过任务取得亲密度成长的体系。
   来源：[官方直播玩法指南](https://webcast.amemv.com/magic/eco/runtime/release/69857c93dea2dc075f79d4c8?__live_platform__=webcast&app=aweme&appType=webcast&auto_play_bgm=1&hide_nav_bar=1&hide_status_bar=0&loader_name=forest&magic_page_no=1&magic_source=mp_default&should_full_screen=1&show_back=0&tt_from=copy&ug_share_id=d88600c54746e_1773648021723)。活动页描述不能代表所有账号、地区或时期的完整规则。
2. 开放平台文档分别定义 `user_privilege_level`（用户荣誉等级）与 `fansclub_level`（当前直播间粉丝团等级），两套等级应分别处理；字段示例值不是等级上下限。
   来源：[互动工具开发者指南](https://partner.open-douyin.com/docs/resource/zh-CN/live-interactive-tools/development/tutorial/live-tool-guide)。
3. 官方直播 SDK 包含荣誉等级、粉丝团、等级礼物和礼物动画广播，需要按官方接入及账号授权流程使用。
   来源：[抖音直播 SDK 功能介绍](https://open.douyin.com/platform/resource/docs/ability/douyin-live-sdk/introduction/)。
4. 像塑提供礼物及直播互动特效的创作入口。这是创作与分发生态，不是授权独立网站任意复制抖音完整进场动画包的声明。
   来源：[像塑](https://effect.douyin.com/)及其链接的[直播互动创作](https://anchor.douyin.com/interact)。

本次未获得可核实的官方完整等级阈值表、当前最高等级说明或经验精确换算表，也没有取得可用于独立 H5 再分发的官方完整进场特效包。聚合搜索页中显示的“抖音直播”视频可定位到[直播荣誉等级页更新](https://www.douyin.com/video/7620393075524766995)，但正文未能直接读取，未根据聚合页 AI 文稿建立阈值或经验规则。

## 适中采用的原创演示配置

- 默认 VIP10，对应 1,000 初始成长值，不表示已有真实消费。已有账号首次启用时保存原赠礼累计基线，此后成功赠礼继续成长。
- 等级范围 1–75，全部阈值由适中设计原稿配置，**不是抖音官方价格表或原版等级规则**。
- 公开直播与一对一聊天成功赠礼，每使用 1 金豆获得 1 成长值；免费领取金豆、预览、红包和转账不增加成长。
- VIP10 荣耀金冠、VIP20 玫瑰星雨、VIP35 星河降临、VIP50 赤金帝冠，均为原创 CSS／Canvas 全屏进场效果；复用本地已有且附来源说明的素材，不宣称抖音原版动画。
- VIP 初始化、升级和效果预览不额外改变金豆或 RM 钱包；实际赠礼仍沿用原交易扣款。初始成长与余额迁移分别管理，`demoBalanceVersion` 固定为 `20260927-funds1`。
- 原 PLUS 生活服务会员继续作为独立入口。以上均为本地交互原稿，不接入抖音账号、真实支付或远端等级系统。
