# FisioStudioSystem

Sistema de gestão digital para uma clínica de **Fisioterapia e Pilates**. O paciente se cadastra, descreve a queixa, agenda avaliação, aulas e sessões, remarca ou cancela; a clínica acompanha tudo pelo painel (atendimentos do dia, agenda semanal, pedidos, pacientes e evolução).

## Resumo do projeto

**Paciente**
- Cadastro, queixa principal e agendamento da avaliação (fisioterapia ou pilates).
- Aula experimental, sessões de fisioterapia e turmas de pilates (horário fixo ou avulso).
- Remarcação e cancelamento (regra de 24 horas), reposição de aulas e histórico.
- Notificações dentro do sistema.

**Clínica (administradora)**
- Painel com os cards do dia (cancelamentos, remarcações, etc.) e a tabela "Atendimentos de hoje" por horário.
- Agenda semanal em tabela, abertura e bloqueio de horários, feriados.
- Presença e falta, registro de atendimento, evolução do paciente.
- Pedidos de cancelamento, pacientes (histórico, alta, reabertura) e notificações.

## Estrutura do repositório

```
FisioStudioSystem/
├── clinica-front/   Front-end (React)
├── clinica-api/     API (Node.js + Express + TypeScript)
└── clinica-db/      Scripts SQL e instalador do banco (PostgreSQL)
```

| Pasta | O que é | Detalhes |
|---|---|---|
| `clinica-front` | Telas do sistema, divididas em módulos (`src/paginas`, `src/componentes`, `src/servicos`, `src/estilos`) | [clinica-front/README.md](clinica-front/README.md) |
| `clinica-api` | Regras de negócio e rotas REST, login com JWT | [clinica-api/README.md](clinica-api/README.md) |
| `clinica-db` | Banco `clinica`: `001_schema.sql` e as atualizações `002` a `021` | [clinica-db/README.md](clinica-db/README.md) |

## Tecnologias

- **Front-end:** React 19, JavaScript (JSX), CSS puro, esbuild (empacotador), rotas por hash (`#/admin/...`, `#/paciente/...`).
- **Back-end:** Node.js, Express 5, TypeScript, `pg` (driver PostgreSQL), `zod` (validação), `jsonwebtoken` e `bcryptjs` (login e senhas), `cors`, `dotenv`.
- **Banco de dados:** PostgreSQL.
- **Ferramentas:** npm, `tsx` (executa TypeScript em desenvolvimento), scripts `.bat`/`.ps1` para instalar e iniciar no Windows.

## Como rodar (Windows)

### Requisitos
- [Node.js](https://nodejs.org) 20 ou mais novo (o `iniciar.bat` oferece instalar se faltar).
- [PostgreSQL](https://www.postgresql.org/download/) (o `instalar.bat` do banco também ajuda a instalar).

### Passo a passo

1. **Baixe o projeto**
   ```
   git clone https://github.com/Angeloifpe/FisioStudioSystem.git
   cd FisioStudioSystem
   git checkout feature/front-integrado-com-back
   ```

2. **Crie o banco de dados.** Dê dois cliques em `clinica-db\instalar.bat`, informe a senha do usuário `postgres` quando pedir e aguarde. Ele cria o banco `clinica` e aplica todas as atualizações.
   - Já tem o banco e só atualizou o projeto? Rode `clinica-db\atualizar-banco.bat` para aplicar apenas as atualizações novas, sem recriar o banco.

3. **Inicie a API.** Dê dois cliques em `clinica-api\iniciar.bat`. Na primeira vez ele:
   - pede a senha do PostgreSQL e cria o arquivo `.env` (modelo em `clinica-api/.env.example`);
   - roda `npm install`;
   - pede o e-mail e a senha do login da clínica (administradora).

   Confira em **http://localhost:3333/saude**: deve aparecer `"banco": "ok"`.

4. **Abra o sistema** em **http://localhost:3333/teste/app/**.
   A API já entrega o front pronto (pasta `clinica-front/dist`), então **não é preciso** rodar nada no front para só usar o sistema.

5. **(Opcional) Dados de demonstração.** Dê dois cliques em `clinica-api\dados-demo.bat` para criar pacientes e horários de exemplo (logins `*@demo.clinica`, senha `demo123`). Para remover, use `limpar-dados-demo.bat`.

### Rodando manualmente (sem os .bat)

```bash
# banco: aplique os arquivos de clinica-db em ordem (001 a 021) com o psql

# API
cd clinica-api
cp .env.example .env        # edite DATABASE_URL e JWT_SECRET
npm install
npm run criar-admin -- email@clinica.com suasenha
npm run dev                 # http://localhost:3333

# Front (só se for alterar as telas)
cd clinica-front
npm install
npm run build               # gera clinica-front/dist, servido pela API
npm run dev                 # alternativa: http://localhost:5173 com recarga automática
```

### Variáveis de ambiente (`clinica-api/.env`)

| Variável | Para que serve |
|---|---|
| `DATABASE_URL` | Conexão com o PostgreSQL |
| `PORT` | Porta da API (padrão `3333`) |
| `JWT_SECRET` | Chave que assina os tokens de login (use um texto longo e aleatório) |
| `JWT_EXPIRES_IN` | Validade do login (padrão `7d`) |
| `TIMEZONE` | Fuso dos "atendimentos do dia" (padrão `America/Sao_Paulo`) |

O arquivo `.env` não é enviado ao repositório.

## Fluxo de trabalho (Git Flow)

- `main`: versão estável.
- `develop`: integração das novidades.
- `feature/*`: uma branch por funcionalidade, aberta a partir de `develop` e mesclada de volta por Pull Request.

Esta entrega está na branch `feature/front-integrado-com-back`.
