#!/usr/bin/env node
/*
 * Tradutor FogeScript -> JavaScript, pela linha de comando.
 *
 *   node tradutor.js programa.foge                 traduz e grava programa.js
 *   node tradutor.js programa.foge -o saida.js     escolhe o nome do arquivo gerado
 *   node tradutor.js programa.foge --rodar         traduz e já roda o programa gerado
 *   node tradutor.js programa.foge --tokens        mostra os tokens (análise léxica)
 *   node tradutor.js programa.foge --arvore        mostra a árvore sintática (AST)
 *   node tradutor.js programa.foge --simbolos      mostra a tabela de símbolos (análise semântica)
 *   node tradutor.js programa.foge --interpretar   roda com o interpretador, sem gerar arquivo
 *
 * O arquivo gerado roda sozinho: node programa.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const FogeScript = require('./fogescript.js');

const AJUDA = `Tradutor FogeScript ${FogeScript.version}: traduz um programa .foge para JavaScript.

Uso: node tradutor.js <programa.foge> [opções]

Opções:
  -o, --saida <arquivo.js>  nome do arquivo gerado (padrão: o mesmo nome, com .js)
  --rodar                   depois de traduzir, roda o programa gerado
  --tokens                  mostra os tokens (análise léxica)
  --arvore                  mostra a árvore sintática (análise sintática)
  --simbolos                mostra a tabela de símbolos (análise semântica)
  --codigo                  mostra o JavaScript gerado
  --interpretar             roda com o interpretador, sem gerar arquivo
  -h, --ajuda               mostra esta ajuda

Exemplos:
  node tradutor.js exemplos/somador.foge
  node exemplos/somador.js
  node tradutor.js exemplos/somador.foge --rodar < exemplos/somador.entrada`;

function lerOpcoes(args) {
  const o = { arquivo: null, saida: null, rodar: false, tokens: false, arvore: false, simbolos: false, codigo: false, interpretar: false, ajuda: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-o' || a === '--saida') o.saida = args[++i];
    else if (a === '--rodar') o.rodar = true;
    else if (a === '--tokens') o.tokens = true;
    else if (a === '--arvore') o.arvore = true;
    else if (a === '--simbolos') o.simbolos = true;
    else if (a === '--codigo') o.codigo = true;
    else if (a === '--interpretar') o.interpretar = true;
    else if (a === '-h' || a === '--ajuda' || a === '--help') o.ajuda = true;
    else if (a.startsWith('-')) throw new Error(`Opção desconhecida: ${a}`);
    else if (!o.arquivo) o.arquivo = a;
    else throw new Error(`Só dá para traduzir um arquivo por vez (recebi "${o.arquivo}" e "${a}")`);
  }
  return o;
}

// Monta uma tabela de texto com colunas alinhadas.
function tabela(cabecalho, linhas) {
  const largura = cabecalho.map((c, i) => Math.max(c.length, ...linhas.map((l) => String(l[i]).length)));
  const fmt = (l) => l.map((c, i) => String(c).padEnd(largura[i])).join('  ').trimEnd();
  return [fmt(cabecalho), largura.map((n) => '-'.repeat(n)).join('  '), ...linhas.map(fmt)].join('\n');
}

function contarNos(no) {
  if (!no || typeof no !== 'object') return 0;
  if (Array.isArray(no)) return no.reduce((s, x) => s + contarNos(x), 0);
  let n = no.type ? 1 : 0;
  for (const [k, v] of Object.entries(no)) if (k !== 'sym' && v && typeof v === 'object') n += contarNos(v);
  return n;
}

function main() {
  let o;
  try {
    o = lerOpcoes(process.argv.slice(2));
  } catch (e) {
    console.error(e.message + '\n\n' + AJUDA);
    return 2;
  }
  if (o.ajuda || !o.arquivo) {
    console.log(AJUDA);
    return o.ajuda ? 0 : 2;
  }

  let src;
  try {
    src = fs.readFileSync(o.arquivo, 'utf8').replace(/^﻿/, '');
  } catch (e) {
    console.error(`Não consegui abrir "${o.arquivo}": ${e.code === 'ENOENT' ? 'o arquivo não existe' : e.message}`);
    return 2;
  }

  // Modo interpretador: roda a AST direto, lendo a Entrada do teclado.
  if (o.interpretar) {
    const io = FogeScript.entradaSaidaNode();
    const r = FogeScript.run(src, { prompt: () => io.readLine(), onOutput: (s) => process.stdout.write(s) });
    if (!r.ok) {
      for (const e of r.erros) console.error(FogeScript.formatarErro(e, src));
      return 1;
    }
    return 0;
  }

  const fonte = path.basename(o.arquivo);
  // caminho com "/" funciona em qualquer terminal, inclusive no Windows
  const saida = o.saida || path.join(path.dirname(o.arquivo), fonte.replace(/\.[^.]*$/, '') + '.js').split(path.sep).join('/');
  const protegidos = ['fogescript.js', 'tradutor.js'].map((f) => path.resolve(__dirname, f));
  if ([path.resolve(o.arquivo), ...protegidos].includes(path.resolve(saida))) {
    console.error(`O arquivo gerado iria apagar "${saida}". Escolha outro nome com -o.`);
    return 2;
  }

  const r = FogeScript.traduzir(src, { fonte, saida: path.basename(saida) });
  const etapa = (n, nome, resultado) => console.log(`  ${n}. ${nome.padEnd(20, '.')} ${resultado}`);

  console.log(`FogeScript ${FogeScript.version} · tradutor para JavaScript`);
  console.log(`Arquivo: ${o.arquivo}\n`);
  etapa(1, 'Análise léxica', r.tokens ? `ok   ${r.tokens.length - 1} tokens` : 'ERRO');
  etapa(2, 'Análise sintática', r.ast ? `ok   árvore com ${contarNos(r.ast)} nós` : r.tokens ? 'ERRO' : '-');
  if (r.semantica) {
    const s = r.semantica;
    const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
    const resumo = `${plural(s.simbolos.length, 'nome', 'nomes')}, ${plural(s.funcoes.length, 'função', 'funções')}, ${plural(s.avisos.length, 'aviso', 'avisos')}`;
    etapa(3, 'Análise semântica', s.erros.length ? `ERRO ${plural(s.erros.length, 'erro', 'erros')}, ${resumo}` : `ok   ${resumo}`);
  } else etapa(3, 'Análise semântica', '-');
  etapa(4, 'Geração de código', r.ok ? `ok   ${saida}` : '-'); // só roda se as análises passarem

  if (o.tokens && r.tokens) {
    const linhas = FogeScript.listarTokens(r.tokens, src).map((t) => [`${t.linha}:${t.coluna}`, t.categoria, t.lexema, t.valor]);
    console.log('\nTokens (análise léxica)\n' + tabela(['linha:col', 'categoria', 'texto', 'valor'], linhas));
  }
  if (o.arvore && r.ast) console.log('\nÁrvore sintática (AST)\n' + FogeScript.desenharArvore(r.ast));
  if (o.simbolos && r.semantica) {
    const s = r.semantica;
    const linhas = s.simbolos.map((x) => [x.nome, x.especie, x.tipo === '?' ? 'desconhecido' : x.tipo, x.escopo, `${x.linha}:${x.coluna}`]);
    console.log('\nTabela de símbolos (análise semântica)\n' + tabela(['nome', 'espécie', 'tipo', 'escopo', 'linha:col'], linhas));
    if (s.funcoes.length) {
      console.log('\nFunções\n' + tabela(['nome', 'parâmetros', 'linha'], s.funcoes.map((f) => [f.nome, f.parametros.join(', ') || '(nenhum)', f.linha])));
    }
  }

  for (const a of r.avisos) console.log(`\nAviso na linha ${a.linha}, coluna ${a.coluna}: ${a.mensagem}`);
  if (!r.ok) {
    console.error('');
    for (const e of r.erros) console.error(FogeScript.formatarErro(e, src) + '\n');
    return 1;
  }

  fs.writeFileSync(saida, r.arquivo);
  if (o.codigo) console.log('\nJavaScript gerado\n' + r.codigo);
  if (!o.rodar) {
    console.log(`\nPara rodar: node ${saida}`);
    return 0;
  }
  console.log(`\nRodando: node ${saida}\n`);
  const exec = spawnSync(process.execPath, [saida], { stdio: 'inherit' });
  return exec.status === null ? 1 : exec.status;
}

process.exitCode = main();
