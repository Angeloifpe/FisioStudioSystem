# clinica-front

Front-end (React) da clínica de fisioterapia e pilates. Fica **separado** da API (`clinica-api`) e do banco (`clinica-db`):
é um projeto próprio, com `package.json` e código-fonte em `src/`.

```
FisioStudioSystem/
├── clinica-api/    API (Node + Express + PostgreSQL)
├── clinica-db/     Scripts do banco
└── clinica-front/  ESTE projeto (React)
```

## Como rodar

**Uso normal (a API serve o front):**

1. `cd clinica-front` e rode `npm install` (só na primeira vez).
2. `npm run build` gera a pasta `dist/` (já vem uma pronta neste pacote).
3. Inicie a API como de costume (`clinica-api/iniciar.bat`) e abra **http://localhost:3333/teste/app/**.
   A API entrega o conteúdo de `clinica-front/dist` nesse endereço.

**Para desenvolver (recompila ao salvar):**

```
npm run dev
```

Abre em **http://localhost:5173**. A API precisa estar rodando em `http://localhost:3333`.
Para apontar para outra API, edite `public/js/config.js` (`window.FISIO_API_URL`).

## Estrutura de `src/`

```
src/
├── main.jsx                  entrada: importa os estilos e monta o <App />
├── App.jsx                   rotas (#/...), sessão, tela de carregamento
├── servicos/api.js           cliente HTTP (GET/POST/PATCH/PUT/DEL), token e endereço da API
├── utils/
│   ├── datas.js              funções de data (semana, formatação pt-BR, ...)
│   ├── formatos.js           CPF, telefone, primeiro nome
│   └── constantes.js         nomes de modalidade, status e situação
├── hooks/useCarregar.js      hook que busca dados e controla carregando/erro
├── componentes/              peças reutilizáveis
│   ├── basicos.jsx           Button, Chip, Field, ErroBox, Avatar, ...
│   ├── Modal.jsx             Modal, ModalAcao, Toast
│   ├── navegacao.jsx         AppBar, NavInferior, Sininho (notificações)
│   ├── agendamento.jsx       CalendarioMes, GradeHorarios, Resumo, SeletorDia
│   ├── FotoPerfil.jsx, Icon.jsx, contexto.jsx, Redirecionar.jsx
├── paginas/
│   ├── publico/              Home, Login, Cadastro
│   ├── conta/                Minha conta, troca de senha
│   ├── paciente/             Início, Queixa, Avaliação, Pilates, Fisioterapia, Histórico, ...
│   └── admin/                Painel, Atendimentos, Pedidos, Pacientes, Agenda, Evolução
│       └── modais/           janelas (modais) usadas pelas telas da clínica
└── estilos/                  CSS dividido por assunto (a ordem de importação está em main.jsx)
```

**Onde fica cada tela?** O nome do arquivo é o nome da tela: `paginas/admin/PainelPage.jsx`,
`paginas/admin/AgendaPage.jsx`, `paginas/paciente/QueixaPage.jsx`, e assim por diante.
A ligação entre endereço (`#/admin/agenda`) e tela está em `src/App.jsx`.

**Adicionar uma tela:** crie o arquivo em `paginas/...`, exporte o componente (`export function MinhaPage() {...}`)
e registre a rota em `src/App.jsx`.
