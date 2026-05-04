# デスクトップマスコット通知アプリ 設計メモ

## コンセプト

Claude Code の作業完了・確認要求などのタイミングを検知し、  
デスクトップマスコットがポップアップ＋ボイスで通知するアプリ。

チャットクライアントではなく「通知特化の常駐マスコット」。

---

## 方針決定の経緯

### 検討した検知方式

| 方式 | 結論 |
|---|---|
| OCR による画面監視 | バックグラウンド時に検知不可。却下 |
| ファイル監視（CLAUDE.md への追記） | ユーザー環境を汚す。却下 |
| Claude Code ログファイル監視 | ユーザー環境への変更ゼロ・バックグラウンド対応。採用 |

### 参考プロジェクト

**cc-mascot**（kazakago 氏）  
https://github.com/kazakago/cc-mascot

Claude Code のログを監視してキャラクターが喋るデスクトップマスコット。  
Apache License 2.0 でオープンソース公開されており、フォーク・改変・再配布が許可されている。

---

## ログ監視の仕組み

```
Claude Code / Codex CLI
    ↓ JSONL ログ出力
~/.claude/projects/**/*.jsonl  /  ~/.codex/sessions/**/*.jsonl
    ↓ chokidar で監視（LLM ごとのモニター）
Electron メインプロセス（logMonitorUtils.ts 共有基盤）
    ↓ ログパース・感情判定（LLM ごとのパーサー）
マスコット表示 + ボイス再生
```

- LLM ごとに独立したモニター（`logMonitor.ts` / `codexLogMonitor.ts`）とパーサー（`claudeCodeParser.ts` / `codexParser.ts`）
- ファイル I/O・デバウンス・リスキャン等の共通処理は `logMonitorUtils.ts` に集約
- 30 秒ごとに最新 JSONL ファイルをスキャンして新セッションを自動検出（LLMN 再起動不要）
- Claude Code: `message.role === 'assistant'` かつ `message.type === 'message'` のテキストコンテンツのみ抽出
- `tool_use` / `thinking` タイプのコンテンツは除外されるため「作業中」状態は自然にスキップ
- Claude Code / Codex 側への変更・設定追加は一切不要

---

## 対応環境

| 環境 | 対応方法 |
|---|---|
| Windows ネイティブ（Claude Code CLI） | デフォルトパスで自動検出 |
| Windows ネイティブ（VSCode 拡張） | 同上（同じログファイルを使用） |
| WSL で Claude Code | `\\wsl$\...` パスをユーザーが手動設定 + 自動ポーリングモード |
| macOS | デフォルトパスで自動検出 |
| Claude Desktop | 対象外（ログ形式が異なる） |
| OpenAI Codex CLI（Windows/macOS） | `~/.codex/sessions/**/*.jsonl` をポーリングで自動検出 |

### WSL 対応の技術的補足

WSL2 は 9P プロトコルの制約でファイル変更イベントが Windows 側に通知されない。  
chokidar の `usePolling: true` で回避可能。WSL パスを検出したら自動切換えする。

```typescript
const isWslPath = (p: string) =>
  p.startsWith('\\\\wsl$') || p.startsWith('\\\\wsl.localhost');

chokidar.watch(watchPath, {
  usePolling: isWslPath(watchPath),
  interval: 1000,
})
```

---

## 機能要件

### 通知ポップアップ
- OS のネイティブ通知ではなくアプリ独自のポップアップ
- キャラクターが画面端から「飛び出してくる」アニメーション
- 短いアニメーション後に引っ込む（またはクリックで閉じる）

### ボイス再生
- 合成エンジン（AivisSpeech / VOICEVOX）をメインで使用
- エンジンが未起動の場合は WAV ファイルにフォールバック（または無音）
- ユーザーが外部 WAV/MP3 ファイルを差し替え可能（オプション）
- 発話テキストは固定文字列を感情状態ごとに切り替え（ランダム選択）

```
complete: ["終わったよ！", "できたよ", "完了したよ"]
waiting:  ["確認してね", "ちょっと見てほしいな", "どうする？"]
error:    ["問題が起きたよ", "エラーが出たよ"]
```

### キャラクター
- PNG/JPG/GIF/SVG/WebP の画像ファイルをユーザーが差し替え可能（IndexedDB に保存）
- デフォルト画像: `public/notification-default.svg`（紫円キャラクター）
- アニメーション GIF を設定すると通知中にアニメーションされる（static モード活用）
- VRM / Three.js は廃止（リップシンク・表情変化なし）

