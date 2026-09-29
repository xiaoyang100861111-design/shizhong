# 压力测试脚本（tools/load）

用来对适中后端做压力测试 / 并发正确性测试。结果和结论见 `docs/压力测试报告.md`。

> **只在测试库 / 预发布环境上跑，不要对正式库跑。** 脚本会用后台"人工调账"给测试会员加余额和金豆（流水备注"压测准备"），
> 会下真实订单、发红包、送礼、提交提现（提现测试完会自动取消），还会注册少量新会员（名字以"压测"开头）。
> 推荐做法：把正式库备份还原成一个 `shizhong_load` 库，或者用测试数据生成器（`--seed`，见 `docs/测试数据.md`）造一个库。

## 准备

```bash
cd tools/load
python -m venv venv && venv\Scripts\activate        # Linux: source venv/bin/activate
pip install -r requirements.txt
```

- API 必须能用测试数据账号登录：会员密码 `Test@2026`（测试数据生成器生成的），后台 `admin / 123123`
  （可用环境变量 `SZ_ADMIN_USER` / `SZ_ADMIN_PASS` / `SZ_SEED_PASSWORD` 修改）。
- 目标地址：`--base http://127.0.0.1:5089` 或环境变量 `SZ_BASE`。
- **在服务器本机上跑**（直接连 IIS / Kestrel 的端口，不经过 Cloudflare）。原因：登录接口有限流（每个 IP 5 分钟 30 次），
  脚本登录很多会员时会带随机的 `X-Forwarded-For`，API 只信任来自本机 / 内网 / Cloudflare 的转发头，从外网直接打会被限流。
  另外经过 Cloudflare 测到的是 Cloudflare 的能力，并且可能被它当成攻击拦截。
- 会员的登录令牌缓存在 `out/sessions-*.json`，第二次运行不再登录。结果 JSON 也写在 `out/`。
- 在服务器上跑时，加 `--pid <API 进程号>`（IIS 下是 w3wp.exe 的进程号）或设 `SZ_API_PID_FILE`，结果里会带上 API 进程的
  CPU / 内存和 sqlservr 的 CPU（需要 psutil，Windows 上需要以管理员运行才能读取 sqlservr）。

## 脚本

| 脚本 | 测什么 | 常用参数 |
| --- | --- | --- |
| `read_load.py` | 读接口逐个加压（10 → 50 → 100 → 200 并发）：启动数据 `/core/server.js`、`/api/state`、`/data/people.js`、各类 `/data/*.js`、商品搜索、钱包、流水、订单详情、动态、直播间列表、金豆包、配置；最后跑一个按真实比例混合的"App 流量" | `--levels 10,50,100,200 --seconds 10 --only boot,people --mixed-only` |
| `write_load.py` | 写接口吞吐：钱包下单、买金豆、同一直播间送礼（所有人抢主播同一行）、分散到所有直播间送礼、直播评论、一对一聊天 | `--levels ... --users 300 --only gift-one-room` |
| `money_race.py` | **资金并发正确性**（每项 PASS / FAIL）：同一人并发下单不超扣、多人并发下单、同一张券并发使用、并发买金豆、同一直播间并发送礼（主播收益、房间金豆）、互相送礼（死锁探测）、群红包 100 人抢 50 份、转账同时"收款 + 退回"、并发提现（每日次数 / 金额上限）、并发领任务奖励、同一人各种扣款同时发生 | `--only orders,packet --members 100` |
| `realtime_load.py` | SignalR 实时通道：600 个连接、400 人在同一直播间收评论 / 礼物（延迟、丢失）、200 对私聊、150 人群聊 | `--conns 600 --viewers 400 --only live,pairs` |
| `admin_load.py` | 后台：仪表盘、会员列表（筛选 / 搜索）、订单、资金流水、对账、CSV 导出，先单独测，再在 App 并发 100 的同时测 | `--levels 2,10 --app-conc 100` |
| `auth_load.py` | 登录：同一 IP 同时 40 次登录（应 30 次成功、其余 429）；再用不同 IP 测登录吞吐（BCrypt 很耗 CPU） | `--n 300 --conc 10,20,50` |
| `sql/checks.sql` | 压测后的一致性检查（只读，每项 problems 应为 0） | `sqlcmd -S . -d shizhong -E -i sql\checks.sql` |
| `sql/top_queries.sql` | 最耗 CPU 的 SQL（找慢查询） | 同上 |

建议顺序：

```bash
python read_load.py  --seconds 10
python write_load.py --seconds 10
python money_race.py                 # 退出码 1 = 有 FAIL
python realtime_load.py
python admin_load.py
python auth_load.py                  # 会用掉本机一个 IP 5 分钟的登录额度
sqlcmd -S . -d <库名> -E -i sql\checks.sql
dotnet Shizhong.Api.dll --seed-verify   # 在 API 目录下，连同一个库；有问题时退出码 2
```

然后看 API 日志里有没有 `fail:`（未处理异常）、`deadlock`（1205）、`Timeout expired`（连接池耗尽或 SQL 超时）。

## 怎么看结果

- `rps` 每秒完成的请求数；`p50 / p95 / p99 / max` 响应时间（毫秒）；`err` 非 2xx 的比例和最常见的错误码。
- 写接口里的 `429 common.tooMany` 是**正常的保护**：每个会员 10 秒内最多 30 次写操作（突发 60 次），不算故障。
- 客户端是单个 Python 进程，本身每秒最多发几千个请求。像 `/api/health` 这种极轻的接口测到的是客户端上限，不是服务器上限；
  需要更高压力时可以在另一台机器上再开一个进程同时跑。
- 服务器、数据库和压测脚本在同一台机器上时，三者互相抢 CPU，数字只能当作参考。
