---
name: speak-status
description: LLM Notificatorの現在の発話フィルタ状態を確認します
model: haiku
context: fork
---

# LLM Notificator: 発話フィルタ状態の確認

LLM Notificatorアプリの現在の発話フィルタ状態を確認し、報告します。

## 手順

1. active-sessionファイルの内容を確認する
2. 状態を報告する

OSに応じて以下のいずれかのBashコマンドを実行してください:

macOS:
```bash
cat "$HOME/Library/Application Support/LLM Notificator/active-session" 2>/dev/null
```

Windows:
```bash
cat "$APPDATA/LLM Notificator/active-session" 2>/dev/null
```

取得したセッションIDと、環境変数 `$LLM_NOTIFICATOR_SESSION_ID`（現在のセッションID）を比較し、結果に応じて以下のように報告してください:

- コマンドの出力が空（ファイルが存在しない、または空）の場合:「LLM Notificatorはすべてのセッションを発話対象としています。」
- 取得したセッションIDが `$LLM_NOTIFICATOR_SESSION_ID` と一致する場合:「LLM Notificatorはこのセッション (`<セッションID>`) のみを発話対象としています。」
- 取得したセッションIDが `$LLM_NOTIFICATOR_SESSION_ID` と異なる場合:「LLM Notificatorは別のセッション (`<セッションID>`) のみを発話対象としています。このセッションの発話は対象外です。」

報告時、作業内容について詳しく説明する必要はありません。