### ポップアップ表示設定

| 設定 | 選択肢 | デフォルト |
|---|---|---|
| 位置（position） | bottom-right/left/center, top-right/left/center, right-center, left-center | bottom-right |
| アニメーション（animation） | slide, pop, fade, static | slide |
| 方向（direction） | primary, secondary | primary |

- `direction` はコーナー位置（bottom-right 等）かつ slide/pop 時のみ有効
- `primary` = 縦軸（上下）、`secondary` = 横軸（左右）
- ポップアップ位置は `screen.getDisplayNearestPoint().workArea` を基準に計算するためタスクバー（Windows）・Dock（macOS）の高さを自動考慮する。Windows ではキャラクターがタスクバーより前面に表示され、macOS では Dock より後面に表示される（OS の Z 順による）

### ボイス合成エンジン
cc-mascot は VOICEVOX REST API を使用。AivisSpeech も同一 API 形式なので `baseUrl` 切り替えで対応可能。

- **デフォルト推奨**: AivisSpeech（より自然な音声）、VOICEVOX に切り替え可
- **エンジン未起動時**: 8 秒後に自動 dismiss（無音フォールバック）
- **設定 UI**: エンジン選択 + スピーカーID + ベース URL

cc-mascot との差分（**本プロジェクトは全文読み上げではなくポップアップ通知**）:
- cc-mascot: Claude の返答テキストをそのまま読み上げ
- 本プロジェクト: 感情状態に対応した固定フレーズを再生

### 監視設定
- デフォルトは `~/.claude/projects/` を自動検出（cc-mascot と同じパス。`sessions/` はセッションメタデータのみで会話ログではない）
- ユーザーが監視フォルダを手動設定できる UI を用意（WSL 対応のため）

---

## 感情状態マッピング

| 感情状態 | トリガー条件 | ポップアップ | ボイス |
|---|---|---|---|
| happy | `end_turn` + text あり | 表示 | 完了テキスト |
| relaxed | 確認要求（AskUserQuestion / 承認待ちツール） | 表示 | 確認テキスト |
| surprised | `Bash` auto-approve 実行 | 表示 | コマンド実行テキスト |
| sad | （現状未使用・将来拡張用） | — | — |

---

## 通知トリガー条件

`stop_reason` + ツール名で判定。`role: assistant` / `type: message` のエントリのみ対象。

| 条件 | 感情 | フレーズ例 | 備考 |
|---|---|---|---|
| `end_turn` + text あり | `happy` | 終わったよ！ | ターン完了（エラー含む） |
| `tool_use` + `AskUserQuestion` | `relaxed` | 確認してね | 明示的な質問 |
| `tool_use` + `Bash` + auto-approve 外 | `relaxed` | 確認してね | 承認待ちコマンド |
| `tool_use` + `Bash` + auto-approve 内 | `surprised` | コマンド実行！ | 自動承認コマンド |
| `tool_use` + `Edit`/`Write`/`MultiEdit`/`NotebookEdit` + auto-approve 外 | `relaxed` | 確認してね | ファイル編集承認待ち |
| `tool_use` + `mcp__*` + auto-approve 外 | `relaxed` | 確認してね | MCP ツール承認待ち |
| それ以外 | — | なし | 無視 |

**設計方針メモ**

- `end_turn` はエラーキーワードの有無に関わらず常に `happy`。エラーが未解決のまま `end_turn` になることは実運用上ほぼなく、キーワードによる誤判定（「エラーを修正しました」→ sad）の方が問題になるため。
- `sad` は現状未使用（将来の拡張用に感情定義は残している）。
- `Edit`/`Write` 等のファイル編集ツールは `permissions.allow` に `Edit(*)` 等が入っていれば auto-approve 判定になり通知しない。"Allow once" での承認は settings.json に書かれないため毎回通知するが、これは正しい動作（ユーザーは毎回承認を求められているため）。
- 許可リスト方式: `APPROVAL_REQUIRED_TOOLS`（Edit/Write/MultiEdit/NotebookEdit）と `mcp__` プレフィックス以外のツールはすべて無視。Read / Glob / Grep / WebSearch / ToolSearch / Agent 等は対象外。

