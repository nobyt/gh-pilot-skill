# copilot-delegate

[`@github/copilot-sdk`](https://github.com/github/copilot-sdk) を使って、AI コーディングアシスタントからコーディングタスクを [GitHub Copilot CLI](https://github.com/features/copilot/cli) に委譲するための CLI ツールです。

Claude Code、GitHub Copilot、Codex CLI、Gemini CLI など、シェルコマンドを実行できるエージェントであればどれでも利用できます。

[English README](./README.md)

## なぜこのツールが必要か

AI コーディングセッションが長くなるほど会話コンテキストが積み重なり、リクエストのたびにトークンコストが増大します。ファイル編集・コードベース調査・大量リファクタリングなどの重いタスクを別プロセスの Copilot に委譲することで、呼び出し元のエージェントは結果のコンパクトな JSON だけを受け取ればよく、コンテキストウィンドウを小さく保てます。

```
エージェントのセッションコンテキスト  ──── 委譲 ────▶  Copilot CLI サーバー
        ↑ 約100トークン                                    （別プロセス）
        └───────── JSON 結果 ─────────────────────────────┘
```

## アーキテクチャ

```
copilot-delegate <task.yaml>
        │
        │  RuntimeConnection.forUri()  （TCP 経由 JSON-RPC）
        ▼
copilot --headless --port 3000   （常駐サーバー）
        │
        ▼
BYOK で任意の LLM  （Anthropic, OpenAI, Azure, ローカルモデルなど）
```

Copilot CLI サーバーはバックグラウンドで一度だけ起動し、セッション履歴を保持し続けます。`copilot-delegate` の各実行は前回の文脈を引き継がない新規セッションを作成し、JSON を出力して終了します。呼び出し間でコンテキストを引き継ぎたい場合は SDK の `resumeSession` を使用してください。

## 前提条件

- Node.js 20 以上
- GitHub Copilot CLI（`npm install -g @github/copilot-cli` またはパッケージマネージャー経由）
- GitHub Copilot サブスクリプション **または** BYOK API キー

## インストール

```bash
git clone https://github.com/your-org/copilot-delegate
cd copilot-delegate
npm install
npm run build
npm link          # `copilot-delegate` コマンドをグローバルに使えるようにする
```

## 使い方

### 1. Copilot CLI サーバーを起動する

ターミナルで一度だけ実行します（バックグラウンドサービスとして常駐させることも可能）:

```bash
copilot --headless --port 3000 --allow-all --add-dir /path/to/your/project
```

| フラグ | 目的 |
|--------|------|
| `--headless` | サーバーモードで起動（インタラクティブ UI なし） |
| `--port 3000` | TCP ポート 3000 でリッスン |
| `--allow-all` | すべてのツールリクエストを自動承認（確認なし） |
| `--add-dir` | 指定ディレクトリへのファイルアクセスを許可 |

### 2. 環境を設定する

`.env.example` を `.env` にコピーして値を記入します:

```bash
cp .env.example .env
```

```dotenv
COPILOT_SERVER_URL=http://localhost:3000
COPILOT_DEFAULT_MODEL=auto
COPILOT_GITHUB_TOKEN=ghp_...   # または GH_TOKEN / GITHUB_TOKEN
```

### 3. タスクファイルを書く

```yaml
# task.yaml
task:
  type: code-edit          # code-edit | research | long-task
  prompt: |
    src/auth.ts の JWT 検証を RS256 対応に修正してください。
    現在は HS256 のみ対応しています。
  context:
    files:
      - src/auth.ts        # プロンプトにそのまま埋め込まれるファイル

provider:
  model: claude-haiku-4.5  # 省略時は COPILOT_DEFAULT_MODEL を使用

permissions:
  allowedTools:
    - read                 # shell | read | write | mcp | url | memory | hook
    - write

output:
  format: json             # json | markdown | raw
```

### 4. コマンドを実行する

```bash
copilot-delegate task.yaml
```

**出力（JSON）:**

```json
{
  "status": "success",
  "message": "JWT 検証を RS256 対応に修正しました。公開鍵による検証に変更しています。",
  "editedFiles": ["src/auth.ts"],
  "model": "claude-haiku-4.5"
}
```

JSON ではなくプレーンテキストで出力したい場合は `--raw` を使います:

```bash
copilot-delegate task.yaml --raw
```

## エージェント別インテグレーション

CLI は JSON を stdout に出力するため、シェルコマンドを実行して JSON をパースできるエージェントであればどれでも利用できます。

### Claude Code

付属の Agent Skill をインストールします:

```bash
mkdir -p ~/.claude/skills/copilot-delegate
cp skill/SKILL.md ~/.claude/skills/copilot-delegate/SKILL.md
```

セッション内で以下のように呼び出します:

```
/copilot-delegate
```

Claude がリクエストを分析し、タスク YAML を生成して `copilot-delegate` を呼び出し、JSON をパースして結果を報告します。会話コンテキストを肥大化させることなく完結します。

### GitHub Copilot CLI（カスタムエージェント / 拡張）

シェルツールまたはカスタムエージェントハンドラーから `copilot-delegate` を呼び出します:

```bash
copilot-delegate task.yaml
```

JSON 出力をパースし、`message` をエージェントのレスポンスに組み込みます。

### Codex CLI

シェル実行機能で標準出力を読み取ります:

```bash
result=$(copilot-delegate task.yaml)
echo "$result" | jq '.message'
```

### Gemini CLI

シェルツール呼び出しで実行し、JSON 結果を次のプロンプトステップに渡します。

### 共通パターン

どのエージェントでも以下のパターンで動作します:

1. ユーザーのリクエストに基づいて `task.yaml` を生成
2. `copilot-delegate task.yaml` を実行
3. stdout から `{ status, message, editedFiles, model }` をパース
4. `message` と `editedFiles` をユーザーに提示

## タスクファイルリファレンス

### `task`

| フィールド | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| `type` | `code-edit \| research \| long-task` | はい | タスクの種類（情報的なもの） |
| `prompt` | string | はい | Copilot への指示。呼び出し元エージェントの会話履歴に依存しない自己完結した内容にする必要があります |
| `context.files` | string[] | いいえ | プロンプトにそのまま埋め込む相対パスのファイル一覧 |

### `provider`

| フィールド | 型 | デフォルト | 説明 |
|-----------|-----|-----------|------|
| `model` | string | 環境変数 `COPILOT_DEFAULT_MODEL` | モデル ID（`auto`、`claude-haiku-4.5`、`gpt-5-mini`、または BYOK モデル） |

### `permissions`

| フィールド | 型 | デフォルト | 説明 |
|-----------|-----|-----------|------|
| `allowedTools` | PermissionKind[] | `[]`（全承認） | Copilot が使用できるツールの種類を制限します。空配列の場合は `approveAll`（全承認） |

利用可能なパーミッション種別: `shell`, `read`, `write`, `mcp`, `url`, `memory`, `hook`

### `output`

| フィールド | 型 | デフォルト | 説明 |
|-----------|-----|-----------|------|
| `format` | `json \| markdown \| raw` | — | AI のレスポンスフォーマットを指定します。CLI 自体は `--raw` フラグを渡さない限り常に JSON を出力します |

## 環境変数

| 変数 | デフォルト | 説明 |
|------|-----------|------|
| `COPILOT_SERVER_URL` | `http://localhost:3000` | 起動中の Copilot CLI サーバーの URL |
| `COPILOT_DEFAULT_MODEL` | `auto` | `provider.model` を省略した場合のデフォルトモデル |
| `COPILOT_GITHUB_TOKEN` | — | GitHub 認証トークン |
| `GH_TOKEN` / `GITHUB_TOKEN` | — | 代替 GitHub トークン変数名 |

## BYOK（Bring Your Own Key）

GitHub Copilot サブスクリプションなしでモデルを使用するには、独自の API キーで Copilot CLI サーバーを設定します。詳細は [BYOK ドキュメント](https://github.com/github/copilot-sdk/blob/main/docs/auth/byok.md) を参照してください。

## 利用可能なモデルの確認

起動中のサーバーに接続してモデル一覧を取得します:

```bash
node -e "
import('@github/copilot-sdk').then(async ({ CopilotClient, RuntimeConnection }) => {
  const c = new CopilotClient({ connection: RuntimeConnection.forUri('http://localhost:3000') });
  await c.start();
  const models = await c.listModels();
  console.log(models.map(m => m.id));
  await c.stop();
});
"
```

## トークン効率について

実測値（`claude-haiku-4.5` でのコード編集タスク）:

| 対象 | トークン消費 |
|------|-------------|
| Copilot プロセス（入力合計） | 約 26,000 |
| 呼び出し元エージェントのコンテキストへの追加 | 約 100（JSON 結果のみ） |

長いセッションほど効果が大きく、大規模なコードベースの一括変更タスクで特に有効です。

## サンプル

[`examples/`](./examples) ディレクトリを参照してください:

- [`code-edit.yaml`](./examples/code-edit.yaml) — 書き込みパーミッションでソースファイルを修正
- [`research.yaml`](./examples/research.yaml) — コードベースを調査してレポートを生成
- [`long-task.yaml`](./examples/long-task.yaml) — 多数のファイルに対する一括置換

## ライセンス

MIT
