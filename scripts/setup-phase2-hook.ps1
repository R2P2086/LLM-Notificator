# Phase 2 検証用: PreToolUse フックを ~/.claude/settings.json に追加するスクリプト
#
# 使い方:
#   # フック追加
#   .\scripts\setup-phase2-hook.ps1 -Action Add
#
#   # フック削除（検証後のクリーンアップ）
#   .\scripts\setup-phase2-hook.ps1 -Action Remove

param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("Add", "Remove")]
    [string]$Action
)

$settingsPath = "$env:USERPROFILE\.claude\settings.json"
$hookScriptPath = (Resolve-Path "$PSScriptRoot\test-hook.sh").Path -replace '\\', '/'
$logPath = "$env:USERPROFILE\llmn-hook-log.txt"

if (-not (Test-Path $settingsPath)) {
    Write-Error "settings.json が見つかりません: $settingsPath"
    exit 1
}

$settings = Get-Content $settingsPath -Raw | ConvertFrom-Json

# settings.json の hooks オブジェクトを確保
if (-not $settings.PSObject.Properties['hooks']) {
    $settings | Add-Member -MemberType NoteProperty -Name 'hooks' -Value ([PSCustomObject]@{})
}

if ($Action -eq "Add") {
    # PreToolUse フックエントリを作成
    $hookEntry = [PSCustomObject]@{
        matcher = ".*"  # 全ツール対象（Bash/Edit/Write 等）
        hooks   = @(
            [PSCustomObject]@{
                type    = "command"
                command = $hookScriptPath
                timeout = 5
            }
        )
    }

    if (-not $settings.hooks.PSObject.Properties['PreToolUse']) {
        $settings.hooks | Add-Member -MemberType NoteProperty -Name 'PreToolUse' -Value @($hookEntry)
    }
    else {
        # 既存エントリに追加（重複チェック）
        $existing = $settings.hooks.PreToolUse | Where-Object { $_.hooks[0].command -eq $hookScriptPath }
        if ($existing) {
            Write-Host "既に登録済みです: $hookScriptPath" -ForegroundColor Yellow
        }
        else {
            $settings.hooks.PreToolUse = @($settings.hooks.PreToolUse) + @($hookEntry)
        }
    }

    # ログファイルを初期化
    "" | Set-Content $logPath -Encoding UTF8
    Write-Host "ログファイルを初期化: $logPath" -ForegroundColor DarkGray

    Write-Host "PreToolUse フックを追加しました" -ForegroundColor Green
    Write-Host "フックスクリプト: $hookScriptPath" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "【Phase 2 テスト手順】" -ForegroundColor Yellow
    Write-Host "1. Claude Code で allow リストにないコマンドを実行させる"
    Write-Host "2. 承認ダイアログが表示された「瞬間」の時刻をメモ"
    Write-Host "3. 承認後、以下でログを確認:"
    Write-Host "   Get-Content '$logPath'" -ForegroundColor Cyan
    Write-Host "4. ログのタイムスタンプ < ダイアログ出現時刻 → フック方式は有効 ✅"
}
elseif ($Action -eq "Remove") {
    if (-not $settings.hooks.PSObject.Properties['PreToolUse']) {
        Write-Host "PreToolUse フックは登録されていません" -ForegroundColor Yellow
        exit 0
    }

    # test-hook.sh エントリのみ削除
    $filtered = $settings.hooks.PreToolUse | Where-Object { $_.hooks[0].command -ne $hookScriptPath }
    if ($filtered) {
        $settings.hooks.PreToolUse = $filtered
    }
    else {
        # エントリがなくなった場合はキーごと削除
        $settings.hooks.PSObject.Properties.Remove('PreToolUse')
    }

    Write-Host "PreToolUse フックを削除しました" -ForegroundColor Green
}

# settings.json に書き戻す（インデント付き）
$settings | ConvertTo-Json -Depth 10 | Set-Content $settingsPath -Encoding UTF8
Write-Host "設定を保存しました: $settingsPath" -ForegroundColor DarkGray