**auto-approve の判定**: `~/.claude/settings.json` の `permissions.allow` 配列を chokidar でリアルタイム監視。`Bash(*)` や `Bash(git *)` 等のパターンマッチも対応。実装: `electron/services/claudeSettingsMonitor.ts`

---

## 通知バッファリング仕様

- **連続発火検知**: 同一感情の通知が 30 秒以内に再発火した場合、ポップアップは表示するが発話はスキップする（`CONSECUTIVE_WINDOW_MS = 30_000`、`src/hooks/useNotificationPopup.ts`）
- **キュー**: ポップアップ表示中に新規通知が来た場合、後着 1 件のみ保持（上書き）
- **自動 dismiss**: 音声が鳴らなかった場合（エンジン未起動等）も 8 秒後に自動で引っ込む

---

## 技術スタック

| 技術 | 用途 |
|---|---|
| Electron | デスクトップアプリ化 |
| React + TypeScript | UI |
| chokidar | ログファイル監視（WSL はポーリングモード） |
| AivisSpeech / VOICEVOX | 音声合成（外部プロセス） |
| IndexedDB | 画像ファイル永続化 |

Three.js / VRM は廃止（通知特化のためリップシンク・3D表示不要）。

---

## cc-mascot からの差分（追加・変更点）

| 機能 | cc-mascot | 本プロジェクト |
|---|---|---|
| 通知スタイル | 常駐して全発言を読み上げ | 作業完了・確認要求時のポップアップ通知 |
| アプリアイコン | cc-mascot オリジナル | LLMN 独自 SVG（`scripts/build-icons.mjs` で PNG/ICO/ICNS 生成） |
| キャラクター | VRM 3D モデル | PNG/JPG/GIF/SVG/WebP 画像 |
| キャラクターサイズ | 400〜1200px | 80〜400px（デフォルト 200px） |
| ポップアップ位置 | 画面端ドラッグ移動 | 8方向固定（設定で選択） |
| アニメーション | CSS transition（固定） | slide / pop / fade / static（選択式） |
| 方向設定 | なし | primary / secondary（コーナー位置用） |
| 監視フォルダ設定 UI | なし（固定パス） | あり（WSL 対応のため） |
| WSL 対応 | 非対応 | ポーリングモードで対応 |
| 通知トリガー | 全発言の感情分類 | stop_reason + tool名 による allowlist 方式 |
| 自動 dismiss | なし | 音声再生終了時 or 8 秒タイムアウト |
| Codex 対応 | なし | `~/.codex/sessions/**/*.jsonl` 監視・パーサー実装済み |
| セッション自動検出 | なし | 30 秒リスキャンで新セッションを自動切替（再起動不要） |

---

## フォーク・公開に関するライセンス対応

cc-mascot は **Apache License 2.0**。以下を守れば改変・再配布が可能。

1. 元の著作権表示を残す（`Copyright 2026 kazakago`）
2. `LICENSE` ファイルを同梱する
3. 変更したファイルに改変した旨を明示する
4. README に元プロジェクトへのリンクを記載する

---

## 将来の拡張候補

- WSL 完全対応（承認待ち通知）
  - 現状: `end_turn` のみ検知可能。`tool_use`（承認待ち）は WSL2 の 9P write-back キャッシュにより、Claude Code が JSONL に書き込んでも Windows 側には遅延してしか見えないため、承認後にしか検知できない（※JSONL 自体は承認ダイアログ表示の数秒前に書き込まれるが、9P キャッシュで Windows 側への伝搬が遅延する）
  - 検討案A: Linux 側に `inotifywait` 等でJSONL監視するヘルパーデーモンを置き、TCP で Windows 側 LLMN に通知する
  - 検討案B: Claude Code の `PreToolUse` / `Notification` フックを利用。LLMN セットアップ時に `~/.claude/settings.json` へ自動書き込みし、フック発火時に NTFS 上のトリガーファイルを書き込む → LLMN が NTFS 上ファイルを即時検知（9P キャッシュを完全バイパス）。ただし「Claude Code 側設定変更不要」の設計方針に反するため要検討。
- 他の LLM ツール対応（Gemini CLI など）
  - **Codex は実装済み**。ログパーサーをプロバイダーごとに差し替えられる設計が既に確立済み
  - Gemini CLI はログファイルを書き出す可能性が高く、対応候補筆頭。ログ形式の調査が必要。
  - GitHub Copilot / Cursor 等の IDE プラグイン型はログへのアクセス手段がなく対応困難
