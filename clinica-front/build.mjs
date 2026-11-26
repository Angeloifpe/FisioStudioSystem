// Gera a pasta dist/ (HTML + JS + CSS) a partir de src/ e public/.
//   node build.mjs          -> build de produção (minificado)
//   node build.mjs --dev    -> modo desenvolvimento: recompila ao salvar e abre em http://localhost:5173
import { build, context } from "esbuild";
import { cpSync, rmSync, mkdirSync } from "node:fs";

const dev = process.argv.includes("--dev");
const opcoes = {
  entryPoints: { app: "src/main.jsx" },
  bundle: true,
  outdir: "dist/assets",
  loader: { ".js": "jsx", ".jsx": "jsx" },
  jsx: "automatic",
  platform: "browser",
  target: "es2018",
  minify: !dev,
  sourcemap: dev,
  define: { "process.env.NODE_ENV": dev ? '"development"' : '"production"' },
  logLevel: "warning",
};

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });
cpSync("public", "dist", { recursive: true });

if (dev) {
  const ctx = await context(opcoes);
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: "dist", port: 5173 });
  console.log(`Front rodando em http://localhost:${port}  (a API deve estar em http://localhost:3333)`);
} else {
  await build(opcoes);
  console.log("dist/ gerado");
}
