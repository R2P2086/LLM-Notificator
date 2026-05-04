# JSONL書き込みタイミング計測スクリプト
# 使い方: .\scripts\monitor-jsonl.ps1 -Path "C:\Users\r2uni\.claude\projects\...\*.jsonl"

param(
    [Parameter(Mandatory = $true)]
    [string]$Path
)

if (-not (Test-Path $Path)) {
    Write-Error "File not found: $Path"
    exit 1
}

Write-Host "Watching: $Path" -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop" -ForegroundColor DarkGray
Write-Host ""

$lastLineCount = @(Get-Content $Path -Encoding UTF8).Count

while ($true) {
    Start-Sleep -Milliseconds 200

    $lines = Get-Content $Path -Encoding UTF8 -ErrorAction SilentlyContinue
    if (-not $lines) { continue }

    $currentCount = $lines.Count
    if ($currentCount -le $lastLineCount) { continue }

    $newLines = $lines[$lastLineCount..($currentCount - 1)]
    $lastLineCount = $currentCount

    foreach ($line in $newLines) {
        $line = $line.Trim()
        if (-not $line) { continue }

        $ts = Get-Date -Format "HH:mm:ss.fff"

        try {
            $parsed = $line | ConvertFrom-Json -ErrorAction Stop
            $msg = $parsed.message
            $stopReason = $null

            if ($msg) {
                $stopReason = $msg.stop_reason
            }
            if (-not $stopReason) {
                $stopReason = $parsed.type
            }

            if ($stopReason -eq "tool_use") {
                $extra = ""
                if ($msg -and $msg.content) {
                    foreach ($item in $msg.content) {
                        if ($item.type -eq "tool_use") {
                            $extra = "  tool=$($item.name)"
                            if ($item.input -and $item.input.command) {
                                $cmd = "$($item.input.command)"
                                $cmd = $cmd -replace "`r`n", " " -replace "`n", " "
                                if ($cmd.Length -gt 60) { $cmd = $cmd.Substring(0, 60) + "..." }
                                $extra += "  cmd=$cmd"
                            }
                            break
                        }
                    }
                }
                Write-Host "[$ts] tool_use$extra" -ForegroundColor Yellow
            }
            elseif ($stopReason -eq "end_turn") {
                Write-Host "[$ts] end_turn" -ForegroundColor Green
            }
            elseif ($stopReason) {
                Write-Host "[$ts] $stopReason" -ForegroundColor White
            }
            else {
                $role = if ($msg) { $msg.role } else { "?" }
                Write-Host "[$ts] role=$role" -ForegroundColor DarkGray
            }
        }
        catch {
            Write-Host "[$ts] [parse error]" -ForegroundColor DarkRed
        }
    }
}