- Claude Code 以外のトリガー（ファイル監視、タスク完了など）
- 多言語化（UI・デフォルトフレーズの英語対応）。英語 TTS エンジン対応も含む大規模対応。
- ローカル音声ファイル再生（外部 TTS エンジン不要）
  - 実装時は `POPUP_SHOW_DELAY_MS`（現在 300ms）を音声ソースごとに切り替える必要あり
  - 外部 TTS エンジン：合成時間分のディレイが必要（約 300ms）
  - ローカルファイル：即再生できるためディレイは 0 に設定する
- ~~VOICEROID 対応~~ → **実装済み（2026-05-03）**
  - `helpers/voiceroid-bridge/Program.cs`（C# HTTP サーバー）+ `scripts/build-voiceroid-bridge.mjs` で対応済み
  - **Windows UI Automation** で動作中の VOICEROID2 エディターを操作（DLL 同梱不要・棒読みちゃん不要）
  - **棒読みちゃんがなぜ VOICEROID を制御できるか**: 棒読みちゃんの VOICEROID2 プラグイン（`Plugin_VoiceroidTalkPlus.dll`）は WM_COPYDATA でテキストを `VoiceroidTalkPlusReceiver.exe` に送り、同 exe が Windows UI Automation（`UIAutomationClient`）で VOICEROID2 の TextBox にテキストをセット・再生ボタンをクリックする仕組み。LLMN は同じ UI Automation アプローチを直接実装している
  - VOICEROID2 は自前のオーディオデバイスで再生。LLMN はサイレント WAV でポップアップ dismiss タイミングを管理
- A.I.VOICE 対応（未検証・A.I.VOICE 所持者による実装・テストが必要）
  - 公式 API ドキュメント: https://aivoice.jp/manual/editor/api.html
  - **VOICEROID2 との主な違い**:
    - VOICEROID2: UI Automation でエディターを操作、音声は VOICEROID2 自身が再生、LLMN はサイレント WAV でタイミング管理
    - A.I.VOICE: 公式 `AI.Talk.Editor.Api.dll` を Reflection で動的ロード、`SaveAudioToFile()` で実 WAV を生成して LLMN が再生（音量スライダーが効く）、`VoicePresetNames` でキャラ名取得可能
  - **実装方針**（`helpers/voiceroid-bridge/Program.cs` に A.I.VOICE ブランチを追加）:
    - DLL 検索パス: `C:\Program Files\AHS\AIVoice\AIVoiceEditor\AI.Talk.Editor.Api.dll` → `C:\Program Files (x86)\...` の順
    - `Assembly.LoadFrom(dllPath)` → `AI.Talk.Editor.Api.TtsControl` を Reflection で取得
    - 起動フロー: `GetAvailableHostNames()` → `Initialize(hosts[0])` → `Connect()` → テキスト・プリセット設定 → `Play()` または `SaveAudioToFile(tmpPath)` → WAV を返す → `Disconnect()`
    - `/synthesis` は実 WAV を返せるため、サイレント WAV の duration 推定が不要になる
    - `/speakers` は `VoicePresetNames` からキャラ名一覧を返せる（VOICEROID2 では不可だった）
  - **未確認事項**（ドキュメントからは判断できなかった箇所）:
    - テキストをセットするプロパティ名（`Text`? 別名?）
    - マスターコントロール・ボイスプリセットの JSON フォーマット詳細
    - エディター未起動時の `Initialize()` の挙動（例外? ステータスコード?）
- GitHub Pages ランディングページ（`docs/` フォルダ → `r2p2086.github.io/LLM-Notificator/`）
  - ダウンロードボタン（GitHub Releases API から最新 `.exe` を自動取得）
  - スクリーンショット・デモ動画
  - 利用規約・プライバシーポリシーページ
  - cc-mascot の `docs/` 構成（HTML + Tailwind CSS CDN + vanilla JS）が参考になる

---

## cc-mascot ソース調査結果（2026-04-20）

### 判明した重要事項

