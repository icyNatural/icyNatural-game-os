Set-Content -Path (Join-Path $ProjectRoot "bootstrap.ps1") -Value $MyInvocation.MyCommand.ScriptBlock.ToString() -Encoding UTF8
