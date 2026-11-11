# =============================================================================
# Redefine a senha do usuário "postgres" de um PostgreSQL já instalado.
# Precisa de administrador (o script pede sozinho).
#
# O que ele faz:
#   1. acha o serviço do PostgreSQL e a pasta de dados;
#   2. libera temporariamente o acesso local sem senha (pg_hba.conf);
#   3. define a nova senha;
#   4. devolve o pg_hba.conf original e reinicia o serviço.
# =============================================================================

$ErrorActionPreference = 'Stop'

# Reabre como administrador, se necessário
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
  Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  exit
}

function Pausar { Write-Host ''; Read-Host 'Pressione Enter para fechar' | Out-Null }

try {
  Write-Host ''
  Write-Host '=== Redefinir a senha do PostgreSQL ===' -ForegroundColor Cyan

  # 1. Serviço e pasta de dados
  $servicos = @(Get-CimInstance Win32_Service | Where-Object { $_.Name -like 'postgresql*' })
  if ($servicos.Count -eq 0) {
    throw 'Não encontrei nenhum serviço do PostgreSQL. Ele pode ter só o cliente (psql) instalado, sem o servidor. Nesse caso, desinstale e rode o instalar.bat de novo.'
  }

  $servico = $servicos | Sort-Object Name -Descending | Select-Object -First 1
  Write-Host "Serviço encontrado: $($servico.Name) ($($servico.State))"

  if ($servico.PathName -notmatch '-D\s+"?([^"]+?)"?(\s+-|\s*$)') {
    throw "Não consegui ler a pasta de dados do serviço: $($servico.PathName)"
  }
  $dados = $Matches[1].Trim()
  $hba = Join-Path $dados 'pg_hba.conf'

  if ($servico.PathName -notmatch '^"?(.+?\\bin)\\pg_ctl\.exe') {
    throw "Não consegui ler a pasta do PostgreSQL: $($servico.PathName)"
  }
  $psql = Join-Path $Matches[1] 'psql.exe'

  if (-not (Test-Path $hba))  { throw "Arquivo não encontrado: $hba" }
  if (-not (Test-Path $psql)) { throw "Arquivo não encontrado: $psql" }

  Write-Host "Pasta de dados: $dados"

  # Porta configurada (padrão 5432)
  $porta = '5432'
  $conf = Join-Path $dados 'postgresql.conf'
  if (Test-Path $conf) {
    $linha = Select-String -Path $conf -Pattern '^\s*port\s*=\s*(\d+)' | Select-Object -First 1
    if ($linha) { $porta = $linha.Matches[0].Groups[1].Value }
  }
  Write-Host "Porta: $porta"

  # 2. Nova senha
  $s1 = Read-Host 'Digite a NOVA senha do usuário postgres' -AsSecureString
  $s2 = Read-Host 'Repita a nova senha' -AsSecureString
  $p1 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s1))
  $p2 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s2))
  if ([string]::IsNullOrWhiteSpace($p1)) { throw 'A senha não pode ficar vazia.' }
  if ($p1 -ne $p2) { throw 'As senhas não conferem.' }

  # 3. Libera acesso local sem senha, temporariamente
  $original = [IO.File]::ReadAllText($hba)
  $backup = "$hba.backup-" + (Get-Date -Format 'yyyyMMdd-HHmmss')
  Copy-Item $hba $backup
  Write-Host "Cópia do pg_hba.conf salva em: $backup"

  $temporario = "host all all 127.0.0.1/32 trust`r`nhost all all ::1/128 trust`r`n" + $original
  $utf8 = New-Object Text.UTF8Encoding $false

  try {
    [IO.File]::WriteAllText($hba, $temporario, $utf8)
    Write-Host 'Reiniciando o serviço...'
    Restart-Service -Name $servico.Name -Force
    Start-Sleep -Seconds 3

    $sqlSenha = $p1.Replace("'", "''")
    $env:PGCLIENTENCODING = 'UTF8'
    & $psql -U postgres -h 127.0.0.1 -p $porta -d postgres -v ON_ERROR_STOP=1 -c "ALTER USER postgres WITH PASSWORD '$sqlSenha';"
    if ($LASTEXITCODE -ne 0) { throw 'Não consegui alterar a senha.' }
    Write-Host 'Senha alterada.' -ForegroundColor Green
  }
  finally {
    # 4. Devolve a configuração original
    [IO.File]::WriteAllText($hba, $original, $utf8)
    Write-Host 'Configuração original restaurada. Reiniciando o serviço...'
    Restart-Service -Name $servico.Name -Force
  }

  Write-Host ''
  Write-Host 'Pronto! Agora rode o instalar.bat de novo e use a senha nova.' -ForegroundColor Green
  if ($porta -ne '5432') {
    Write-Host "Atenção: este PostgreSQL usa a porta $porta, não a 5432. Me avise para eu ajustar o instalador." -ForegroundColor Yellow
  }
}
catch {
  Write-Host ''
  Write-Host "Erro: $($_.Exception.Message)" -ForegroundColor Red
}

Pausar