- **監視パス**: `~/.claude/projects/**/*.jsonl`（`sessions/` はセッションメタデータのみ）
- **stop_reason は JSONL に存在しない**: 作業完了・確認要求の区別はテキスト内容の感情分類で行う
- **感情分類**: ルールベース（6状態: neutral / happy / angry / sad / surprised / relaxed）。日本語キーワード辞書 + 文末パターン + ヒューリスティック
- **ボイス**: VOICEVOX REST API。AivisSpeech も同一形式なので `baseUrl` 切り替えで対応可能
- **マイク自動ミュート**: 独立バイナリ（mic-monitor.exe）+ IPC 通信。流用可能
- **Electron ウィンドウ**: `transparent: true` / `alwaysOnTop: true` / `ignoreMouseEvents` の動的切り替え

### 残作業チェックリスト
- [x] 感情状態マッピングを stop_reason + tool名 の allowlist 方式に変更
- [x] ポップアップ通知の実装（画像ベース、8方向 × 4アニメーション）
- [x] AivisSpeech のスピーカーID（888753760 = まお/ノーマル）確認済み
- [x] フォークリポジトリのアプリ名・appId を変更（cc-mascot → LLM-Notificator）
- [x] VRM / Three.js を廃止し画像ポップアップに置き換え
- [x] 音声未再生時の 8 秒自動 dismiss 実装

---

---

## Codex ログ調査結果（2026-04-27）

### ログファイルパス

```
~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<uuid>.jsonl
```

### イベント形式

各行は JSON オブジェクト。確認済みイベント一覧（`sandbox = elevated` モード）:

| `type` | `payload.type` | 説明 |
|---|---|---|
| `event_msg` | `task_started` | ターン開始 |
| `event_msg` | `task_complete` | ターン完了 ← **happy トリガー** |
| `event_msg` | `user_message` | ユーザー入力 |
| `event_msg` | `agent_message` | エージェント応答 |
| `event_msg` | `token_count` | トークン数 |
| `event_msg` | `exec_command_end` | コマンド実行完了 |
| `event_msg` | `patch_apply_end` | パッチ適用完了 |
| `event_msg` | `thread_name_updated` | スレッド名更新 |
| `response_item` | `function_call` | ツール呼び出し（引数に `sandbox_permissions` が入る場合あり） |

### 承認要求の検出

`response_item` + `function_call` のうち、`arguments` JSON に `sandbox_permissions === "require_escalated"` が含まれる行が承認待ちトリガー。

```json
{
  "type": "response_item",
  "payload": {
    "type": "function_call",
    "arguments": "{\"sandbox_permissions\":\"require_escalated\",\"justification\":\"...\",\"command\":\"...\"}"
  }
}
```

この行は **ユーザーが承認する前**（約 15 秒前）に書き込まれるため、承認ダイアログ表示中に通知できる。

### ポーリング必須の理由

Codex はデスクトップアプリとしてバックグラウンド動作するため、OS のファイル変更通知が適時に届かないケースがある。`usePolling: true, interval: 1000` により 1 秒間隔のポーリングで安定検出。

---

## 更新履歴

