# Codex Reset Alarm

[中文](#中文) · [English](#english)

## English

**Codex Reset Alarm** is a small Cloudflare Worker that watches Tibo's public
Codex reset feed and sends one Bark notification only when a reset signal is
specific enough to be useful. It needs no X API access and no AI/API token.

### What it alerts on

- a concrete upcoming reset;
- a reset that has completed;
- an arriving or scheduled banked reset; or
- a feed item explicitly classified as a reset announcement.

It deliberately ignores vague teasers and ordinary discussion. Each matching
post ID is persisted in Cloudflare KV and notified at most once. There is no
acknowledgement workflow.

### Notification policy (China Standard Time)

| Signal | 23:00–15:59 | 16:00–22:59 |
| --- | --- | --- |
| Upcoming reset | Bark Critical Alert, alarm sound, call mode, volume 2 | silent Critical Alert |
| Completed reset | silent one-time alert | silent one-time alert |

When a post includes a reliable relative or Pacific-time clock, the message
also shows a converted Beijing time. When it does not, the message says that
an exact conversion is unavailable.

### Architecture

```text
Cloudflare Cron (every minute)
  → https://codex-reset.com/api/feed
  → strict classifier + time conversion
  → Cloudflare KV cursor / deduplication state
  → Bark iOS notification
```

The Worker has a public `/health` endpoint and a small status dashboard at
`/`. The dashboard's test control requires an administrator token.

### Deploy your own copy

Prerequisites: a Cloudflare account, a Bark-enabled iPhone, Node.js, and pnpm.

```sh
pnpm install
pnpm check
pnpm test

# Create a namespace and copy its returned ID into wrangler.jsonc.
pnpm exec wrangler kv namespace create STATE

# Deploy, then enter these values interactively. Do not add them to a file.
pnpm deploy
pnpm exec wrangler secret put BARK_DEVICE_KEY
pnpm exec wrangler secret put ADMIN_TOKEN
```

`wrangler.jsonc` intentionally contains `YOUR_KV_NAMESPACE_ID`; replace it in
your local working copy before deploying. Secrets are Cloudflare Worker
secrets, are not committed, and must not be logged or shared.

On the first successful cron run, the Worker records the latest feed item as
its cursor without alerting on historical entries.

### Limits and safety notes

- The service relies on the third-party public feed at
  `https://codex-reset.com/api/feed`. Its availability, schema, and
  classification can change without notice.
- This is a personal notification helper, not an official OpenAI service and
  not a guarantee that a reset will happen.
- The classifier is intentionally conservative; a false negative is preferred
  to waking someone for a vague post.
- Cloudflare and Bark usage may be subject to their respective limits and
  terms. The default Worker design fits typical low-volume free-tier use, but
  you should check your own account limits.

## 中文

**Codex Reset Alarm** 是一个运行在 Cloudflare Worker 上的小型提醒器。它每分钟读取 Tibo 的公开 Codex reset feed，只在信号足够明确时通过 Bark 提醒。无需 X API，也无需 AI/API token。

### 会提醒什么

- 明确预告即将 reset；
- 明确表示已经 reset；
- 明确即将到账或已经排期的 banked reset；
- feed 明确标为 reset announcement 的消息。

普通讨论、模糊预告不会提醒。每个匹配消息只提醒一次；消息 ID 存在 Cloudflare KV 中，没有 ACK 流程。

### 北京时间作息策略

| 信号 | 23:00–15:59 | 16:00–22:59 |
| --- | --- | --- |
| 即将 reset | Bark Critical、闹铃、call 模式、音量 2 | 静默 Critical |
| 已经 reset | 静默一次 | 静默一次 |

原文提供可可靠换算的相对时间或美国西海岸钟点时，通知会附上北京时间；无法可靠换算时会明确说明。

### 架构

```text
Cloudflare Cron（每分钟）
  → 公共 feed
  → 严格判定与北京时间换算
  → Cloudflare KV 游标 / 去重状态
  → Bark iOS 通知
```

`/health` 提供健康检查，`/` 提供状态页；状态页的测试按钮需要管理员令牌。

### 自行部署

需要 Cloudflare 账号、已配置 Bark 的 iPhone、Node.js 与 pnpm：

```sh
pnpm install
pnpm check
pnpm test
pnpm exec wrangler kv namespace create STATE
# 将返回的 namespace ID 填入自己本地的 wrangler.jsonc
pnpm deploy
pnpm exec wrangler secret put BARK_DEVICE_KEY
pnpm exec wrangler secret put ADMIN_TOKEN
```

仓库中的 `YOUR_KV_NAMESPACE_ID` 只是安全占位符。部署前在你自己的本地副本替换它；密钥仅通过 Cloudflare secret 命令输入，绝不提交、打印或共享。第一次 cron 成功运行只记录最新消息作为游标，不会把旧历史再推送一遍。

### 限制

- 项目依赖第三方公开 feed；其可用性、字段和判定可能变化。
- 这不是 OpenAI 官方服务，也不能保证 reset 必然发生。
- 判定刻意保守：宁可漏掉模糊消息，也不因模糊消息吵醒人。
- Cloudflare 与 Bark 可能有各自的条款与额度，请以自己的账户为准。

## License

[MIT](LICENSE)
