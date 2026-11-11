# =============================================================================
# Prepara e inicia a API da clínica no Windows
#   - confere o Node.js (instala pelo winget se faltar)
#   - na primeira vez, cria o arquivo .env e a conta da cliente
#   - instala as dependências e sobe a API em http://localhost:3333
# =============================================================================
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Ler-Senha([string]$texto) {
  $seguro = Read-Host $texto -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

try {
  Write-Host ''
  Write-Host '=== API da clínica ===' -ForegroundColor Cyan

  # 1. Node.js
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host 'Node.js não encontrado. Instalando o Node.js LTS pelo winget...' -ForegroundColor Yellow
    winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
      throw 'Node.js instalado, mas ainda não aparece neste terminal. Feche esta janela e abra o iniciar.bat de novo.'
    }
  }
  Write-Host "Node.js $(node -v)" -ForegroundColor Green

  # 2. Arquivo .env (só na primeira vez)
  $primeiraVez = -not (Test-Path '.env')
  if ($primeiraVez) {
    Write-Host 'Primeira execução: vou criar o arquivo .env.' -ForegroundColor Yellow
    $senhaBanco = Ler-Senha 'Senha do usuário postgres (a mesma do instalar.bat)'
    $senhaUrl = [Uri]::EscapeDataString($senhaBanco)
    $bytes = New-Object byte[] 48
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $segredo = [Convert]::ToBase64String($bytes)

    $conteudo = @"
DATABASE_URL=postgresql://postgres:$senhaUrl@localhost:5432/clinica
PORT=3333
JWT_SECRET=$segredo
JWT_EXPIRES_IN=7d
TIMEZONE=America/Sao_Paulo
"@
    [IO.File]::WriteAllText((Join-Path $PSScriptRoot '.env'), $conteudo, (New-Object Text.UTF8Encoding $false))
    Write-Host 'Arquivo .env criado.' -ForegroundColor Green
  }

  # 3. Dependências
  if (-not (Test-Path 'node_modules')) {
    Write-Host 'Instalando dependências (npm install)...'
    npm install
    if ($LASTEXITCODE -ne 0) { throw 'Falhou o npm install.' }
  }

  # 4. Conta da cliente (só na primeira vez)
  if ($primeiraVez) {
    Write-Host ''
    Write-Host 'Agora vamos criar o login da cliente (administradora da clínica).' -ForegroundColor Yellow
    $email = Read-Host 'E-mail da cliente'
    $senhaAdmin = Ler-Senha 'Senha da cliente (mínimo 6 caracteres)'
    npm run criar-admin -- $email $senhaAdmin
    if ($LASTEXITCODE -ne 0) { throw 'Não consegui criar a conta da cliente. Confira se o banco está rodando e a senha do postgres no arquivo .env.' }
  }

  # 5. Sobe a API
  Write-Host ''
  Write-Host 'Iniciando a API (para parar, feche esta janela ou aperte Ctrl+C)...' -ForegroundColor Cyan
  Write-Host 'Teste no navegador: http://localhost:3333/saude'
  npm run dev
}
catch {
  Write-Host ''
  Write-Host "Erro: $($_.Exception.Message)" -ForegroundColor Red
  Read-Host 'Pressione Enter para fechar' | Out-Null
}
