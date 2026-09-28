# 全球国家/地区与城市分块

版本：`2026-09-26-f3ba8b5b1663`。数据源提交：`f3ba8b5b16635b0a39593e44f9f20a7a4f941f63`。

## 文件与加载

- `meta.js`：设置 `window.SHIZHONG_REGIONS_META`，约 50.7KB；只在打开地区选择时加载也可以。
- `<ISO2>.js`：250 个大写国家/地区代码文件，例如 `MY.js`、`CN.js`、`US.js`，设置 `window.SHIZHONG_REGION_CHUNKS[ISO2]`。
- 两者均为 classic script，适用于 HTTP(S) 和 `file://`，无 fetch、模块或后端依赖。
- 每个脚本保留现有 `SHIZHONG_REGION_CHUNKS` 对象，不会清空此前已经加载的国家。
- 所有国家都存在分块，包括源库中城市记录为零的 27 个国家/地区。
- 运行时仅按需加载 meta 和选中的国家文件；不要首屏引入全部 250 个国家。

## META

```js
window.SHIZHONG_REGIONS_META = {
  version: '2026-09-26-f3ba8b5b1663',
  countries: [{
    code: 'MY', name: '马来西亚', en: 'Malaysia', native: 'Malaysia',
    region: 'Asia', capital: 'Kuala Lumpur', cityCount: 223, stateCount: 16,
    searchAliases: []
  }],
  hot: [{countryCode:'MY', cityId:76497, name:'吉隆坡'}],
  counts: {countries:250, states:5308, cities:153336},
  cityFields: ['id','en','local','stateId','lat','lon','aliases','type','parentId'],
  source: {name, url, commit, license},
  pendingIdCount: 366
};
```

上方单个国家条目仅演示字段结构，实际记录数以 `meta.js` 中的对应条目为准。

`name` 优先采用原库 `translations['zh-CN']`；250 个国家/地区均已有含汉字的中文值。`region` 保留源英文洲名，方便界面统一映射。别名数组保留原英文、原生名称及 ISO 代码等已有名称，不生成翻译。

## 国家分块

```js
window.SHIZHONG_REGION_CHUNKS['MY'] = {
  countryCode: 'MY',
  states: [{id, name, en, code, type, parentId, aliases}],
  cities: [
    [76497,'Kuala Lumpur','吉隆坡',1949,3.1412,101.68653,[],'capital',null]
  ]
};
```

城市元组固定 9 位：

| 位 | 字段 | 含义 |
| --- | --- | --- |
| 0 | id | 原始数字 ID，或明确命名空间的 pending 字符串 |
| 1 | en | 原始 `name`，通常为英文或罗马字地名，不保证是英文翻译 |
| 2 | local | 优先原始 zh-CN，其次 native，可为空字符串 |
| 3 | stateId | 原始州省 ID，数字 |
| 4 / 5 | lat / lon | 原坐标转 JSON 数字，无人为坐标修正或四舍五入 |
| 6 | aliases | 原 native、已有英文/简繁中文/romanized/alias 字段的去重名称 |
| 7 | type | 原源分类；可能为 city、town、section、adm1/2 等或 null |
| 8 | parentId | 原城市父级 ID，无值时 null |

当前 153,336 条城市记录全部都有有效坐标；所有城市的国家、州和父级引用检查通过。州省对象 `parentId` 保留源多级行政关系，不应假定 states 只有单一层级。

## ID 与中文覆盖

- 152,970 条记录保留上游数字 ID，不重新编号。
- 366 条最新贡献记录尚无上游 ID，完整保留并赋予 `csc-pending-<ISO2>-<24位SHA256摘要>`。
- 摘要材料为 `[国家代码,州ID,原始name,原纬度字符串,原经度字符串]` 的紧凑 UTF-8 JSON。实际映射逐条写在 `provenance.json`，不冒充上游 ID。
- ID 比较、持久化映射与搜索索引建议统一使用 `String(id)`。
- 149,404 条原 zh-CN 名称含汉字，占 97.4357%；加上 native 回退后，149,747 条显示名称含汉字，占 97.6594%。这些是字段覆盖统计，未宣称逐条人工核实翻译质量。
- 原库没有专门拼音字段；153,323 条原 name 含拉丁字母。中文搜索可用 local/aliases；拼音或英文搜索可使用原 name，并在界面统一做大小写、空格、重音归一化。
- 为控制分块大小，没有把全部 19 种语言复制到每条城市。完整原记录保存在工作目录的 raw 源文件，交付分块保留英语、简繁中文、native 和源有的 romanized/alias 字段。

## 马来西亚快捷城市

| 界面名 | 上游 ID | 上游名称 |
| --- | --- | --- |
| 吉隆坡 | 76497 | Kuala Lumpur |
| 八打灵再也 | 76543 | Petaling Jaya |
| 槟城(乔治市) | 76447 | George Town |
| 新山 | 76455 | Johor Bahru |
| 马六甲 | 76520 | Malacca，native 为 Melaka |
| 怡保 | 76450 | Ipoh |

“槟城(乔治市)”是界面快捷入口兼容名；城市记录仍保留原库的 George Town / 乔治城，不把整个州伪造成一座城市。

## 来源与许可

数据来自社区维护的 Countries States Cities Database，并非各国政府官方名录。原 README 的数量为较早文档值；本交付依据固定提交中实际记录计算，保留所有源国家/地区、州省以及城市表行，未按人口或分类筛选。城市表也包含城镇、区、行政单位、历史地名等，不能表述为绝对覆盖全球全部现存城市。

分块数据库以 ODbL v1.0 发布。请保留 `LICENSE-ODbL-1.0.txt`、`ATTRIBUTION.txt`、`provenance.json` 与数据来源归属；`statistics.json` 包含每国计数、字节数、压缩估计与 SHA-256。

## 全球搜索派生索引

`search-meta.js` 设置 SHIZHONG_REGION_SEARCH_META，描述全部 566 个搜索分片的 count/bytes；`admins.js` 保存 5,308 条州省索引。`search/<key>.js` 设置 SHIZHONG_REGION_SEARCH[key]，元组为 `[countryCode,cityId,en,local,stateId,stateName,foldedSearchText]`。同一城市按别名/单词可出现在不同分片中，同一分片中按国家+ID去重，全部 153,336 条源记录均被索引。

归一化采用 NFKD、去除 Unicode Mark、小写和空白统一；拉丁名称按单词前两个 ASCII 字母分片（一个字母的完整单词保留单字键）；数字归入 d0，其他文字按首 codepoint % 32 归入 u0–u31。全球输入单个拉丁字母时先展示国家/州省，输入第二个字母再查城市；中文可一字查询。国家内独立执行完整记录子串搜索。

搜索和国家分块均为在源数据上派生的数据库，继续使用 ODbL 1.0。来源翻译未逐条人工审核，展示保留原始名称用于核对。