- 2026-04-20: 要件を精緻化。cc-mascotソース調査結果を反映（stop_reason非存在・監視パス修正・感情分類方針確定）
- 2026-04-21: Approach B 実装（stop_reason + tool名による直接検出）。Bash auto-approve判定、claudeSettingsMonitor追加。
- 2026-04-22: VRM/Three.js廃止・画像ポップアップ化。8方向×4アニメーション×direction設定。auto-dismiss 8秒タイムアウト。APPROVAL_REQUIRED_TOOLS allowlist方式に変更。
- 2026-04-23: permissions.ask対応（askリストのコマンドはrelaxed判定）。Bashコマンド文字列をJSONLから抽出してisToolAllowedに渡す実装。通知モード3択（両方/ポップアップのみ/発話のみ）追加。「キャラクターを隠す」トレイ項目を削除しトレイから通知モード選択可能に。Webhook通知機能追加（Slack・Discord・Teams未検証）、Webhook有効時はアプリ通知を抑制する排他設計。ボタン押下フィードバック（active:scale-95）追加。
- 2026-04-27: アプリアイコン刷新（LLMN 独自 SVG デザイン、`scripts/build-icons.mjs` で PNG/ICO/ICNS 生成）。OpenAI Codex 対応追加（`electron/parsers/codexParser.ts` + `electron/codexLogMonitor.ts`、`~/.codex/sessions/**/*.jsonl` をポーリング監視）。ログ監視共通基盤 `electron/logMonitorUtils.ts` 追加（DEBOUNCE_MS・RESCAN_INTERVAL_MS・BroadcastFn・initializeFilePosition・skipFileChanges・readNewLines・processFileChanges を共有）。Claude Code・Codex 両モニターに 30 秒リスキャンによるセッション自動検出を実装（LLMN 再起動不要）。設定パネルのドラッグ機能を固定配置に戻し。
- 2026-04-30: Codex IDE拡張動作確認（CLI・VSCode拡張とも同一JSONLを書き込むため追加対応不要）。Codexセッションリセット動作をClaudeCode方式（`resetActiveFile()`）に統一（モニター再起動なし）。監視タブをClaudeCode/Codexカード分割表示に再編・アクティブファイル表示追加・「自動検出中」テキスト統一。`.gitignore`でClaudeCode関連ファイル（`.claude/`・`CLAUDE.md`・`plugin/`）をpush除外。パッケージング（Windows `.exe` インストーラー）実施・動作確認。README更新（Codex対応・macOS未確認・WSL制限・マイクミュート削除）。WSL実機テスト：`end_turn` は検知可能だが `tool_use`（承認待ち）は9P write-backキャッシュにより承認後にしか検知できず、WSL環境での承認待ち通知は未対応と判定。
- 2026-05-02: 連続発火検知の挙動変更（30秒以内の再発火はポップアップは表示・発話はスキップ。従来は完全無視）。ポップアップ位置計算を `workArea` ベースに変更し、タスクバー（Windows）・Dock（macOS）の高さを自動考慮するよう修正（`electron/main.ts` の `get-screen-size`、`src/components/CharacterPopup.tsx` の `getPositionStyle` / `computePopupRect`）。
- 2026-05-04: 承認待ち通知の検知問題を調査・修正。`scripts/monitor-jsonl.ps1` を使った実機計測（Phase 1）で「JSONL flush タイミング問題」仮説を否定——`tool_use` エントリは承認ダイアログ表示の約 13 秒**前**に書き込まれており、JSONL 監視自体は承認前検知に十分なタイミングで機能していることを確認。実際の原因は設定の問題: (1) `Bash(powershell *)` / `Bash(powershell.exe *)` を `permissions.ask` に追加（`.claude/settings.json`）、(2) `claudeCodeParser.ts` に Read/Edit ツールのプロジェクト外ファイル通知を実装——`file_path` を `isToolAllowed` に渡し、許可外なら `relaxed` 通知、(3) `claudeSettingsMonitor.ts` の `isToolAllowed` にプロジェクトルート基準の in-project 判定を追加——プロジェクト内は常に許可・プロジェクト外は allow リストのパターンマッチのみで判定。README に「通知とパーミッション設定の関係」を追記。
- 2026-05-03: VOICEROID2 対応追加（`helpers/voiceroid-bridge/Program.cs` C# HTTP サーバー + `scripts/build-voiceroid-bridge.mjs` ビルドスクリプト）。**Windows UI Automation** で動作中の VoiceroidEditor.exe / GynoidTalkEditor.exe を直接操作（DLL 同梱不要・棒読みちゃん不要）。ClassName=`"TextBox"` 要素にテキストをセット → ClassName=`"Button"` を名前で探して再生ボタンをクリック。VOICEVOX 互換 API（GET /speakers・POST /audio_query・POST /synthesis）を port 8564 で提供。`/synthesis` はサイレント WAV（テキスト長から duration 推定）を返し LLMN のポップアップ dismiss タイミングを制御。VOICEROID2 は自前のオーディオデバイスで再生。`EngineType` に `"voiceroid2"` 追加（`electron/main.ts`・`src/global.d.ts`・`src/components/SettingsPanel.tsx`）。`package.json` に `build:voiceroid-bridge` スクリプト追加・`package` スクリプトに組み込み・`extraResources` に `voiceroid-bridge.exe` を追加。
- 2026-05-05: macOS（Apple Silicon）で実機動作確認。監視・通知は正常動作を確認。macOS トレイアイコンを `trayTemplate.png`（Electron がテンプレート画像として白く処理）→ `tray.png`（カラー）に修正。workArea 考慮コードを全面削除——`get-screen-size` IPC に `insets` を追加して Dock/タスクバー高さを避ける実装を試みたが、①Dock サイズ変更がリアルタイムに反映されない、②ポップアップは数秒で消えるので多少ずれても実害がない、という理由で廃止し `POPUP_MARGIN` 固定値のみに戻した。