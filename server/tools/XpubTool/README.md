# 收款钱包扩展公钥工具（离线） / Offline xpub helper

加密货币充值的收款地址由**扩展公钥（xpub / zpub）**推导。服务器上只保存扩展公钥：它能生成全部收款地址，但**不能转走任何资金**。

> **绝对不要**把助记词（12/24 个英文单词）或私钥（xprv / zprv）填进管理后台、发给任何人或保存在服务器上。
> 后台会拒绝助记词和私钥。归集资金时，用你自己手里的钱包（持有助记词）操作。

## 用法

在你自己的电脑上、**断开网络**后运行（需要 .NET 8 SDK）：

```bash
dotnet run --project server/tools/XpubTool
```

按提示输入助记词（输入时显示为 `*`，不会进入命令历史）和 BIP39 密码（没有就回车）。工具输出三行：

| 后台字段 | 路径 | 用于 |
|---|---|---|
| ETH/BSC 扩展公钥 | `m/44'/60'/0'` | USDT/USDC（ERC-20、BEP-20）、ETH |
| TRON 扩展公钥 | `m/44'/195'/0'` | USDT（TRC-20） |
| 比特币扩展公钥（zpub） | `m/84'/0'/0'` | BTC（bc1… 原生隔离见证地址） |

每行下面列出前 3 个收款地址，请和你的钱包 App 里显示的地址对照，一致再粘贴到后台「财务 › 加密货币设置」。
用户地址按 `…/0/0`、`…/0/1`、… 依次分配，钱包按默认的地址间隔（gap limit）就能找到全部地址。

`dotnet run --project server/tools/XpubTool -- --self-test` 用公开的测试助记词（abandon … about）校验推导结果（BIP-84 官方测试向量）。

---

Receiving addresses are derived from extended **public** keys only; the server can never move funds. Never enter the recovery
phrase or a private key (xprv/zprv) into the console — it is refused. Run the tool offline on your own computer, compare the
first addresses with your wallet app, then paste the three xpub/zpub lines into Finance › Crypto settings.
