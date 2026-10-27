/*
 * FogeScript — a linguagem de programação da senhora que trabalha na Assembleia.
 * Interpretador completo (léxico, sintático e execução) que roda direto no navegador.
 * Também funciona no Node: const FogeScript = require('./fogescript.js');
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FogeScript = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Dicionário oficial
  // ---------------------------------------------------------------------------
  const KEYWORDS = [
    ['INICIO', 'A SENHORA TRABALHA NA ASSEMBLEIA?'],
    ['FIM', 'FUGIU'],
    ['PRINT', 'TEMOS GRAVADO!'],
    ['INPUT', 'QUER CONVERSAR COMIGO?'],
    ['VAR', 'A SENHORA FEZ'],
    ['IF', 'SE A SENHORA NÃO É FUNCIONÁRIA'],
    ['ELSEIF', 'ENTÃO A SENHORA É O QUÊ?'],
    ['ELSE', 'E TÁ CORRENDO POR QUÊ?'],
    ['WHILE', 'ENQUANTO TIVER CORRENDO'],
    ['FOR', 'SENHORA? SENHORA?!'],
    ['BREAK', 'VOLTA AQUI!'],
    ['CONTINUE', 'DEIXA ELA CORRER'],
    ['FUNC', 'NÃO, EU NUNCA FIZ ISSO'],
    ['CALL', 'CHAMA A SENHORA'],
    ['RETURN', 'CHEGA DE CORRER'],
    ['TRUE', 'TÁ GRAVADO'],
    ['FALSE', 'NÃO TÁ GRAVADO'],
    ['TRY', 'DEIXA EU TE PERGUNTAR'],
    ['CATCH', 'A SENHORA TÁ NERVOSA?'],
    ['THROW', 'ME DEIXA EM PAZ!'],
  ];
  const KW_PHRASE = Object.fromEntries(KEYWORDS);

  // Palavras-chave ignoram maiúsculas/minúsculas e acentos ("nao" = "NÃO").
  function normChar(c) {
    let b = c.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (b.length !== 1) b = c;
    const u = b.toUpperCase();
    return u.length === 1 ? u : b;
  }
  function normalize(s) {
    let out = '';
    for (let i = 0; i < s.length; i++) out += normChar(s[i]);
    return out;
  }
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const KW_LIST = KEYWORDS.map(([name, phrase]) => {
    const n = normalize(phrase);
    return {
      name,
      re: new RegExp(n.split(/\s+/).map(escapeRe).join('\\s+'), 'y'),
      endsWord: /[A-Z0-9]$/.test(n),
    };
  });

  class FogeErro extends Error {
    constructor(msg, linha) {
      super(msg);
      this.name = 'FogeErro';
      this.linha = linha;
    }
  }

  // ---------------------------------------------------------------------------
  // Análise léxica
  // ---------------------------------------------------------------------------
  const OPS2 = ['==', '!=', '<=', '>=', '&&', '||', '++', '--', '+=', '-=', '*=', '/=', '%='];
  const OPS1 = '+-*/%<>=!(),;[]';
  const IDENT_START = /[\p{L}_]/u;
  const IDENT_PART = /[\p{L}\p{N}_]/u;

  function tokenize(src, tolerant) {
    const norm = normalize(src);
    const toks = [];
    const n = src.length;
    let i = 0;
    let line = 1;
    const push = (type, value, start, end, l) => toks.push({ type, value, start, end, line: l });
    const countLines = (text) => (text.match(/\n/g) || []).length;

    while (i < n) {
      const c = src[i];
      if (c === '\n') { line++; i++; continue; }
      if (/\s/.test(c)) { i++; continue; }
      const l = line;

      // comentários
      if (c === '/' && src[i + 1] === '/') {
        let j = src.indexOf('\n', i);
        if (j < 0) j = n;
        if (tolerant) push('comment', src.slice(i, j), i, j, l);
        i = j;
        continue;
      }
      if (c === '/' && src[i + 1] === '*') {
        let j = src.indexOf('*/', i + 2);
        if (j < 0) {
          if (!tolerant) throw new FogeErro('Comentário /* aberto e nunca fechado', l);
          j = n;
        } else j += 2;
        if (tolerant) push('comment', src.slice(i, j), i, j, l);
        line += countLines(src.slice(i, j));
        i = j;
        continue;
      }

      // textos
      if (c === '"' || c === "'") {
        let j = i + 1;
        let val = '';
        while (j < n && src[j] !== c && src[j] !== '\n') {
          if (src[j] === '\\' && j + 1 < n) {
            const e = src[j + 1];
            val += e === 'n' ? '\n' : e === 't' ? '\t' : e;
            j += 2;
          } else {
            val += src[j];
            j++;
          }
        }
        if (src[j] !== c) {
          if (!tolerant) throw new FogeErro('Texto sem as aspas de fechamento', l);
          push('str', val, i, j, l);
          i = j;
          continue;
        }
        push('str', val, i, j + 1, l);
        i = j + 1;
        continue;
      }

      // números
      if (/\d/.test(c)) {
        const m = /\d+(\.\d+)?/y;
        m.lastIndex = i;
        const r = m.exec(src);
        push('num', parseFloat(r[0]), i, i + r[0].length, l);
        i += r[0].length;
        continue;
      }

      // palavras-chave (a maior que casar) ou nomes
      if (IDENT_START.test(c)) {
        let best = null;
        let bestLen = 0;
        for (const k of KW_LIST) {
          k.re.lastIndex = i;
          const m = k.re.exec(norm);
          if (!m) continue;
          const end = i + m[0].length;
          if (k.endsWord && end < n && IDENT_PART.test(src[end])) continue;
          if (m[0].length > bestLen) { best = k; bestLen = m[0].length; }
        }
        if (best) {
          push('kw', best.name, i, i + bestLen, l);
          line += countLines(src.slice(i, i + bestLen));
          i += bestLen;
          continue;
        }
        let j = i + 1;
        while (j < n && IDENT_PART.test(src[j])) j++;
        push('ident', src.slice(i, j), i, j, l);
        i = j;
        continue;
      }

      // operadores
      const two = src.substr(i, 2);
      if (OPS2.includes(two)) { push('op', two, i, i + 2, l); i += 2; continue; }
      if (OPS1.includes(c)) { push('op', c, i, i + 1, l); i++; continue; }

      if (!tolerant) throw new FogeErro(`Símbolo estranho "${c}"`, l);
      push('error', c, i, i + 1, l);
      i++;
    }
    push('eof', null, n, n, line);
    return toks;
  }

  // ---------------------------------------------------------------------------
  // Análise sintática
  // ---------------------------------------------------------------------------
  function parse(src) {
    const toks = tokenize(src, false);
    let p = 0;
    let loopDepth = 0;
    const peek = () => toks[p];
    const next = () => toks[p++];
    const isKw = (name) => peek().type === 'kw' && peek().value === name;
    const isOp = (v) => peek().type === 'op' && peek().value === v;
    const isKwIn = (names) => peek().type === 'kw' && names.includes(peek().value);

    function desc(t) {
      if (t.type === 'eof') return 'o fim do código';
      if (t.type === 'kw') return `"${KW_PHRASE[t.value]}"`;
      if (t.type === 'str') return `o texto "${t.value}"`;
      return `"${t.value}"`;
    }
    function expectOp(v, ctx) {
      if (!isOp(v)) {
        throw new FogeErro(`Esperava "${v}"${ctx ? ' ' + ctx : ''}, mas veio ${desc(peek())}`, peek().line);
      }
      return next();
    }
    function expectIdent(ctx) {
      const t = peek();
      if (t.type !== 'ident') throw new FogeErro(`Esperava um nome ${ctx}, mas veio ${desc(t)}`, t.line);
      return next();
    }
    const optSemi = () => { if (isOp(';')) next(); };
    // lista separada por vírgulas até o fechamento
    function list(close, item) {
      const out = [];
      if (!isOp(close)) {
        do out.push(item()); while (isOp(',') && next());
      }
      return out;
    }

    function parseProgram() {
      const funcs = [];
      const globals = [];
      let main = null;
      while (peek().type !== 'eof') {
        const t = peek();
        if (isKw('FUNC')) funcs.push(parseFunc());
        else if (isKw('VAR')) globals.push(parseVar());
        else if (isKw('INICIO')) {
          if (main) throw new FogeErro('Só pode existir uma Assembleia: o programa tem dois "A SENHORA TRABALHA NA ASSEMBLEIA?"', t.line);
          next();
          const body = parseBlock(t, ['FIM']);
          next();
          main = { body, line: t.line };
        } else if (isKw('FIM')) {
          throw new FogeErro('"FUGIU" sobrando: não há nenhum bloco aberto para fechar', t.line);
        } else {
          throw new FogeErro(
            `Código fora da Assembleia (${desc(t)}). Coloque-o entre "${KW_PHRASE.INICIO}" e "FUGIU". Fora dela só podem ficar funções e variáveis globais`,
            t.line
          );
        }
      }
      if (!main) throw new FogeErro(`Cadê a Assembleia? Todo programa precisa de um "${KW_PHRASE.INICIO}" ... "FUGIU"`, 1);
      return { funcs, globals, main };
    }

    function parseBlock(openTok, terms) {
      const body = [];
      for (;;) {
        const t = peek();
        if (t.type === 'eof') {
          throw new FogeErro(`Faltou o "FUGIU" para fechar o ${desc(openTok)} da linha ${openTok.line}`, t.line);
        }
        if (isKwIn(terms)) return body;
        body.push(parseStmt());
      }
    }

    function parseCond(openTok) {
      expectOp('(', `depois de ${desc(openTok)}`);
      const e = parseExpr();
      expectOp(')', 'para fechar a condição');
      return e;
    }

    function parseVarDecls() {
      const t = next();
      const decls = list(null, () => {
        const id = expectIdent('para a variável');
        let init = null;
        if (isOp('=')) { next(); init = parseExpr(); }
        return { name: id.value, init, line: id.line };
      });
      return { type: 'Var', decls, line: t.line };
    }
    function parseVar() {
      const v = parseVarDecls();
      optSemi();
      return v;
    }

    function parseFunc() {
      const t = next();
      const name = expectIdent('para a função');
      expectOp('(', `depois do nome da função "${name.value}"`);
      const params = list(')', () => expectIdent('de parâmetro').value);
      expectOp(')', 'para fechar os parâmetros');
      const seen = new Set();
      for (const prm of params) {
        if (seen.has(prm)) throw new FogeErro(`Parâmetro "${prm}" repetido na função "${name.value}"`, t.line);
        seen.add(prm);
      }
      const saved = loopDepth;
      loopDepth = 0;
      const body = parseBlock(t, ['FIM']);
      loopDepth = saved;
      next();
      return { type: 'Func', name: name.value, params, body, line: t.line };
    }

    function parseIf() {
      const t = next();
      const branches = [];
      const terms = ['FIM', 'ELSEIF', 'ELSE'];
      branches.push({ cond: parseCond(t), body: parseBlock(t, terms) });
      let elseBody = null;
      while (isKw('ELSEIF')) {
        const e = next();
        branches.push({ cond: parseCond(e), body: parseBlock(t, terms) });
      }
      if (isKw('ELSE')) {
        next();
        elseBody = parseBlock(t, terms);
        if (!isKw('FIM')) {
          throw new FogeErro(`Depois do "${KW_PHRASE.ELSE}" só pode vir "FUGIU"`, peek().line);
        }
      }
      next();
      return { type: 'If', branches, elseBody, line: t.line };
    }

    function parseLoopBody(t) {
      loopDepth++;
      const body = parseBlock(t, ['FIM']);
      loopDepth--;
      next();
      return body;
    }

    function parseFor() {
      const t = next();
      expectOp('(', `depois de ${desc(t)}`);
      let init = null;
      if (!isOp(';')) init = isKw('VAR') ? parseVarDecls() : { type: 'Expr', expr: parseExpr(), line: t.line };
      expectOp(';', 'depois do início do laço');
      const cond = isOp(';') ? null : parseExpr();
      expectOp(';', 'depois da condição do laço');
      const step = isOp(')') ? null : parseExpr();
      expectOp(')', 'para fechar o laço');
      const body = parseLoopBody(t);
      return { type: 'For', init, cond, step, body, line: t.line };
    }

    function parseTry() {
      const t = next();
      const body = parseBlock(t, ['CATCH', 'FIM']);
      if (!isKw('CATCH')) {
        throw new FogeErro(`"${KW_PHRASE.TRY}" precisa de um "${KW_PHRASE.CATCH}" para tratar o erro`, peek().line);
      }
      next();
      let errName = null;
      if (isOp('(')) {
        next();
        errName = expectIdent('para guardar o erro').value;
        expectOp(')');
      }
      const catchBody = parseBlock(t, ['FIM']);
      next();
      return { type: 'Try', body, errName, catchBody, line: t.line };
    }

    function parseStmt() {
      const t = peek();
      if (t.type === 'kw') {
        switch (t.value) {
          case 'VAR': return parseVar();
          case 'PRINT': {
            next();
            expectOp('(', `depois de "${KW_PHRASE.PRINT}"`);
            const args = list(')', parseExpr);
            expectOp(')', 'para fechar o TEMOS GRAVADO!');
            optSemi();
            return { type: 'Print', args, line: t.line };
          }
          case 'INPUT': {
            next();
            expectOp('(', `depois de "${KW_PHRASE.INPUT}"`);
            const targets = list(')', () => {
              const id = expectIdent('de variável para guardar a resposta');
              return { name: id.value, line: id.line };
            });
            if (!targets.length) throw new FogeErro('Diga em qual variável guardar a resposta', t.line);
            expectOp(')');
            optSemi();
            return { type: 'Input', targets, line: t.line };
          }
          case 'IF': return parseIf();
          case 'WHILE': {
            next();
            const cond = parseCond(t);
            return { type: 'While', cond, body: parseLoopBody(t), line: t.line };
          }
          case 'FOR': return parseFor();
          case 'BREAK':
          case 'CONTINUE':
            next();
            if (!loopDepth) throw new FogeErro(`${desc(t)} só pode ser usado dentro de um laço`, t.line);
            optSemi();
            return { type: t.value === 'BREAK' ? 'Break' : 'Continue', line: t.line };
          case 'RETURN': {
            next();
            let expr = null;
            const nt = peek();
            if (!isOp(';') && nt.type !== 'eof' && nt.line === t.line && !isKwIn(['FIM', 'ELSE', 'ELSEIF', 'CATCH'])) {
              expr = parseExpr();
            }
            optSemi();
            return { type: 'Return', expr, line: t.line };
          }
          case 'TRY': return parseTry();
          case 'THROW': {
            next();
            const expr = parseExpr();
            optSemi();
            return { type: 'Throw', expr, line: t.line };
          }
          case 'FUNC':
            throw new FogeErro('Funções devem ser declaradas fora da Assembleia e fora de outras funções', t.line);
          case 'INICIO':
            throw new FogeErro('A Assembleia não pode ficar dentro de outro bloco', t.line);
          case 'ELSE':
          case 'ELSEIF':
            throw new FogeErro(`${desc(t)} sem um "${KW_PHRASE.IF}" antes`, t.line);
          case 'CATCH':
            throw new FogeErro(`${desc(t)} sem um "${KW_PHRASE.TRY}" antes`, t.line);
          default:
            break;
        }
      }
      const expr = parseExpr();
      optSemi();
      return { type: 'Expr', expr, line: t.line };
    }

    // expressões, da menor para a maior precedência
    function parseExpr() {
      const left = parseBinary(0);
      if (peek().type === 'op' && ['=', '+=', '-=', '*=', '/=', '%='].includes(peek().value)) {
        const op = next();
        if (left.type !== 'Ident' && left.type !== 'Index') {
          throw new FogeErro('Só dá para guardar valor em uma variável ou numa posição de lista', op.line);
        }
        return { type: 'Assign', op: op.value, target: left, value: parseExpr(), line: op.line };
      }
      return left;
    }

    const LEVELS = [['||'], ['&&'], ['==', '!='], ['<', '>', '<=', '>='], ['+', '-'], ['*', '/', '%']];
    function parseBinary(level) {
      if (level === LEVELS.length) return parseUnary();
      let left = parseBinary(level + 1);
      while (peek().type === 'op' && LEVELS[level].includes(peek().value)) {
        const op = next();
        const right = parseBinary(level + 1);
        left = { type: level < 2 ? 'Logical' : 'Binary', op: op.value, left, right, line: op.line };
      }
      return left;
    }

    function checkTarget(e, op) {
      if (e.type !== 'Ident' && e.type !== 'Index') {
        throw new FogeErro(`"${op.value}" só funciona em variáveis`, op.line);
      }
    }

    function parseUnary() {
      if (isOp('!') || isOp('-')) {
        const op = next();
        return { type: 'Unary', op: op.value, arg: parseUnary(), line: op.line };
      }
      if (isOp('++') || isOp('--')) {
        const op = next();
        const target = parseUnary();
        checkTarget(target, op);
        return { type: 'Update', op: op.value, prefix: true, target, line: op.line };
      }
      let e = parsePrimary();
      for (;;) {
        if (isOp('[')) {
          const t = next();
          const index = parseExpr();
          expectOp(']', 'para fechar a posição da lista');
          e = { type: 'Index', obj: e, index, line: t.line };
        } else if (isOp('++') || isOp('--')) {
          const op = next();
          checkTarget(e, op);
          e = { type: 'Update', op: op.value, prefix: false, target: e, line: op.line };
        } else return e;
      }
    }

    function parseCall(nameTok) {
      expectOp('(', `depois do nome da função "${nameTok.value}"`);
      const args = list(')', parseExpr);
      expectOp(')', 'para fechar a chamada');
      return { type: 'Call', name: nameTok.value, args, line: nameTok.line };
    }

    function parsePrimary() {
      const t = peek();
      if (t.type === 'num' || t.type === 'str') { next(); return { type: 'Lit', value: t.value, line: t.line }; }
      if (t.type === 'ident') {
        next();
        if (isOp('(')) return parseCall(t);
        return { type: 'Ident', name: t.value, line: t.line };
      }
      if (t.type === 'kw') {
        if (t.value === 'TRUE' || t.value === 'FALSE') { next(); return { type: 'Lit', value: t.value === 'TRUE', line: t.line }; }
        if (t.value === 'CALL') {
          next();
          return parseCall(expectIdent('de função depois de "CHAMA A SENHORA"'));
        }
      }
      if (isOp('(')) {
        next();
        const e = parseExpr();
        expectOp(')', 'para fechar o parêntese');
        return e;
      }
      if (isOp('[')) {
        next();
        const items = list(']', parseExpr);
        expectOp(']', 'para fechar a lista');
        return { type: 'List', items, line: t.line };
      }
      throw new FogeErro(`Esperava um valor, mas veio ${desc(t)}`, t.line);
    }

    return parseProgram();
  }

  // ---------------------------------------------------------------------------
  // Execução
  // ---------------------------------------------------------------------------
  class BreakSig {}
  class ContinueSig {}
  class ReturnSig { constructor(value) { this.value = value; } }

  const naoFez = (name, line) =>
    new FogeErro(`A senhora nunca fez "${name}". Declare antes com "A SENHORA FEZ ${name}"`, line);

  class Env {
    constructor(parent) { this.vars = new Map(); this.parent = parent || null; }
    declare(name, value, line) {
      if (this.vars.has(name)) throw new FogeErro(`A senhora já fez "${name}" neste bloco. Não dá para declarar de novo`, line);
      this.vars.set(name, value);
    }
    find(name) {
      for (let e = this; e; e = e.parent) if (e.vars.has(name)) return e;
      return null;
    }
    get(name, line) {
      const e = this.find(name);
      if (!e) throw naoFez(name, line);
      return e.vars.get(name);
    }
    set(name, value, line) {
      const e = this.find(name);
      if (!e) throw naoFez(name, line);
      e.vars.set(name, value);
    }
  }

  function tipo(v) {
    if (typeof v === 'number') return 'número';
    if (typeof v === 'string') return 'texto';
    if (typeof v === 'boolean') return 'booleano';
    if (Array.isArray(v)) return 'lista';
    return 'nada';
  }

  function fmt(v, nested) {
    if (typeof v === 'string') return nested ? JSON.stringify(v) : v;
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(parseFloat(v.toPrecision(12)));
    if (typeof v === 'boolean') return v ? KW_PHRASE.TRUE : KW_PHRASE.FALSE;
    if (Array.isArray(v)) return '[' + v.map((x) => fmt(x, true)).join(', ') + ']';
    return 'nada';
  }

  function fatal(msg, line) {
    const e = new FogeErro(msg, line);
    e.fatal = true;
    return e;
  }

  const MAX_STEPS = 5000000;
  const MAX_DEPTH = 300;

  class Interp {
    constructor(io) {
      this.io = io;
      this.steps = 0;
      this.depth = 0;
      this.funcs = new Map();
      this.globals = new Env(null);
      const num = (x, nome, line) => {
        const n = typeof x === 'number' ? x : Number(String(x).trim().replace(',', '.'));
        if (typeof x === 'boolean' || x === undefined || Array.isArray(x) || String(x).trim() === '' || Number.isNaN(n)) {
          throw new FogeErro(`${nome}: não dá para transformar ${fmt(x, true)} em número`, line);
        }
        return n;
      };
      this.builtins = {
        TAMANHO: (args, line) => {
          const [x] = args;
          if (typeof x !== 'string' && !Array.isArray(x)) throw new FogeErro(`TAMANHO só funciona com texto ou lista, e recebeu ${tipo(x)}`, line);
          return x.length;
        },
        NUMERO: (args, line) => num(args[0], 'NUMERO', line),
        INTEIRO: (args, line) => Math.trunc(num(args[0], 'INTEIRO', line)),
        TEXTO: (args) => fmt(args[0]),
        ALEATORIO: (args, line) => {
          const a = Math.ceil(num(args[0], 'ALEATORIO', line));
          const b = Math.floor(num(args[1], 'ALEATORIO', line));
          if (b < a) throw new FogeErro('ALEATORIO: o mínimo é maior que o máximo', line);
          return a + Math.floor(Math.random() * (b - a + 1));
        },
      };
      this.arity = { TAMANHO: 1, NUMERO: 1, INTEIRO: 1, TEXTO: 1, ALEATORIO: 2 };
    }

    tick(line) {
      if (++this.steps > MAX_STEPS) {
        throw fatal('A senhora correu demais! O programa passou de 5 milhões de passos. Será um laço infinito?', line);
      }
    }

    run(ast) {
      for (const f of ast.funcs) {
        if (this.funcs.has(f.name)) throw new FogeErro(`A função "${f.name}" foi declarada duas vezes`, f.line);
        if (this.builtins[f.name]) throw new FogeErro(`"${f.name}" já é uma função pronta da linguagem. Escolha outro nome`, f.line);
        this.funcs.set(f.name, f);
      }
      for (const g of ast.globals) this.exec(g, this.globals);
      try {
        this.block(ast.main.body, new Env(this.globals));
      } catch (e) {
        if (!(e instanceof ReturnSig)) throw e;
      }
    }

    block(stmts, env) {
      for (const s of stmts) {
        this.tick(s.line);
        this.exec(s, env);
      }
    }

    loopBody(body, env) {
      try {
        this.block(body, new Env(env));
      } catch (e) {
        if (e instanceof BreakSig) return 'break';
        if (e instanceof ContinueSig) return 'continue';
        throw e;
      }
      return null;
    }

    exec(s, env) {
      switch (s.type) {
        case 'Var':
          for (const d of s.decls) env.declare(d.name, d.init ? this.eval(d.init, env) : undefined, d.line);
          return;
        case 'Print':
          this.io.write(s.args.map((a) => fmt(this.eval(a, env))).join(' ') + '\n');
          return;
        case 'Input':
          for (const t of s.targets) {
            env.get(t.name, t.line);
            const line = this.io.readLine();
            if (line === null || line === undefined) {
              throw new FogeErro('A senhora não quer conversar: a Entrada acabou. Coloque mais valores na caixa de Entrada (um por linha)', s.line);
            }
            const v = /^\s*-?\d+([.,]\d+)?\s*$/.test(line) ? Number(line.trim().replace(',', '.')) : line;
            env.set(t.name, v, t.line);
          }
          return;
        case 'If':
          for (const b of s.branches) {
            if (this.eval(b.cond, env)) { this.block(b.body, new Env(env)); return; }
          }
          if (s.elseBody) this.block(s.elseBody, new Env(env));
          return;
        case 'While':
          while (this.eval(s.cond, env)) {
            this.tick(s.line);
            if (this.loopBody(s.body, env) === 'break') break;
          }
          return;
        case 'For': {
          const fenv = new Env(env);
          if (s.init) this.exec(s.init, fenv);
          while (!s.cond || this.eval(s.cond, fenv)) {
            this.tick(s.line);
            if (this.loopBody(s.body, fenv) === 'break') break;
            if (s.step) this.eval(s.step, fenv);
          }
          return;
        }
        case 'Break': throw new BreakSig();
        case 'Continue': throw new ContinueSig();
        case 'Return': throw new ReturnSig(s.expr ? this.eval(s.expr, env) : undefined);
        case 'Try':
          try {
            this.block(s.body, new Env(env));
          } catch (e) {
            if (!(e instanceof FogeErro) || e.fatal) throw e;
            const cenv = new Env(env);
            if (s.errName) cenv.declare(s.errName, e.lancado ? e.valor : e.message, s.line);
            this.block(s.catchBody, cenv);
          }
          return;
        case 'Throw': {
          const v = this.eval(s.expr, env);
          const e = new FogeErro(`Me deixa em paz! ${fmt(v)}`, s.line);
          e.lancado = true;
          e.valor = v;
          throw e;
        }
        case 'Expr':
          this.eval(s.expr, env);
          return;
        default:
          throw new Error('Comando desconhecido: ' + s.type);
      }
    }

    eval(e, env) {
      switch (e.type) {
        case 'Lit': return e.value;
        case 'Ident': return env.get(e.name, e.line);
        case 'List': return e.items.map((x) => this.eval(x, env));
        case 'Unary': {
          const v = this.eval(e.arg, env);
          if (e.op === '!') return !v;
          if (typeof v !== 'number') throw new FogeErro(`Não dá para usar "-" em ${tipo(v)}`, e.line);
          return -v;
        }
        case 'Logical': {
          const l = !!this.eval(e.left, env);
          if (e.op === '&&') return l ? !!this.eval(e.right, env) : false;
          return l ? true : !!this.eval(e.right, env);
        }
        case 'Binary':
          return this.binary(e.op, this.eval(e.left, env), this.eval(e.right, env), e.line);
        case 'Assign': {
          let v = this.eval(e.value, env);
          if (e.op !== '=') v = this.binary(e.op[0], this.eval(e.target, env), v, e.line);
          this.store(e.target, v, env);
          return v;
        }
        case 'Update': {
          const cur = this.eval(e.target, env);
          if (typeof cur !== 'number') throw new FogeErro(`"${e.op}" só funciona com número, e a variável tem ${tipo(cur)}`, e.line);
          const nv = e.op === '++' ? cur + 1 : cur - 1;
          this.store(e.target, nv, env);
          return e.prefix ? nv : cur;
        }
        case 'Index': {
          const obj = this.eval(e.obj, env);
          const i = this.index(obj, this.eval(e.index, env), e.line);
          if (i >= obj.length) throw new FogeErro(`A posição ${i} não existe: só tem ${obj.length} ${Array.isArray(obj) ? 'itens' : 'letras'} (começa do 0)`, e.line);
          return obj[i];
        }
        case 'Call': return this.call(e, env);
        default:
          throw new Error('Expressão desconhecida: ' + e.type);
      }
    }

    index(obj, i, line) {
      if (typeof obj !== 'string' && !Array.isArray(obj)) throw new FogeErro(`Só dá para usar [ ] em lista ou texto, e isso é ${tipo(obj)}`, line);
      if (typeof i !== 'number' || !Number.isInteger(i) || i < 0) throw new FogeErro(`Posição inválida: ${fmt(i, true)}. Use um número inteiro a partir de 0`, line);
      return i;
    }

    store(target, v, env) {
      if (target.type === 'Ident') { env.set(target.name, v, target.line); return; }
      const obj = this.eval(target.obj, env);
      if (!Array.isArray(obj)) throw new FogeErro('Só dá para trocar posições de uma lista (texto não pode ser alterado)', target.line);
      const i = this.index(obj, this.eval(target.index, env), target.line);
      if (i > obj.length) throw new FogeErro(`A posição ${i} não existe. A lista tem ${obj.length} itens, então dá para usar até a posição ${obj.length} (que adiciona no final)`, target.line);
      obj[i] = v;
    }

    binary(op, l, r, line) {
      switch (op) {
        case '+':
          if (typeof l === 'string' || typeof r === 'string') return fmt(l) + fmt(r);
          if (typeof l === 'number' && typeof r === 'number') return l + r;
          if (Array.isArray(l) && Array.isArray(r)) return l.concat(r);
          throw new FogeErro(`Não dá para somar ${tipo(l)} com ${tipo(r)}`, line);
        case '-': case '*': case '/': case '%':
          if (typeof l !== 'number' || typeof r !== 'number') {
            throw new FogeErro(`A conta "${op}" só funciona com números, e recebeu ${tipo(l)} e ${tipo(r)}`, line);
          }
          if ((op === '/' || op === '%') && r === 0) throw new FogeErro('Divisão por zero! Nem a Assembleia aprova isso', line);
          return op === '-' ? l - r : op === '*' ? l * r : op === '/' ? l / r : l % r;
        case '==': return l === r;
        case '!=': return l !== r;
        default:
          if (!((typeof l === 'number' && typeof r === 'number') || (typeof l === 'string' && typeof r === 'string'))) {
            throw new FogeErro(`Não dá para comparar ${tipo(l)} com ${tipo(r)} usando "${op}"`, line);
          }
          return op === '<' ? l < r : op === '>' ? l > r : op === '<=' ? l <= r : l >= r;
      }
    }

    call(e, env) {
      const args = e.args.map((a) => this.eval(a, env));
      const b = this.builtins[e.name];
      if (b) {
        if (args.length !== this.arity[e.name]) {
          throw new FogeErro(`${e.name} espera ${this.arity[e.name]} valor(es), mas recebeu ${args.length}`, e.line);
        }
        return b(args, e.line);
      }
      const f = this.funcs.get(e.name);
      if (!f) throw new FogeErro(`A senhora não conhece a função "${e.name}". Declare com "${KW_PHRASE.FUNC} ${e.name}(...)"`, e.line);
      if (args.length !== f.params.length) {
        throw new FogeErro(`A função "${e.name}" espera ${f.params.length} valor(es), mas recebeu ${args.length}`, e.line);
      }
      if (++this.depth > MAX_DEPTH) {
        this.depth = 0;
        throw fatal(`A senhora entrou em mais de ${MAX_DEPTH} chamadas sem voltar. Recursão infinita?`, e.line);
      }
      const fenv = new Env(this.globals);
      f.params.forEach((p, i) => fenv.declare(p, args[i], f.line));
      try {
        this.block(f.body, fenv);
      } catch (sig) {
        if (sig instanceof ReturnSig) return sig.value;
        throw sig;
      } finally {
        if (this.depth > 0) this.depth--;
      }
      return undefined;
    }
  }

  /**
   * Executa um programa FogeScript.
   * opts.input   texto da caixa de Entrada (um valor por linha)
   * opts.prompt  função chamada quando a Entrada acaba (ex.: window.prompt)
   * opts.onOutput(texto) recebe cada linha impressa
   * Retorna { ok, output, error?, linha? }
   */
  function run(src, opts) {
    opts = opts || {};
    const out = [];
    const lines = (opts.input || '').split(/\r?\n/);
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    let ptr = 0;
    const io = {
      write(s) {
        out.push(s);
        if (opts.onOutput) opts.onOutput(s);
      },
      readLine() {
        if (ptr < lines.length) return lines[ptr++];
        if (opts.prompt) {
          const r = opts.prompt();
          if (r !== null && r !== undefined) return String(r);
        }
        return null;
      },
    };
    try {
      const ast = parse(src);
      new Interp(io).run(ast);
      return { ok: true, output: out.join('') };
    } catch (e) {
      if (e instanceof FogeErro) return { ok: false, output: out.join(''), error: e.message, linha: e.linha };
      if (e instanceof RangeError) {
        return { ok: false, output: out.join(''), error: 'A senhora correu tanto que a pilha estourou. Recursão profunda demais?' };
      }
      return { ok: false, output: out.join(''), error: 'Erro interno do interpretador: ' + e.message };
    }
  }

  return { run, parse, tokenize, KEYWORDS, FogeErro, version: '1.0.0' };
});
