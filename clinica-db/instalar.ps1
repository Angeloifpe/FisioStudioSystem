# =============================================================================
# Instala o PostgreSQL 16 (se ainda não tiver) e cria o banco "clinica"
#
# Uso: clique duas vezes em instalar.bat
#   ou: powershell -ExecutionPolicy Bypass -File instalar.ps1 [-Recriar]
#
#   -Recriar  apaga o banco "clinica" se ele já existir e cria de novo
# =============================================================================
param(
  [switch]$Recriar
)

$ErrorActionPreference = 'Stop'
$pasta = $PSScriptRoot

# Acentos certos na janela (as mensagens do PostgreSQL vêm em UTF-8)
chcp 65001 > $null
[Console]::OutputEncoding = [Text.Encoding]::UTF8

function Find-Psql {
  $cmd = Get-Command psql -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $achado = Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\psql.exe' -ErrorAction SilentlyContinue |
    Sort-Object { [int]($_.Directory.Parent.Name -replace '\D', '') } -Descending |
    Select-Object -First 1
  if ($achado) { return $achado.FullName }
  return $null
}

function Ler-Senha([string]$texto) {
  $seguro = Read-Host $texto -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Executar([string]$descricao, [scriptblock]$comando) {
  & $comando
  if ($LASTEXITCODE -ne 0) { throw "Falhou: $descricao (código $LASTEXITCODE)" }
}

Write-Host ''
Write-Host '=== Banco de dados da clínica ===' -ForegroundColor Cyan

# 1. Verifica se o PostgreSQL está instalado
$psql = Find-Psql
$senha = $null

if ($psql) {
  Write-Host "PostgreSQL já está instalado: $psql" -ForegroundColor Green
}
else {
  Write-Host 'PostgreSQL não encontrado. Vou instalar o PostgreSQL 16 com o winget.' -ForegroundColor Yellow
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw 'O winget não está disponível. Instale o PostgreSQL 16 em https://www.postgresql.org/download/windows/ e rode este script de novo.'
  }

  $senha = Ler-Senha 'Escolha uma senha para o usuário postgres (anote, você vai precisar dela)'
  if ([string]::IsNullOrWhiteSpace($senha)) { throw 'A senha não pode ficar vazia.' }

  Write-Host 'Instalando... (o Windows pode pedir permissão de administrador)'
  winget install --id PostgreSQL.PostgreSQL.16 -e `
    --accept-source-agreements --accept-package-agreements `
    --override "--mode unattended --unattendedmodeui minimal --superpassword `"$senha`" --serverport 5432"

  $psql = Find-Psql
  if (-not $psql) { throw 'A instalação terminou, mas o psql.exe não foi encontrado em C:\Program Files\PostgreSQL.' }
  Write-Host "PostgreSQL instalado: $psql" -ForegroundColor Green
}

$bin = Split-Path $psql
$createdb = Join-Path $bin 'createdb.exe'
$dropdb = Join-Path $bin 'dropdb.exe'

if (-not $senha) {
  $senha = Ler-Senha 'Senha do usuário postgres'
}

$env:PGPASSWORD = $senha
$env:PGCLIENTENCODING = 'UTF8'
$conexao = @('-U', 'postgres', '-h', 'localhost', '-p', '5432')

# 2. Confere a conexão
Write-Host 'Testando a conexão com o servidor...'
$versao = & $psql @conexao -d postgres -tAc 'SHOW server_version'
if ($LASTEXITCODE -ne 0) {
  throw 'Não consegui conectar. Confira se o serviço do PostgreSQL está rodando (services.msc) e se a senha está certa.'
}
Write-Host "Conectado ao PostgreSQL $versao" -ForegroundColor Green

# Aplica as atualizações do banco que ainda não foram aplicadas
function Aplicar-Atualizacoes {
  $temRemarcacao = & $psql @conexao -d clinica -tAc "SELECT 1 FROM information_schema.columns WHERE table_name = 'agendamentos' AND column_name = 'remarcado_de'"
  if ($temRemarcacao -ne '1') {
    Write-Host 'Aplicando atualização 003_ajustes_cliente.sql (ajustes da cliente na agenda)...'
    Executar 'atualização 003' { & $psql @conexao -d clinica -P pager=off -v ON_ERROR_STOP=1 -q -f (Join-Path $pasta '003_ajustes_cliente.sql') }
  }
  else {
    Write-Host 'Atualização 003 já aplicada.'
  }

  $temNotificacoes = & $psql @conexao -d clinica -tAc "SELECT 1 FROM information_schema.tables WHERE table_name = 'notificacoes'"
  if ($temNotificacoes -ne '1') {
    Write-Host 'Aplicando atualização 004_notificacoes.sql (confirmação de presença e notificações)...'
    Executar 'atualização 004' { & $psql @conexao -d clinica -P pager=off -v ON_ERROR_STOP=1 -q -f (Join-Path $pasta '004_notificacoes.sql') }
  }
  else {
    Write-Host 'Atualização 004 já aplicada.'
  }

  $temLote = & $psql @conexao -d clinica -tAc "SELECT 1 FROM pg_proc WHERE proname = 'fn_cancelar_horarios'"
  if ($temLote -ne '1') {
    Write-Host 'Aplicando atualização 005_cancelamento_em_lote.sql (cancelar dia ou horários e liberar remarcação)...'
    Executar 'atualização 005' { & $psql @conexao -d clinica -P pager=off -v ON_ERROR_STOP=1 -q -f (Join-Path $pasta '005_cancelamento_em_lote.sql') }
  }
  else {
    Write-Host 'Atualização 005 já aplicada.'
  }

  $temFixos = & $psql @conexao -d clinica -tAc "SELECT 1 FROM information_schema.tables WHERE table_name = 'pilates_fixos'"
  if ($temFixos -ne '1') {
    Write-Host 'Aplicando atualização 006_pilates_semanal.sql (pilates 2x por semana, horário fixo, segunda a sexta)...'
    Executar 'atualização 006' { & $psql @conexao -d clinica -P pager=off -v ON_ERROR_STOP=1 -q -f (Join-Path $pasta '006_pilates_semanal.sql') }
  }
  else {
    Write-Host 'Atualização 006 já aplicada.'
  }

  $temFeriados = & $psql @conexao -d clinica -tAc "SELECT 1 FROM information_schema.tables WHERE table_name = 'feriados'"
  if ($temFeriados -ne '1') {
    Write-Host 'Aplicando atualização 007_feriados.sql (feriados nacionais e de Pernambuco, sem atendimento no fim de semana)...'
    Executar 'atualização 007' { & $psql @conexao -d clinica -P pager=off -v ON_ERROR_STOP=1 -q -f (Join-Path $pasta '007_feriados.sql') }
  }
  else {
    Write-Host 'Atualização 007 já aplicada.'
  }

  $temSenhaTemp = & $psql @conexao -d clinica -tAc "SELECT 1 FROM information_schema.columns WHERE table_name = 'usuarios' AND column_name = 'senha_temporaria_expira_em'"
  if ($temSenhaTemp -ne '1') {
    Write-Host 'Aplicando atualização 008_senha_temporaria.sql (troca de senha e senha temporária)...'
    Executar 'atualização 008' { & $psql @conexao -d clinica -P pager=off -v ON_ERROR_STOP=1 -q -f (Join-Path $pasta '008_senha_temporaria.sql') }
  }
  else {
    Write-Host 'Atualização 008 já aplicada.'
  }

  $temFuncionamento = & $psql @conexao -d clinica -tAc "SELECT 1 FROM information_schema.tables WHERE table_name = 'funcionamento'"
  if ($temFuncionamento -ne '1') {
    Write-Host 'Aplicando atualização 009_funcionamento_e_experimental_paga.sql (horário de funcionamento e aula experimental paga)...'
    Executar 'atualização 009' { & $psql @conexao -d clinica -P pager=off -v ON_ERROR_STOP=1 -q -f (Join-Path $pasta '009_funcionamento_e_experimental_paga.sql') }
  }
  else {
    Write-Host 'Atualização 009 já aplicada.'
  }

  $temGrade = & $psql @conexao -d clinica -tAc "SELECT 1 FROM information_schema.tables WHERE table_name = 'pilates_grade'"
  if ($temGrade -ne '1') {
    Write-Host 'Aplicando atualização 010_grade_pilates_e_duracao_fisio.sql (grade de pilates e duração da fisioterapia)...'
    Executar 'atualização 010' { & $psql @conexao -d clinica -P pager=off -v ON_ERROR_STOP=1 -q -f (Join-Path $pasta '010_grade_pilates_e_duracao_fisio.sql') }
  }
  else {
    Write-Host 'Atualização 010 já aplicada.'
  }

  $temPadrao30 = & $psql @conexao -d clinica -tAc "SELECT 1 FROM information_schema.columns WHERE table_name = 'pacientes' AND column_name = 'duracao_fisioterapia_min' AND column_default = '30'"
  if ($temPadrao30 -ne '1') {
    Write-Host 'Aplicando atualização 011_duracao_fisio_padrao_30.sql (sessão de fisioterapia padrão de 30 min)...'
    Executar 'atualização 011' { & $psql @conexao -d clinica -P pager=off -v ON_ERROR_STOP=1 -q -f (Join-Path $pasta '011_duracao_fisio_padrao_30.sql') }
  }
  else {
    Write-Host 'Atualização 011 já aplicada.'
  }

  $temConfig = & $psql @conexao -d clinica -tAc "SELECT 1 FROM information_schema.tables WHERE table_name = 'config_clinica'"
  if ($temConfig -ne '1') {
    Write-Host 'Aplicando atualização 012_capacidade_e_aviso_de_falta.sql (capacidade das turmas e aviso de falta no pilates)...'
    Executar 'atualização 012' { & $psql @conexao -d clinica -P pager=off -v ON_ERROR_STOP=1 -q -f (Join-Path $pasta '012_capacidade_e_aviso_de_falta.sql') }
  }
  else {
    Write-Host 'Atualização 012 já aplicada.'
  }

  $temAvisoQualquerHora = & $psql @conexao -d clinica -tAc "SELECT 1 FROM pg_proc WHERE proname = 'fn_avisar_falta_pilates' AND prosrc LIKE '%já terminou%'"
  if ($temAvisoQualquerHora -ne '1') {
    Write-Host 'Aplicando atualização 013_cancelar_a_qualquer_hora.sql (aviso de falta a qualquer hora)...'
    Executar 'atualização 013' { & $psql @conexao -d clinica -P pager=off -v ON_ERROR_STOP=1 -q -f (Join-Path $pasta '013_cancelar_a_qualquer_hora.sql') }
  }
  else {
    Write-Host 'Atualização 013 já aplicada.'
  }

  $temLiberacao = & $psql @conexao -d clinica -tAc "SELECT 1 FROM information_schema.columns WHERE table_name = 'pacientes' AND column_name = 'liberado_pilates'"
  if ($temLiberacao -ne '1') {
    Write-Host 'Aplicando atualização 014_avaliacao_por_modalidade.sql (avaliação de pilates, de fisioterapia ou das duas)...'
    Executar 'atualização 014' { & $psql @conexao -d clinica -P pager=off -v ON_ERROR_STOP=1 -q -f (Join-Path $pasta '014_avaliacao_por_modalidade.sql') }
  }
  else {
    Write-Host 'Atualização 014 já aplicada.'
  }

  $temAvaliacoesSeparadas = & $psql @conexao -d clinica -tAc "SELECT 1 FROM pg_proc WHERE proname = 'fn_valida_agendamento' AND prosrc LIKE '%avaliação pendente de %'"
  if ($temAvaliacoesSeparadas -ne '1') {
    Write-Host 'Aplicando atualização 015_avaliacoes_separadas.sql (uma avaliação por modalidade)...'
    Executar 'atualização 015' { & $psql @conexao -d clinica -P pager=off -v ON_ERROR_STOP=1 -q -f (Join-Path $pasta '015_avaliacoes_separadas.sql') }
  }
  else {
    Write-Host 'Atualização 015 já aplicada.'
  }

  $temFixoSubstitui = & $psql @conexao -d clinica -tAc "SELECT 1 FROM pg_proc WHERE proname = 'fn_cancelar_avulsas_pilates'"
  if ($temFixoSubstitui -ne '1') {
    Write-Host 'Aplicando atualização 016_fixo_substitui_avulsas.sql (horário fixo substitui as aulas avulsas)...'
    Executar 'atualização 016' { & $psql @conexao -d clinica -P pager=off -v ON_ERROR_STOP=1 -q -f (Join-Path $pasta '016_fixo_substitui_avulsas.sql') }
  }
  else {
    Write-Host 'Atualização 016 já aplicada.'
  }

  $temFeriadoSemRemarcacao = & $psql @conexao -d clinica -tAc "SELECT 1 FROM pg_proc WHERE proname = 'fn_fechar_dia' AND prosrc LIKE '%sem liberar remarcação%'"
  if ($temFeriadoSemRemarcacao -ne '1') {
    Write-Host 'Aplicando atualização 017_feriado_sem_remarcacao.sql (feriado não dá remarcação)...'
    Executar 'atualização 017' { & $psql @conexao -d clinica -P pager=off -v ON_ERROR_STOP=1 -q -f (Join-Path $pasta '017_feriado_sem_remarcacao.sql') }
  }
  else {
    Write-Host 'Atualização 017 já aplicada.'
  }

  $temReposicaoNoPrazo = & $psql @conexao -d clinica -tAc "SELECT 1 FROM pg_proc WHERE proname = 'fn_avisar_falta_pilates' AND prosrc LIKE '%a reposição é gasta%'"
  if ($temReposicaoNoPrazo -ne '1') {
    Write-Host 'Aplicando atualização 018_reposicao_cancelada_no_prazo.sql (cancelar a reposição também segue os 30 minutos)...'
    Executar 'atualização 018' { & $psql @conexao -d clinica -P pager=off -v ON_ERROR_STOP=1 -q -f (Join-Path $pasta '018_reposicao_cancelada_no_prazo.sql') }
  }
  else {
    Write-Host 'Atualização 018 já aplicada.'
  }

  $temNovaAvaliacao = & $psql @conexao -d clinica -tAc "SELECT 1 FROM information_schema.columns WHERE table_name = 'pacientes' AND column_name = 'nova_avaliacao_bloqueada'"
  if ($temNovaAvaliacao -ne '1') {
    Write-Host 'Aplicando atualização 019_nova_avaliacao_liberada_pela_clinica.sql (nova avaliação só com liberação da clínica)...'
    Executar 'atualização 019' { & $psql @conexao -d clinica -P pager=off -v ON_ERROR_STOP=1 -q -f (Join-Path $pasta '019_nova_avaliacao_liberada_pela_clinica.sql') }
  }
  else {
    Write-Host 'Atualização 019 já aplicada.'
  }
}

# 3. Cria o banco
$existe = & $psql @conexao -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = 'clinica'"
if ($existe -eq '1') {
  if ($Recriar) {
    Write-Host "Apagando o banco 'clinica' para recriar..." -ForegroundColor Yellow
    Executar 'apagar o banco' { & $dropdb @conexao clinica }
  }
  else {
    Write-Host "O banco 'clinica' já existe. Para recriá-lo do zero, rode: powershell -ExecutionPolicy Bypass -File instalar.ps1 -Recriar" -ForegroundColor Yellow
    Aplicar-Atualizacoes
    Write-Host 'Rodando os testes no banco existente...'
    Executar 'testes' { & $psql @conexao -d clinica -P pager=off -v ON_ERROR_STOP=1 -q -f (Join-Path $pasta '002_testes.sql') }
    Write-Host 'Pronto.' -ForegroundColor Green
    exit 0
  }
}

Write-Host "Criando o banco 'clinica'..."
Executar 'criar o banco' { & $createdb @conexao -E UTF8 -T template0 clinica }

# 4. Cria as tabelas, views, gatilhos e funções
Write-Host 'Criando a estrutura (001_schema.sql)...'
Executar 'criar a estrutura' { & $psql @conexao -d clinica -P pager=off -v ON_ERROR_STOP=1 -q -f (Join-Path $pasta '001_schema.sql') }

# 5. Atualizações posteriores (003, ...)
Aplicar-Atualizacoes

# 6. Testa as regras de negócio
Write-Host 'Testando as regras de negócio (002_testes.sql)...'
Executar 'testes' { & $psql @conexao -d clinica -P pager=off -v ON_ERROR_STOP=1 -q -f (Join-Path $pasta '002_testes.sql') }

Write-Host ''
Write-Host "Pronto! Banco 'clinica' rodando em localhost:5432 (usuário postgres)." -ForegroundColor Green
Write-Host 'String de conexão para o backend:'
Write-Host '  postgresql://postgres:<sua-senha>@localhost:5432/clinica'
