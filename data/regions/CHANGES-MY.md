# Malaysia data review (MY.js)

Malaysia is the home market, so its chunk was reviewed by hand on top of the CSC snapshot
`2026-09-26-f3ba8b5b1663`. The upstream data keeps machine translations, English words translated
into Malay as "aliases" and duplicate records; those were visible in the picker and in search.
Everything below is written into `MY.js` itself, and the same rows were re-indexed in the global
search shards (`search/*.js`, 90 shard files), `search-meta.js`, `admins.js` and `meta.js`, so the
country list, the in-country search and the worldwide search agree.

Tuple fields: `[id, en, local(zh), stateId, lat, lon, aliases, type, parentId]` (see SCHEMA.md).
Coordinates, ids and types were not changed.

## Duplicates merged

The newer / district record was removed and its names became aliases of the kept row. The removed
ids are listed in the chunk as `merged: { removedId: keptId }`, so a location saved with an old id
still resolves (regions.js `findRow`).

| Removed | Kept | Result |
| --- | --- | --- |
| 161584 Port Klang | 76539 | `Port Klang` / 巴生港, alias `Pelabuhan Klang` (was 游泳池 "swimming pool") |
| 76438 Daerah Johor Baharu 柔佛巴鲁区 | 76455 | `Johor Bahru` / 新山, aliases `Johor Baharu`, 柔佛巴鲁 |
| 161572 Jenjarom (仁嘉隆) | 76451 | `Jenjarom` / 仁嘉隆, alias `Jenjarum` (was 仁嘉鲁) |
| 161559 Ampang Jaya | 76411 | `Ampang` / 安邦, aliases `Ampang Jaya`, 安邦再也 |
| 161567 Bestari Jaya (八丁燕带) | 76419 | `Bestari Jaya` / 八丁燕带, alias `Batang Berjuntai` (the town's former name) |

MY now has 218 towns (was 223); `meta.js` (`cityCount`, `counts.cities`) and the MY entry of
`statistics.json` (bytes, gzip bytes, sha256, `malaysiaReview`) were updated to match.

## One name per service city

* 76447 George Town → en `Penang`, zh 槟城, aliases `George Town`, 乔治市, 乔治城. The app has
  always called this service city 槟城 / Penang; regions.js used to rename it in code, which made the
  list, the confirmation and the search disagree. The hot-city name in `meta.js` is now 槟城.
* 76520 Malacca → en `Melaka` (official name, matches the rest of the app), alias `Malacca`.
  State 1941: en `Melaka`, aliases `Malacca` (also in `admins.js`).

## Wrong Chinese names

| id | en | was | now |
| --- | --- | --- | --- |
| 76539 | Port Klang | 游泳池 | 巴生港 |
| 76567 | Sungai Besar | 大河 | 大港 |
| 76445 | Data Kakus | 数据卡库斯 | (empty: no established Chinese name; the Malay name is shown) |
| 76504 | Kuang | 匡 | (empty, as above) |
| 76434 | Butterworth | 巴特沃斯 | 北海 (old name kept as alias) |
| 76425 | Beaufort | 博福特 | 保佛 |
| 76513 | Lahad Datu | 拉哈达图 | 拿笃 |
| 76519 | Lumut | 卢穆特 | 红土坎 |
| 76478 | Kangar | 坎加尔 | 加央 |
| 76587 | Yong Peng | 永鹏 | 永平 |
| 76429 | Bidur | 比杜尔 | 美罗, alias `Bidor` |
| 76563 | Simanggang | 西芒冈 | 成邦江, alias `Sri Aman` |
| 76584 | Temerluh | 特梅尔鲁 | 淡马鲁, alias `Temerloh` |
| 76523 | Mentekab | 门特卡布 | 文德甲, alias `Mentakab` |
| 76418 | Banting | 班廷 | 万津 |
| 76458 | Kampong Baharu Balakong | 甘榜巴鲁巴拉孔 | 无拉港, alias `Balakong` |
| 76476 | Kampung Tanjung Karang | 甘榜丹绒卡朗 | 丹绒加弄, alias `Tanjung Karang` |
| 76463 | Kampung Ayer Keroh | 甘榜艾尔克罗 | 爱极乐, alias `Ayer Keroh` |
| 76461 | Kampong Masjid Tanah | 甘榜清真寺 | 马日丹那, alias `Masjid Tanah` |
| 76465 | Kampung Baharu Nilai | 甘榜巴哈鲁汝来 | 汝来新村, alias `Nilai` |
| 76533 | Papar | 帕帕尔 | 吧巴 |
| 76547 | Putatan | 普塔坦 | 必达丹 |
| 76544 | Pontian Kechil | 笨珍小吉 | 笨珍, alias `Pontian` |

## Empty Chinese names filled

Promoted from the Chinese alias (traditional spellings kept as aliases): Assam Jawa 亚参爪哇,
Batang Kali 峇冬加里, Batu Caves 黑风洞, Broga 武来岸, Cyberjaya 赛城, Gombak 鹅唛, Kajang 加影,
Kuala Kubu Bharu 新古毛, Meru 梅鲁, Mutiara Damansara 珍珠白沙罗, Pandamaran 班达马兰,
Sekinchan 适耕庄, Selayang 士拉央, Sepang 雪邦, Seri Kembangan 沙登 (alias `Serdang`).

Added (common local Chinese names): Bangi 万宜, Kapar 加埔, Ulu Yam 乌鲁音, Teluk Datok 直落拿督,
Sabak 沙白, Kuala Sungai Buloh 瓜拉双溪毛糯, Sungai Pelek 双溪比力, Bandar Baru Selayang 士拉央新镇,
Salak Tinggi 沙叻丁宜.

Rows that still have no Chinese name fall back to a Chinese alias, then to the Malay/English name
(regions.js `localName`).

## Junk aliases removed

English words machine-translated into Malay, which made unrelated searches match (e.g. "sup" found
Kuah): Kawasan batu (76437), Kawasan bandar tinggi (76440), Data tandas (76445), Jurubahasa (76456),
Minyak sawit (76480), Sempadan kepala (76482), Bandar tinggi (76491), Sup (76492), Berlebihan (76510),
Badan (76515), Hidangan Lidung (76516), Ke arah (76521), Batu (76523), Kucing (76530), Berkata (76533),
Remis Beach (76532), Minggu (76537), Persimpangan 4-Way (76564), River Pelek New Village (76568),
Jalan Tapah (76579).

## Wrong state

* 76417 Bandar Labuan: Sabah → Labuan (federal territory 1935).
* 76531 Pantai Cenang (Langkawi): Perlis → Kedah (1947).

## Not changed

District rows (`Daerah Batu Pahat`, `Daerah Muar`, …) other than Johor Bahru stay, with their
junk aliases removed; they are real administrative units. Other countries keep the upstream data
(the picker's "About this data" page says so).

The Chinese names above follow common Malaysian Chinese usage; they were checked by hand but not
against an official gazetteer.
