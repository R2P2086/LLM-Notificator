---
name: speak-all
description: LLM Notificatorの発話をすべてのセッションに戻します
model: haiku
context: fork
---

# LLM Notificator: すべてのセッションを発話

LLM Notificatorアプリの発話フィルタを解除し、すべてのClaude Codeセッションの応答を発話対象に戻します。

## 手順

1. active-sessionファイルを削除する
2. 完了メッセージを表示する

OSに応じて以下のいずれかのBashコマンドを実行してください。
このコマンドはプロジェクト外のディレクトリにアクセスするため、sandboxが有効な場合は無効にして実行する必要があります:

macOS:
```bash
rm -f "$HOME/Library/Application Support/LLM Notificator/active-session"
```

Windows:
```bash
rm -f "$APPDATA/LLM Notificator/active-session"
```

処理が成功したら「LLM Notificatorの発話をすべてのセッションに戻しました。」と報告してください、作業内容について詳しく説明する必要はありません。
