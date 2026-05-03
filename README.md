<p align="center">
  <img src="public/notification-default.png" alt="LLM Notificator" width="64" height="64">
</p>
<h1 align="center">LLM Notificator</h1>
<p align="center">Claude Code / Codex の作業完了・確認要求をデスクトップポップアップ＋ボイスで通知する常駐マスコット。</p>
<p align="center">
  <a href="https://github.com/R2P2086/LLM-Notificator"><img src="https://img.shields.io/badge/license-Apache%202.0-blue" alt="License"></a>
</p>

## 特徴

- **通知特化**: Claude Code / Codex の作業完了・確認要求・コマンド実行のタイミングを自動検知
- **デスクトップポップアップ**: 画像キャラクターが画面端から飛び出す独自通知（OS通知不使用）
- **ボイス通知**: AivisSpeech / VOICEVOX による日本語音声合成
- **Webhook通知**: Slack / Discord への通知送信（ポップアップの代替）
- **自動ログ監視**: ログファイルを監視、プラグイン不要
- **オフライン動作**: インターネット接続不要でローカル環境で完結
- **カスタマイズ**: 通知画像・フレーズ・ポップアップ位置・アニメーション等を設定可能

## 通知トリガー

### Claude Code

| 条件 | 通知カテゴリ | フレーズ例 |
|---|---|---|
| ターン完了（`end_turn` + テキストあり） | 完了 | 終わったよ！ |
| `AskUserQuestion` ツール使用 | 確認 | 確認してね |
| Bash コマンド（承認待ち） | 確認 | 確認してね |
| Bash コマンド（自動承認済み） | コマンド実行 | コマンド実行！ |
| ファイル編集ツール（承認待ち） | 確認 | 確認してね |
| MCP ツール（承認待ち） | 確認 | 確認してね |

> **通知とパーミッション設定の関係**
>
> - 自動承認の判定は `~/.claude/settings.json` および `.claude/settings.json` / `settings.local.json` の `permissions.allow` / `permissions.ask` をリアルタイム監視して行います。
> - Claude Code の承認ダイアログで **「このセッション中は許可」** を選んだ場合は `settings.json` に書き込まれないため、次回のツール実行でも LLM Notificator は通知します。
> - **「常に許可」** を選んだ場合は `.claude/settings.local.json` に追記され、LLM Notificator は以降の同ツール呼び出しを通知対象外として扱います。
> - プロジェクト外のファイルへの Read / Edit は、`settings.local.json` へ「常に許可」が書き込まれるまで毎回通知します（プロジェクト内のファイルは通知しません）。

> **`Bash` を `permissions.allow` に設定している場合の注意**
>
> `Bash` を `allow` に入れていると、Claude Code が内部ルールで承認ダイアログを出すコマンドでも LLM Notificator は「自動承認済み」と判定します。  
> 通知させたいコマンドは `permissions.ask` に個別に追加してください。以下はよく使われる設定例です。
>
> ```json
> {
>   "permissions": {
>     "allow": ["Bash"],
>     "ask": [
>       "Bash(pip install *)",
>       "Bash(pip3 install *)",
>       "Bash(uv add *)",
>       "Bash(pipx install *)",
>       "Bash(brew install *)",
>       "Bash(npm install -g *)",
>       "Bash(npm install --global *)",
>       "Bash(yarn global add *)",
>       "Bash(deno install -g *)",
>       "Bash(deno install --global *)",
>       "Bash(bun install -g *)",
>       "Bash(bun install --global *)",
>       "Bash(gem install *)",
>       "Bash(cargo install *)",
>       "Bash(git push -f *)",
>       "Bash(git push --force *)",
>       "Bash(rm -rf *)",
>       "Bash(powershell *)",
>       "Bash(powershell.exe *)"
>     ]
>   }
> }
> ```

### Codex

| 条件 | 通知カテゴリ | フレーズ例 |
|---|---|---|
| ターン完了（`task_complete`） | 完了 | 終わったよ！ |
| コマンド承認待ち（`require_escalated`） | 確認 | 確認してね |

## 利用環境

| 環境 | 対応状況 |
|---|---|
| Windows（Claude Code CLI / VSCode拡張） | ✅ |
| Windows（Codex CLI / VSCode拡張） | ✅ |
| WSL で Claude Code | ⚠️（ターン完了通知のみ対応・承認待ち通知は未対応・手動パス設定必須） |
| macOS | ❓（未確認） |
| Claude Desktop | ❌（ログ形式が異なる） |

## セットアップ

### 1. 音声合成エンジンのインストール（任意）

ボイス通知を使用する場合は以下のいずれかをインストールしてください。

