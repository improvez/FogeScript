#!/usr/bin/env node
/*
 * Roda todos os testes do FogeScript:   node testes/rodar-testes.js
 *
 * 1. testes/validos/*.foge  programas que precisam funcionar. Cada um é
 *    traduzido e rodado de três jeitos (interpretador, JavaScript gerado
 *    rodando no site e o arquivo .js gerado rodando no Node), e a saída tem
 *    que ser igual ao arquivo .saida. A Entrada vem do arquivo .entrada.
 * 2. testes/erros/*.foge    programas com erro. A primeira linha diz o erro
 *    esperado ("// ESPERADO: erro sintático na linha 6, coluna 45") e o teste
 *    confere a etapa, a linha e a coluna.
 * 3. exemplos/*.foge        os exemplos do site: os três jeitos de rodar
 *    precisam dar a mesma saída.
 *
 * As evidências (código original, JavaScript gerado e resultado da execução)
 * ficam em testes/resultados/.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const FogeScript = require('../fogescript.js');

const RAIZ = path.join(__dirname, '..');
const RESULTADOS = path.join(__dirname, 'resultados');
fs.mkdirSync(RESULTADOS, { recursive: true });

const ler = (arquivo) => (fs.existsSync(arquivo) ? fs.readFileSync(arquivo, 'utf8').replace(/\r\n/g, '\n') : null);
const foges = (pasta) => fs.readdirSync(pasta).filter((f) => f.endsWith('.foge')).sort().map((f) => path.join(pasta, f));
const semExtensao = (arquivo) => arquivo.replace(/\.foge$/, '');
const relativo = (arquivo) => path.relative(RAIZ, arquivo).replace(/\\/g, '/');

// Roda o .js gerado num processo separado do Node, como qualquer usuário rodaria.
function rodarNode(arquivoJs, entrada) {
  const r = spawnSync(process.execPath, [arquivoJs], { input: entrada, encoding: 'utf8' });
  const limpar = (s) => (s || '').replace(/\r\n/g, '\n');
  return { saida: limpar(r.stdout), erro: limpar(r.stderr), status: r.status };
}

function secao(titulo, texto) {
  return `=== ${titulo} ${'='.repeat(Math.max(3, 70 - titulo.length))}\n${texto.endsWith('\n') || !texto ? texto : texto + '\n'}`;
}

const resultados = [];
function registrar(grupo, nome, ok, detalhe) {
  resultados.push({ grupo, nome, ok, detalhe });
  console.log(`${ok ? '  ok ' : 'FALHA'}  ${nome}${detalhe ? '  (' + detalhe + ')' : ''}`);
}

// ---- 1. programas válidos --------------------------------------------------
console.log('\nProgramas válidos (testes/validos)');
for (const arquivo of foges(path.join(__dirname, 'validos'))) {
  const nome = path.basename(arquivo, '.foge');
  const src = ler(arquivo);
  const entrada = ler(semExtensao(arquivo) + '.entrada') || '';
  const esperado = ler(semExtensao(arquivo) + '.saida');
  const problemas = [];

  const t = FogeScript.traduzir(src, { fonte: nome + '.foge' });
  if (!t.ok) {
    registrar('validos', nome, false, 'não traduziu: ' + FogeScript.formatarErro(t.erros[0], src));
    continue;
  }
  const js = path.join(RESULTADOS, nome + '.js');
  fs.writeFileSync(js, t.arquivo);

  const interpretado = FogeScript.run(src, { input: entrada });
  const compilado = FogeScript.runCompiled(src, { input: entrada });
  const node = rodarNode(js, entrada);
  if (esperado === null) problemas.push('falta o arquivo .saida');
  if (interpretado.output !== esperado) problemas.push('interpretador');
  if (compilado.output !== esperado) problemas.push('JavaScript gerado no site');
  if (node.saida !== esperado || node.status !== 0) problemas.push(`node ${nome}.js`);

  fs.writeFileSync(path.join(RESULTADOS, nome + '.txt'),
    secao(`Código FogeScript (testes/validos/${nome}.foge)`, src) + '\n' +
    secao('Entrada', entrada || '(nenhuma)\n') + '\n' +
    secao(`JavaScript gerado: node tradutor.js testes/validos/${nome}.foge`,
      `// O arquivo completo é testes/resultados/${nome}.js: este programa mais o runtime (funções foge.*).\n\n` + t.codigo) + '\n' +
    secao(`Saída de: node testes/resultados/${nome}.js`, node.saida + node.erro) + '\n' +
    secao('Conferência', problemas.length ? 'DIFERENTE do esperado em: ' + problemas.join(', ') + '\n' : 'igual à saída esperada nos três jeitos de rodar (interpretador, site e Node)\n'));
  registrar('validos', nome, problemas.length === 0, problemas.length ? 'diferente em: ' + problemas.join(', ') : 'saída igual à esperada');
}

// ---- 2. programas com erro -------------------------------------------------
const FASES = { 'léxico': 'léxico', 'sintático': 'sintático', 'semântico': 'semântico', 'de execução': 'execução' };
console.log('\nProgramas com erro (testes/erros)');
for (const arquivo of foges(path.join(__dirname, 'erros'))) {
  const nome = path.basename(arquivo, '.foge');
  const src = ler(arquivo);
  const entrada = ler(semExtensao(arquivo) + '.entrada') || '';
  const m = /ESPERADO:\s*erro (léxico|sintático|semântico|de execução) na linha (\d+)(?:, coluna (\d+))?/.exec(src);
  if (!m) {
    registrar('erros', nome, false, 'falta a linha "// ESPERADO: erro ... na linha N"');
    continue;
  }
  const fase = FASES[m[1]];
  const linha = Number(m[2]);
  const coluna = m[3] ? Number(m[3]) : undefined;

  let erro;
  let relato;
  const t = FogeScript.traduzir(src, { fonte: nome + '.foge' });
  if (fase === 'execução') {
    // O programa traduz sem erro; o erro só aparece ao rodar o .js gerado.
    if (!t.ok) {
      erro = t.erros[0];
      relato = t.erros.map((e) => FogeScript.formatarErro(e, src)).join('\n\n');
    } else {
      const js = path.join(RESULTADOS, nome + '.js');
      fs.writeFileSync(js, t.arquivo);
      const node = rodarNode(js, entrada);
      const r = FogeScript.run(src, { input: entrada });
      erro = r.ok ? null : r.erros[0];
      relato = 'A tradução não teve erro. JavaScript gerado:\n\n' + t.codigo +
        `\nSaída de: node testes/resultados/${nome}.js\n` + node.saida + node.erro + `(código de saída ${node.status})\n`;
      if (node.status !== 1 || !node.erro.includes(`na linha ${linha}:`)) erro = null;
    }
  } else {
    erro = t.erros[0];
    relato = t.erros.length ? t.erros.map((e) => FogeScript.formatarErro(e, src)).join('\n\n') : 'nenhum erro encontrado';
    // o interpretador tem que parar no mesmo erro, antes de rodar qualquer coisa
    const r = FogeScript.run(src, { input: entrada });
    if (r.ok || r.fase !== fase || r.linha !== linha || r.output !== '') erro = null;
  }
  const certo = !!erro && erro.fase === fase && erro.linha === linha && (coluna === undefined || erro.coluna === coluna);
  fs.writeFileSync(path.join(RESULTADOS, nome + '.txt'),
    secao(`Código FogeScript (testes/erros/${nome}.foge)`, src) + '\n' +
    (entrada ? secao('Entrada', entrada) + '\n' : '') +
    secao(`Resultado de: node tradutor.js testes/erros/${nome}.foge`, relato + '\n'));
  registrar('erros', nome, certo, certo ? `${m[1]}, linha ${linha}${coluna ? ', coluna ' + coluna : ''}` : `esperava ${m[0].slice(10)}`);
}

// ---- 3. exemplos do site ---------------------------------------------------
console.log('\nExemplos do site (exemplos)');
const pastaTemp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'fogescript-'));
for (const arquivo of foges(path.join(RAIZ, 'exemplos'))) {
  const nome = path.basename(arquivo, '.foge');
  const src = ler(arquivo);
  const entrada = ler(semExtensao(arquivo) + '.entrada') || '';
  const t = FogeScript.traduzir(src, { fonte: nome + '.foge' });
  if (!t.ok) {
    registrar('exemplos', nome, false, 'não traduziu');
    continue;
  }
  const js = path.join(pastaTemp, nome + '.js');
  fs.writeFileSync(js, t.arquivo);
  const a = FogeScript.run(src, { input: entrada });
  const b = FogeScript.runCompiled(src, { input: entrada });
  const c = rodarNode(js, entrada);
  const iguais = a.ok && b.ok && a.output === b.output && a.output === c.saida && c.status === 0;
  registrar('exemplos', nome, iguais, iguais ? 'os três jeitos de rodar deram a mesma saída' : 'saídas diferentes');
}
fs.rmSync(pastaTemp, { recursive: true, force: true });

// ---- resumo ------------------------------------------------------------------
const falhas = resultados.filter((r) => !r.ok);
const contar = (g) => {
  const lista = resultados.filter((r) => r.grupo === g);
  return `${lista.filter((r) => r.ok).length}/${lista.length}`;
};
const resumo = [
  `FogeScript ${FogeScript.version}: resultado dos testes`,
  '',
  `Programas válidos:  ${contar('validos')}`,
  `Programas com erro: ${contar('erros')}`,
  `Exemplos do site:   ${contar('exemplos')}`,
  '',
  ...resultados.map((r) => `${r.ok ? 'ok   ' : 'FALHA'}  ${r.grupo.padEnd(8)}  ${r.nome}${r.detalhe ? '  (' + r.detalhe + ')' : ''}`),
  '',
  falhas.length ? `${falhas.length} teste(s) falharam.` : 'Todos os testes passaram.',
].join('\n') + '\n';
fs.writeFileSync(path.join(RESULTADOS, 'resumo.txt'), resumo);
console.log('\n' + (falhas.length ? `${falhas.length} teste(s) falharam.` : `Todos os ${resultados.length} testes passaram.`));
console.log(`Evidências em ${relativo(RESULTADOS)}/`);
process.exitCode = falhas.length ? 1 : 0;