**[AivisSpeech](https://aivis-project.com/)** （推奨）

インストーラー版によるグローバルインストールを推奨します。

> [!TIP]
> エンジンへのデフォルトパス (Windows):
> `C:\Program Files\AivisSpeech\AivisSpeech-Engine\run.exe`

初回起動とモデルDLまで済ませれば、以降は LLM Notificator が自動的にエンジンプロセスを起動します。

**[VOICEVOX](https://voicevox.hiroshiba.jp/)** も設定から切り替えて利用可能です。

### 2. LLM Notificator のインストール

下記から最新バイナリをインストールしてください。

https://github.com/R2P2086/LLM-Notificator/releases

### 3. 起動

アプリケーションを起動するとシステムトレイにアイコンが表示されます。  
音声合成エンジンが見つからない場合はダイアログが表示されます。設定画面でエンジンパスを確認してください。

## 基本操作

### システムトレイメニュー

- **通知モード**: 両方（ポップアップ＋発話）/ ポップアップのみ / 発話のみ を切り替え
- **設定を開く**: 設定画面にアクセス
- **バージョン情報**: バージョン確認・アップデートチェック
- **終了**: アプリを終了

### ポップアップ

音声再生終了後に自動で閉じます（エンジン未起動時は 8 秒後に自動 dismiss）。

## 設定

設定はシステムトレイ → 「設定を開く」で開きます。

### キャラクタータブ

| 設定 | 内容 |
|---|---|
| 通知画像 | PNG / JPG / GIF / SVG / WebP（GIFはアニメーション対応） |
| サイズ | 80〜400px |
| 表示位置 | 8方向（右下 / 左下 / 下中央 / 右上 / 左上 / 上中央 / 右中央 / 左中央） |
| アニメーション | スライド / ポップ / フェード / なし |
| 通知モード | 両方 / ポップアップのみ / 発話のみ |

### 音声タブ

| 設定 | 内容 |
|---|---|
| エンジン | AivisSpeech / VOICEVOX / カスタムパス |
| 音声スタイル | 話者・スタイルをエンジンから自動取得して選択 |
| 音量 | 0.00〜2.00 |
| 発話フレーズ | 感情ごとのフレーズをカスタマイズ可能 |

### 監視タブ

| 設定 | 内容 |
|---|---|
| Claude Code 監視フォルダ | デフォルト: `~/.claude/projects/`（WSL環境は手動設定） |
| Claude Code セッション | 起動後に最初に動いたセッションを自動検出して固定。設定画面から解除可能 |
| Codex 監視フォルダ | デフォルト: `~/.codex/sessions/` |
| Codex セッション | 起動後に最初に動いたセッションを自動検出して固定。設定画面から解除可能 |

### その他タブ

| 設定 | 内容 |
|---|---|
| Webhook通知 | Slack / Discord / Microsoft Teams（未検証）へのメッセージ送信 |
| サブエージェントを含める | サブエージェントのログも通知対象に含める |
| アップデート確認 | 起動時の自動アップデートチェック |

> [!NOTE]
> Webhook通知を有効にしている場合、アプリ側のポップアップ・発話通知はされません。

## Webhook通知

Slack / Discord の Incoming Webhook URL を設定画面に貼り付けることで、通知をチャットに送信できます。  
「完了」「確認」カテゴリの通知のみ送信されます（コマンド実行は対象外）。

**Slack**: [api.slack.com/apps](https://api.slack.com/apps) でアプリを作成 → Incoming Webhooks を有効化  
**Discord**: サーバー設定 → 連携サービス → ウェブフック → 新しいウェブフック

## 開発者向け

### 仕組み

```
Claude Code / Codex
    ↓ JSONL ログ出力
~/.claude/projects/**/*.jsonl
~/.codex/sessions/**/*.jsonl
    ↓ chokidar 監視（LLMごとに独立したモニター）
Electron メインプロセス
    ↓ ログパース・感情判定・auto-approve 判定
Electron レンダラープロセス
    ↓ ポップアップ表示 + 音声合成 API 呼び出し
AivisSpeech / VOICEVOX
```

### 開発環境のセットアップ

```bash
git clone https://github.com/R2P2086/LLM-Notificator.git
cd LLM-Notificator
npm install
npm run dev
```

### 技術スタック

| 技術 | 用途 |
|---|---|
| Electron | デスクトップアプリ化 |
| React + TypeScript + Vite | フロントエンド |
| Tailwind CSS | スタイリング |
| chokidar | ログファイル監視 |
| AivisSpeech / VOICEVOX | 音声合成（外部プロセス） |
| IndexedDB | 画像ファイル永続化 |
| electron-store | 設定永続化 |
| electron-updater | 自動更新 |

### 参考

- フォーク元: [cc-mascot](https://github.com/kazakago/cc-mascot) by kazakago（Apache License 2.0）
- [AivisSpeech](https://aivis-project.com/)
- [VOICEVOX](https://voicevox.hiroshiba.jp/)

## 素材

- デフォルト通知画像: 画像生成AIで作成

## ライセンス

[Apache License 2.0](LICENSE)

本プロジェクトは [cc-mascot](https://github.com/kazakago/cc-mascot)（Copyright 2026 kazakago, Apache License 2.0）をフォークして大幅に改変したものです。
