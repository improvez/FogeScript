/*
 * FogeScript: a linguagem de programação da senhora que trabalha na Assembleia.
 *
 * Este arquivo é o tradutor inteiro, separado nas etapas de um compilador:
 *
 *   1. Análise léxica     tokenize(codigo)   texto -> lista de tokens
 *   2. Análise sintática  parse(codigo)      tokens -> árvore sintática (AST)
 *   3. Análise semântica  analisar(ast)      confere nomes, escopos e tipos
 *   4. Geração de código  compile(codigo)    AST -> JavaScript
 *
 * Depois das três análises, a AST também pode ser executada direto pelo
 * interpretador (run), sem gerar código. O tradutor de linha de comando, que lê
 * um arquivo .foge e grava o .js, fica em tradutor.js.
 *
 * Funciona no navegador (index.html) e no Node: const FogeScript = require('./fogescript.js');
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FogeScript = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSAO = '1.2.0';

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
    let b = c.normalize('NFD').replace(/[̀-ͯ]/g, '');
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

  // Todo erro do FogeScript diz em que etapa aconteceu, a linha e, quando dá
  // para saber, a coluna.
  class FogeErro extends Error {
    constructor(mensagem, linha, coluna, fase) {
      super(mensagem);
      this.name = 'FogeErro';
      this.linha = linha;
      this.coluna = coluna;
      this.fase = fase || 'execução';
    }
  }
  const NOME_FASE = {
    'léxico': 'Erro léxico',
    'sintático': 'Erro sintático',
    'semântico': 'Erro semântico',
    'execução': 'Erro de execução',
  };

  const MAX_STEPS = 5000000;
  const MAX_DEPTH = 300;
  // Configuração do runtime (veja criarRuntime, mais abaixo).
  const CONFIG = {
    verdadeiro: KW_PHRASE.TRUE,
    falso: KW_PHRASE.FALSE,
    fraseFuncao: KW_PHRASE.FUNC,
    maxPassos: MAX_STEPS,
    maxProfundidade: MAX_DEPTH,
    semEntrada: 'A senhora não quer conversar: a Entrada acabou. Coloque mais valores na caixa de Entrada (um por linha)',
  };
  // As regras de tipo e as funções prontas. O analisador semântico, o
  // interpretador e o código gerado usam todos as mesmas.
  const REGRAS = criarRuntime(null, FogeErro, CONFIG);
  const tipo = REGRAS.tipo;
  const fmt = REGRAS.fmt;

  // ---------------------------------------------------------------------------
  // 1. Análise léxica
  // ---------------------------------------------------------------------------
  // Lê o texto da esquerda para a direita e separa os tokens: palavras-chave,
  // nomes, números, textos, operadores e delimitadores. Espaços e comentários
  // são descartados. Cada token guarda a linha e a coluna onde começa.
  const OPS2 = ['==', '!=', '<=', '>=', '&&', '||', '++', '--', '+=', '-=', '*=', '/=', '%='];
  const OPS1 = '+-*/%<>=!(),;[]';
  const DELIMITADORES = ['(', ')', '[', ']', ',', ';'];
  const IDENT_START = /[\p{L}_]/u;
  const IDENT_PART = /[\p{L}\p{N}_]/u;
  // Dicas para os símbolos que mais aparecem por engano.
  const DICA_SIMBOLO = {
    '&': 'Para "e" use "&&"',
    '|': 'Para "ou" use "||"',
    '{': 'Os blocos do FogeScript não usam chaves: eles terminam com FUGIU',
    '}': 'Os blocos do FogeScript não usam chaves: eles terminam com FUGIU',
    '.': 'Número com casas decimais usa ponto entre dígitos, como 3.5',
  };

  function tokenize(src, tolerant) {
    const norm = normalize(src);
    const toks = [];
    const n = src.length;
    let i = 0;
    let line = 1;
    let lineStart = 0; // onde a linha atual começa, para calcular a coluna
    const push = (type, value, start, end, l, col) => toks.push({ type, value, start, end, line: l, col });
    const erro = (msg, l, col) => new FogeErro(msg, l, col, 'léxico');
    // Conta as quebras de linha de um trecho já lido (comentário ou palavra-chave).
    const avancarLinhas = (from, to) => {
      for (let k = from; k < to; k++) {
        if (src[k] === '\n') { line++; lineStart = k + 1; }
      }
    };

    while (i < n) {
      const c = src[i];
      if (c === '\n') { line++; i++; lineStart = i; continue; }
      if (/\s/.test(c)) { i++; continue; }
      const l = line;
      const col = i - lineStart + 1;

      // comentários
      if (c === '/' && src[i + 1] === '/') {
        let j = src.indexOf('\n', i);
        if (j < 0) j = n;
        if (tolerant) push('comment', src.slice(i, j), i, j, l, col);
        i = j;
        continue;
      }
      if (c === '/' && src[i + 1] === '*') {
        let j = src.indexOf('*/', i + 2);
        if (j < 0) {
          if (!tolerant) throw erro('Comentário /* aberto e nunca fechado: faltou o */', l, col);
          j = n;
        } else j += 2;
        if (tolerant) push('comment', src.slice(i, j), i, j, l, col);
        avancarLinhas(i, j);
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
          if (!tolerant) throw erro(`Texto sem as aspas de fechamento: faltou um ${c} antes do fim da linha`, l, col);
          push('str', val, i, j, l, col);
          i = j;
          continue;
        }
        push('str', val, i, j + 1, l, col);
        i = j + 1;
        continue;
      }

      // números
      if (/\d/.test(c)) {
        const m = /\d+(\.\d+)?/y;
        m.lastIndex = i;
        const r = m.exec(src);
        const end = i + r[0].length;
        if (end < n && IDENT_START.test(src[end])) {
          // número grudado em letras, como "2dias"
          let j = end;
          while (j < n && IDENT_PART.test(src[j])) j++;
          if (!tolerant) {
            throw erro(`"${src.slice(i, j)}" não é número nem nome: um nome não pode começar com número`, l, col);
          }
          push('error', src.slice(i, j), i, j, l, col);
          i = j;
          continue;
        }
        push('num', parseFloat(r[0]), i, end, l, col);
        i = end;
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
          push('kw', best.name, i, i + bestLen, l, col);
          avancarLinhas(i, i + bestLen);
          i += bestLen;
          continue;
        }
        let j = i + 1;
        while (j < n && IDENT_PART.test(src[j])) j++;
        push('ident', src.slice(i, j), i, j, l, col);
        i = j;
        continue;
      }

      // operadores e delimitadores
      const two = src.substr(i, 2);
      if (OPS2.includes(two)) { push('op', two, i, i + 2, l, col); i += 2; continue; }
      if (OPS1.includes(c)) { push('op', c, i, i + 1, l, col); i++; continue; }

      const ch = String.fromCodePoint(src.codePointAt(i));
      if (!tolerant) {
        const dica = DICA_SIMBOLO[ch];
        throw erro(`Símbolo estranho "${ch}"${dica ? '. ' + dica : ': ele não faz parte da linguagem'}`, l, col);
      }
      push('error', ch, i, i + ch.length, l, col);
      i += ch.length;
    }
    push('eof', null, n, n, line, n - lineStart + 1);
    return toks;
  }

  // ---------------------------------------------------------------------------
  // 2. Análise sintática
  // ---------------------------------------------------------------------------
  // Analisador descendente recursivo: cada regra da gramática (veja
  // docs/especificacao.html) virou uma função parseX que consome os tokens e
  // devolve um nó da árvore sintática abstrata (AST). Cada nó é um objeto com
  // "type", a linha e a coluna de onde veio.
  function parse(src) {
    const toks = tokenize(src, false);
    let p = 0;
    const peek = () => toks[p];
    const next = () => toks[p++];
    const isKw = (name) => peek().type === 'kw' && peek().value === name;
    const isOp = (v) => peek().type === 'op' && peek().value === v;
    const isKwIn = (names) => peek().type === 'kw' && names.includes(peek().value);
    const erro = (msg, t) => new FogeErro(msg, t.line, t.col, 'sintático');
    const pos = (t) => ({ line: t.line, col: t.col });

    // Quando falta alguma coisa e o próximo token já está na linha de baixo,
    // o erro aponta para o fim do token anterior, que é onde ela faltou.
    function onde(t) {
      const ant = toks[p - 1];
      if (ant && t.line > ant.line && !src.slice(ant.start, ant.end).includes('\n')) {
        return { line: ant.line, col: ant.col + (ant.end - ant.start) };
      }
      return t;
    }
    function desc(t) {
      if (t.type === 'eof') return 'o fim do código';
      if (t.type === 'kw') return `"${KW_PHRASE[t.value]}"`;
      if (t.type === 'str') return `o texto "${t.value}"`;
      return `"${t.value}"`;
    }
    function expectOp(v, ctx) {
      if (!isOp(v)) {
        throw erro(`Esperava "${v}"${ctx ? ' ' + ctx : ''}, mas veio ${desc(peek())}`, onde(peek()));
      }
      return next();
    }
    function expectIdent(ctx) {
      const t = peek();
      if (t.type === 'kw') {
        // ex.: "A SENHORA FEZ fugiu = 1": as palavras-chave valem em minúsculas também
        throw erro(`Esperava um nome ${ctx}, mas "${src.slice(t.start, t.end)}" é a palavra reservada ${desc(t)} e não pode ser usada como nome`, t);
      }
      if (t.type !== 'ident') throw erro(`Esperava um nome ${ctx}, mas veio ${desc(t)}`, onde(t));
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

    // programa = { funcao | declaracao } , inicio , { funcao | declaracao } ;
    function parseProgram() {
      const funcs = [];
      const globals = [];
      let main = null;
      while (peek().type !== 'eof') {
        const t = peek();
        if (isKw('FUNC')) funcs.push(parseFunc());
        else if (isKw('VAR')) globals.push(parseVar());
        else if (isKw('INICIO')) {
          if (main) throw erro('Só pode existir uma Assembleia: o programa tem dois "A SENHORA TRABALHA NA ASSEMBLEIA?"', t);
          next();
          const body = parseBlock(t, ['FIM']);
          next();
          main = { body, ...pos(t) };
        } else if (isKw('FIM')) {
          throw erro('"FUGIU" sobrando: não há nenhum bloco aberto para fechar', t);
        } else {
          throw erro(
            `Código fora da Assembleia (${desc(t)}). Coloque-o entre "${KW_PHRASE.INICIO}" e "FUGIU". Fora dela só podem ficar funções e variáveis globais`,
            t
          );
        }
      }
      if (!main) throw erro(`Cadê a Assembleia? Todo programa precisa de um "${KW_PHRASE.INICIO}" ... "FUGIU"`, { line: 1, col: 1 });
      return { type: 'Programa', funcs, globals, main };
    }

    // bloco = { comando } ;   (quem chama confere o FUGIU que fecha)
    function parseBlock(openTok, terms) {
      const body = [];
      for (;;) {
        const t = peek();
        if (t.type === 'eof') {
          throw erro(`Faltou o "FUGIU" para fechar o ${desc(openTok)} da linha ${openTok.line}`, onde(t));
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

    // declaracao = "A SENHORA FEZ" , item , { "," , item } , [ ";" ] ;
    function parseVarDecls() {
      const t = next();
      const decls = list(null, () => {
        const id = expectIdent('para a variável');
        let init = null;
        if (isOp('=')) { next(); init = parseExpr(); }
        return { name: id.value, init, ...pos(id) };
      });
      return { type: 'Var', decls, ...pos(t) };
    }
    function parseVar() {
      const v = parseVarDecls();
      optSemi();
      return v;
    }

    // funcao = "NÃO, EU NUNCA FIZ ISSO" , NOME , "(" , [ parametros ] , ")" , bloco , "FUGIU" ;
    function parseFunc() {
      const t = next();
      const name = expectIdent('para a função');
      expectOp('(', `depois do nome da função "${name.value}"`);
      const paramToks = list(')', () => expectIdent('de parâmetro'));
      expectOp(')', 'para fechar os parâmetros');
      const seen = new Set();
      for (const prm of paramToks) {
        if (seen.has(prm.value)) throw erro(`Parâmetro "${prm.value}" repetido na função "${name.value}"`, prm);
        seen.add(prm.value);
      }
      const body = parseBlock(t, ['FIM']);
      next();
      return { type: 'Func', name: name.value, params: paramToks.map((x) => x.value), paramPos: paramToks.map(pos), body, ...pos(t) };
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
          throw erro(`Depois do "${KW_PHRASE.ELSE}" só pode vir "FUGIU"`, peek());
        }
      }
      next();
      return { type: 'If', branches, elseBody, ...pos(t) };
    }

    function parseLoopBody(t) {
      const body = parseBlock(t, ['FIM']);
      next();
      return body;
    }

    function parseFor() {
      const t = next();
      expectOp('(', `depois de ${desc(t)}`);
      let init = null;
      if (!isOp(';')) init = isKw('VAR') ? parseVarDecls() : { type: 'Expr', expr: parseExpr(), ...pos(t) };
      expectOp(';', 'depois do início do laço');
      const cond = isOp(';') ? null : parseExpr();
      expectOp(';', 'depois da condição do laço');
      const step = isOp(')') ? null : parseExpr();
      expectOp(')', 'para fechar o laço');
      const body = parseLoopBody(t);
      return { type: 'For', init, cond, step, body, ...pos(t) };
    }

    function parseTry() {
      const t = next();
      const body = parseBlock(t, ['CATCH', 'FIM']);
      if (!isKw('CATCH')) {
        throw erro(`"${KW_PHRASE.TRY}" precisa de um "${KW_PHRASE.CATCH}" para tratar o erro`, peek());
      }
      next();
      let errName = null;
      let errPos = null;
      if (isOp('(')) {
        next();
        const id = expectIdent('para guardar o erro');
        errName = id.value;
        errPos = pos(id);
        expectOp(')');
      }
      const catchBody = parseBlock(t, ['FIM']);
      next();
      return { type: 'Try', body, errName, errPos, catchBody, ...pos(t) };
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
            return { type: 'Print', args, ...pos(t) };
          }
          case 'INPUT': {
            next();
            expectOp('(', `depois de "${KW_PHRASE.INPUT}"`);
            const targets = list(')', () => {
              const id = expectIdent('de variável para guardar a resposta');
              return { name: id.value, ...pos(id) };
            });
            if (!targets.length) throw erro('Diga em qual variável guardar a resposta', t);
            expectOp(')');
            optSemi();
            return { type: 'Input', targets, ...pos(t) };
          }
          case 'IF': return parseIf();
          case 'WHILE': {
            next();
            const cond = parseCond(t);
            return { type: 'While', cond, body: parseLoopBody(t), ...pos(t) };
          }
          case 'FOR': return parseFor();
          case 'BREAK':
          case 'CONTINUE':
            // estar dentro de um laço é conferido na análise semântica
            next();
            optSemi();
            return { type: t.value === 'BREAK' ? 'Break' : 'Continue', ...pos(t) };
          case 'RETURN': {
            next();
            let expr = null;
            const nt = peek();
            if (!isOp(';') && nt.type !== 'eof' && nt.line === t.line && !isKwIn(['FIM', 'ELSE', 'ELSEIF', 'CATCH'])) {
              expr = parseExpr();
            }
            optSemi();
            return { type: 'Return', expr, ...pos(t) };
          }
          case 'TRY': return parseTry();
          case 'THROW': {
            next();
            const expr = parseExpr();
            optSemi();
            return { type: 'Throw', expr, ...pos(t) };
          }
          case 'FUNC':
            throw erro('Funções devem ser declaradas fora da Assembleia e fora de outras funções', t);
          case 'INICIO':
            throw erro('A Assembleia não pode ficar dentro de outro bloco', t);
          case 'ELSE':
          case 'ELSEIF':
            throw erro(`${desc(t)} sem um "${KW_PHRASE.IF}" antes`, t);
          case 'CATCH':
            throw erro(`${desc(t)} sem um "${KW_PHRASE.TRY}" antes`, t);
          default:
            break;
        }
      }
      const expr = parseExpr();
      optSemi();
      return { type: 'Expr', expr, ...pos(t) };
    }

    // expressões, da menor para a maior precedência
    function parseExpr() {
      const left = parseBinary(0);
      if (peek().type === 'op' && ['=', '+=', '-=', '*=', '/=', '%='].includes(peek().value)) {
        const op = next();
        if (left.type !== 'Ident' && left.type !== 'Index') {
          throw erro('Só dá para guardar valor em uma variável ou numa posição de lista', op);
        }
        return { type: 'Assign', op: op.value, target: left, value: parseExpr(), ...pos(op) };
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
        left = { type: level < 2 ? 'Logical' : 'Binary', op: op.value, left, right, ...pos(op) };
      }
      return left;
    }

    function checkTarget(e, op) {
      if (e.type !== 'Ident' && e.type !== 'Index') {
        throw erro(`"${op.value}" só funciona em variáveis`, op);
      }
    }

    function parseUnary() {
      if (isOp('!') || isOp('-')) {
        const op = next();
        return { type: 'Unary', op: op.value, arg: parseUnary(), ...pos(op) };
      }
      if (isOp('++') || isOp('--')) {
        const op = next();
        const target = parseUnary();
        checkTarget(target, op);
        return { type: 'Update', op: op.value, prefix: true, target, ...pos(op) };
      }
      let e = parsePrimary();
      for (;;) {
        if (isOp('[')) {
          const t = next();
          const index = parseExpr();
          expectOp(']', 'para fechar a posição da lista');
          e = { type: 'Index', obj: e, index, ...pos(t) };
        } else if (isOp('++') || isOp('--')) {
          const op = next();
          checkTarget(e, op);
          e = { type: 'Update', op: op.value, prefix: false, target: e, ...pos(op) };
        } else return e;
      }
    }

    function parseCall(nameTok) {
      expectOp('(', `depois do nome da função "${nameTok.value}"`);
      const args = list(')', parseExpr);
      expectOp(')', 'para fechar a chamada');
      return { type: 'Call', name: nameTok.value, args, ...pos(nameTok) };
    }

    function parsePrimary() {
      const t = peek();
      if (t.type === 'num' || t.type === 'str') { next(); return { type: 'Lit', value: t.value, ...pos(t) }; }
      if (t.type === 'ident') {
        next();
        if (isOp('(')) return parseCall(t);
        return { type: 'Ident', name: t.value, ...pos(t) };
      }
      if (t.type === 'kw') {
        if (t.value === 'TRUE' || t.value === 'FALSE') { next(); return { type: 'Lit', value: t.value === 'TRUE', ...pos(t) }; }
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
        return { type: 'List', items, ...pos(t) };
      }
      throw erro(`Esperava um valor, mas veio ${desc(t)}`, onde(t));
    }

    return parseProgram();
  }

  // ---------------------------------------------------------------------------
  // 3. Análise semântica
  // ---------------------------------------------------------------------------
  // Percorre a AST antes de rodar ou traduzir o programa e confere o que a
  // gramática sozinha não enxerga:
  //   - todo nome usado foi declarado antes, num escopo visível;
  //   - nenhum nome foi declarado duas vezes no mesmo bloco;
  //   - toda função chamada existe e recebe o número certo de valores;
  //   - VOLTA AQUI! e DEIXA ELA CORRER só aparecem dentro de laços;
  //   - os tipos combinam nas contas, comparações, posições de lista e funções prontas.
  //
  // O FogeScript não pede o tipo na declaração, então o analisador deduz o tipo
  // de cada variável olhando todos os valores que ela recebe no programa
  // (inferência de tipos). Se todos são do mesmo tipo, a variável tem esse tipo.
  // Se ela recebe tipos diferentes, ou valores da Entrada, o tipo fica
  // desconhecido ("?") e a conferência fica para a hora de rodar.
  //
  // No fim, cada expressão da AST ganha o campo "tipo", que o gerador de código
  // usa para escolher entre o operador do JavaScript e o runtime.

  const DESCONHECIDO = '?';
  const SEM_INFO = '⊥'; // só durante a inferência: a variável ainda não recebeu nenhum valor analisado
  const conhecido = (t) => t !== DESCONHECIDO && t !== SEM_INFO;
  const TIPO_PRONTA = Object.assign(Object.create(null), {
    TAMANHO: 'número', NUMERO: 'número', INTEIRO: 'número', TEXTO: 'texto', ALEATORIO: 'número',
  });
  const CONTAS = ['-', '*', '/', '%'];
  const ORDEM = ['<', '>', '<=', '>='];

  // Distância de edição, para sugerir o nome certo quando alguém erra a digitação.
  function distancia(a, b) {
    let ant = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(ant[j] + 1, cur[j - 1] + 1, ant[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      ant = cur;
    }
    return ant[b.length];
  }
  function parecido(nome, nomes) {
    const baixo = nome.toLowerCase();
    let melhor = null;
    let menor = Infinity;
    for (const n of nomes) {
      if (n === nome) continue;
      if (n.toLowerCase() === baixo) return n;
      const d = distancia(baixo, n.toLowerCase());
      if (d < menor) { menor = d; melhor = n; }
    }
    return menor <= (nome.length > 4 ? 2 : 1) ? melhor : null;
  }

  // Valor de uma expressão constante simples (5, -5, "abc", TÁ GRAVADO).
  function constante(e) {
    if (e.type === 'Lit') return e.value;
    if (e.type === 'Unary' && e.op === '-' && e.arg.type === 'Lit' && typeof e.arg.value === 'number') return -e.arg.value;
    return undefined;
  }

  // A conta com certeza dá erro com esses tipos? (só responde "dá erro" quando
  // os tipos conhecidos garantem; com tipo desconhecido, deixa para a execução)
  function contaValida(op, a, b) {
    if (op === '+') {
      if (!conhecido(a) || !conhecido(b)) return true;
      return a === 'texto' || b === 'texto' || (a === b && (a === 'número' || a === 'lista'));
    }
    if (CONTAS.includes(op)) return !(conhecido(a) && a !== 'número') && !(conhecido(b) && b !== 'número');
    if (ORDEM.includes(op)) {
      const ok = (t) => !conhecido(t) || t === 'número' || t === 'texto';
      return ok(a) && ok(b) && !(conhecido(a) && conhecido(b) && a !== b);
    }
    return true; // == e != comparam qualquer coisa
  }

  // Tipo do resultado de uma conta, se ela não der erro.
  function tipoConta(op, a, b) {
    if (op === '+' && (a === 'texto' || b === 'texto')) return 'texto';
    if (a === SEM_INFO || b === SEM_INFO) return SEM_INFO;
    if (!contaValida(op, a, b)) return SEM_INFO; // a conta para o programa: não chega a produzir valor
    if (op === '+') return a === b && conhecido(a) ? a : DESCONHECIDO;
    if (CONTAS.includes(op)) return 'número';
    return 'booleano';
  }

  function analisar(ast) {
    const erros = [];
    const avisos = [];
    const erro = (msg, no) => erros.push(new FogeErro(msg, no.line, no.col, 'semântico'));
    const aviso = (msg, no) => avisos.push({ mensagem: msg, linha: no.line, coluna: no.col });
    const aridade = REGRAS.aridade;
    const simbolos = [];
    const valores = []; // [símbolo, função que dá o tipo de um valor que ele recebe]

    // ---- funções: todas ficam visíveis no programa inteiro ----
    const funcoes = new Map();
    for (const f of ast.funcs) {
      if (funcoes.has(f.name)) {
        erro(`A função "${f.name}" foi declarada duas vezes (a primeira está na linha ${funcoes.get(f.name).line})`, f);
      } else if (aridade[f.name] !== undefined) {
        erro(`"${f.name}" já é uma função pronta da linguagem. Escolha outro nome`, f);
      } else funcoes.set(f.name, f);
    }

    // ---- escopos: as mesmas regras da classe Env do interpretador ----
    const escopo = (pai, nome) => ({ vars: new Map(), pai, nome });
    const bloco = (pai, no) => escopo(pai, `bloco da linha ${no.line}`);
    function achar(sc, nome) {
      for (let s = sc; s; s = s.pai) if (s.vars.has(nome)) return s.vars.get(nome);
      return null;
    }
    function visiveis(sc) {
      const nomes = new Set();
      for (let s = sc; s; s = s.pai) for (const k of s.vars.keys()) nomes.add(k);
      return [...nomes];
    }
    function declarar(sc, nome, no, especie) {
      const ja = sc.vars.get(nome);
      if (ja) {
        erro(`A senhora já fez "${nome}" neste bloco (na linha ${ja.linha}). Não dá para declarar de novo`, no);
        return ja;
      }
      const sym = { nome, linha: no.line, coluna: no.col, escopo: sc.nome, especie, tipos: new Set(), lida: false };
      sc.vars.set(nome, sym);
      simbolos.push(sym);
      return sym;
    }
    function usar(no, sc, leitura) {
      const sym = achar(sc, no.name);
      if (!sym) {
        if (funcoes.has(no.name) || aridade[no.name] !== undefined) {
          erro(`"${no.name}" é uma função, não uma variável. Para chamar, use ${no.name}(...)`, no);
        } else {
          const s = parecido(no.name, visiveis(sc));
          erro(`A senhora nunca fez "${no.name}". Declare antes com "A SENHORA FEZ ${no.name}"${s ? `. Você quis dizer "${s}"?` : ''}`, no);
        }
        return null;
      }
      if (leitura) sym.lida = true;
      no.sym = sym;
      return sym;
    }

    // ---- primeira passada: nomes, escopos e valores de cada variável ----
    function comandos(lista, sc, ctx) {
      for (const s of lista) comando(s, sc, ctx);
    }
    function comando(s, sc, ctx) {
      switch (s.type) {
        case 'Var':
          for (const d of s.decls) {
            if (d.init) expr(d.init, sc); // o valor é analisado antes do nome existir, como no interpretador
            const sym = declarar(sc, d.name, d, 'variável');
            d.sym = sym;
            valores.push([sym, d.init ? () => tipoDe(d.init) : () => 'nada']);
          }
          return;
        case 'Print':
          for (const a of s.args) expr(a, sc);
          return;
        case 'Input':
          for (const t of s.targets) {
            const sym = usar(t, sc, false);
            if (sym) valores.push([sym, () => DESCONHECIDO]); // número ou texto: depende do que for digitado
          }
          return;
        case 'If':
          for (const b of s.branches) {
            expr(b.cond, sc);
            comandos(b.body, bloco(sc, s), ctx);
          }
          if (s.elseBody) comandos(s.elseBody, bloco(sc, s), ctx);
          return;
        case 'While':
          expr(s.cond, sc);
          comandos(s.body, bloco(sc, s), { ...ctx, laco: true });
          return;
        case 'For': {
          const fs = escopo(sc, `laço da linha ${s.line}`);
          if (s.init) comando(s.init, fs, ctx);
          if (s.cond) expr(s.cond, fs);
          if (s.step) expr(s.step, fs);
          comandos(s.body, bloco(fs, s), { ...ctx, laco: true });
          return;
        }
        case 'Break':
        case 'Continue':
          if (!ctx.laco) erro(`"${s.type === 'Break' ? KW_PHRASE.BREAK : KW_PHRASE.CONTINUE}" só pode ser usado dentro de um laço`, s);
          return;
        case 'Return':
          if (s.expr) expr(s.expr, sc);
          return;
        case 'Try': {
          comandos(s.body, bloco(sc, s), ctx);
          const cs = escopo(sc, `A SENHORA TÁ NERVOSA? da linha ${s.line}`);
          if (s.errName) {
            const sym = declarar(cs, s.errName, s.errPos, 'erro capturado');
            valores.push([sym, () => DESCONHECIDO]);
          }
          comandos(s.catchBody, cs, ctx);
          return;
        }
        case 'Throw':
          expr(s.expr, sc);
          return;
        case 'Expr':
          expr(s.expr, sc);
          return;
        default:
          throw new Error('Comando desconhecido: ' + s.type);
      }
    }
    function expr(e, sc) {
      switch (e.type) {
        case 'Lit':
          return;
        case 'Ident':
          usar(e, sc, true);
          return;
        case 'List':
          for (const x of e.items) expr(x, sc);
          return;
        case 'Unary':
          expr(e.arg, sc);
          return;
        case 'Logical':
        case 'Binary':
          expr(e.left, sc);
          expr(e.right, sc);
          return;
        case 'Assign': {
          expr(e.value, sc);
          const t = e.target;
          if (t.type === 'Ident') {
            const sym = usar(t, sc, e.op !== '=');
            if (sym) valores.push([sym, () => tipoDe(e)]);
          } else {
            expr(t.obj, sc);
            expr(t.index, sc);
          }
          return;
        }
        case 'Update': {
          const t = e.target;
          if (t.type === 'Ident') {
            const sym = usar(t, sc, true);
            if (sym) valores.push([sym, () => tipoDe(e)]);
          } else {
            expr(t.obj, sc);
            expr(t.index, sc);
          }
          return;
        }
        case 'Index':
          expr(e.obj, sc);
          expr(e.index, sc);
          return;
        case 'Call': {
          for (const a of e.args) expr(a, sc);
          const pronta = aridade[e.name];
          const f = funcoes.get(e.name);
          if (pronta === undefined && !f) {
            const ehVariavel = achar(sc, e.name);
            const s = ehVariavel ? null : parecido(e.name, [...funcoes.keys(), ...Object.keys(aridade)]);
            erro(`A senhora não conhece a função "${e.name}". Declare com "${KW_PHRASE.FUNC} ${e.name}(...)"` +
              (ehVariavel ? `. "${e.name}" é uma variável, não uma função` : s ? `. Você quis dizer "${s}"?` : ''), e);
            return;
          }
          const n = pronta !== undefined ? pronta : f.params.length;
          if (e.args.length !== n) {
            erro(pronta !== undefined
              ? `${e.name} espera ${n} valor(es), mas recebeu ${e.args.length}`
              : `A função "${e.name}" espera ${n} valor(es), mas recebeu ${e.args.length}`, e);
          }
          return;
        }
        default:
          throw new Error('Expressão desconhecida: ' + e.type);
      }
    }

    // As globais são criadas na ordem: cada valor inicial só enxerga as de cima.
    // As funções e a Assembleia rodam depois, então enxergam todas.
    const globais = escopo(null, 'global');
    for (const g of ast.globals) comando(g, globais, { laco: false });
    for (const f of ast.funcs) {
      const fs = escopo(globais, `função ${f.name}`);
      for (const [i, prm] of f.params.entries()) {
        const sym = declarar(fs, prm, f.paramPos[i], 'parâmetro');
        valores.push([sym, () => DESCONHECIDO]); // pode ser chamada com qualquer tipo
      }
      comandos(f.body, fs, { laco: false });
    }
    comandos(ast.main.body, escopo(globais, 'Assembleia'), { laco: false });

    // ---- inferência de tipos ----
    function tipoSym(sym) {
      if (!sym) return DESCONHECIDO;
      if (sym.tipos.size === 0) return SEM_INFO;
      return sym.tipos.size === 1 ? [...sym.tipos][0] : DESCONHECIDO;
    }
    function tipoDe(e) {
      switch (e.type) {
        case 'Lit': return typeof e.value === 'number' ? 'número' : typeof e.value === 'string' ? 'texto' : 'booleano';
        case 'Ident': return tipoSym(e.sym);
        case 'List': return 'lista';
        case 'Unary': {
          if (e.op === '!') return 'booleano';
          const t = tipoDe(e.arg);
          return t === SEM_INFO || (conhecido(t) && t !== 'número') ? SEM_INFO : 'número';
        }
        case 'Logical': return 'booleano';
        case 'Binary': return tipoConta(e.op, tipoDe(e.left), tipoDe(e.right));
        case 'Assign': return e.op === '=' ? tipoDe(e.value) : tipoConta(e.op[0], tipoDe(e.target), tipoDe(e.value));
        case 'Update': {
          const t = tipoDe(e.target);
          return t === SEM_INFO || (conhecido(t) && t !== 'número') ? SEM_INFO : 'número';
        }
        case 'Index': return tipoDe(e.obj) === 'texto' ? 'texto' : DESCONHECIDO;
        case 'Call': return TIPO_PRONTA[e.name] || DESCONHECIDO;
        default: return DESCONHECIDO;
      }
    }
    // Repete até nenhum tipo mudar (os conjuntos só crescem, então termina).
    for (let mudou = true, voltas = 0; mudou && voltas < 100; voltas++) {
      mudou = false;
      for (const [sym, valor] of valores) {
        const t = valor();
        if (t !== SEM_INFO && !sym.tipos.has(t)) { sym.tipos.add(t); mudou = true; }
      }
    }
    const T = (e) => {
      const t = tipoDe(e);
      return t === SEM_INFO ? DESCONHECIDO : t;
    };

    // ---- segunda passada: tipos ----
    function raizes(s, f) {
      const todos = (lista) => { for (const x of lista) raizes(x, f); };
      switch (s.type) {
        case 'Var': for (const d of s.decls) if (d.init) f(d.init); break;
        case 'Print': s.args.forEach(f); break;
        case 'If':
          for (const b of s.branches) { f(b.cond); todos(b.body); }
          if (s.elseBody) todos(s.elseBody);
          break;
        case 'While': f(s.cond); todos(s.body); break;
        case 'For':
          if (s.init) raizes(s.init, f);
          if (s.cond) f(s.cond);
          if (s.step) f(s.step);
          todos(s.body);
          break;
        case 'Return': if (s.expr) f(s.expr); break;
        case 'Try': todos(s.body); todos(s.catchBody); break;
        case 'Throw': f(s.expr); break;
        case 'Expr': f(s.expr); break;
        default: break;
      }
    }
    const nomeDaVariavel = (e) => (e.type === 'Ident' ? e.name : null);
    function semValor(L, R) {
      for (const e of [L, R]) {
        if (e.type === 'Ident' && e.tipo === 'nada') return `. A variável "${e.name}" foi declarada sem valor e nunca recebeu um`;
      }
      return '';
    }
    function conferirConta(op, L, R, no) {
      const a = L.tipo;
      const b = R.tipo;
      if (op === '==' || op === '!=') {
        if (conhecido(a) && conhecido(b) && a !== b) {
          aviso(`Comparar ${a} com ${b} usando "${op}" sempre dá ${op === '==' ? KW_PHRASE.FALSE : KW_PHRASE.TRUE}, porque os tipos são diferentes`, no);
        }
        return;
      }
      if (!contaValida(op, a, b)) {
        const ambos = conhecido(a) && conhecido(b);
        const ruim = [a, b].find((t) => conhecido(t) && (op === '+' || t !== 'número'));
        let msg;
        if (op === '+') msg = `Não dá para somar ${a} com ${b}`;
        else if (CONTAS.includes(op)) {
          msg = ambos
            ? `A conta "${op}" só funciona com números, e recebeu ${a} e ${b}`
            : `A conta "${op}" só funciona com números, e um dos lados é ${ruim}`;
        } else {
          msg = ambos ? `Não dá para comparar ${a} com ${b} usando "${op}"` : `Não dá para comparar ${ruim} usando "${op}"`;
        }
        erro(msg + semValor(L, R), no);
        return;
      }
      if ((op === '/' || op === '%') && constante(R) === 0) erro('Divisão por zero! Nem a Assembleia aprova isso', no);
    }
    function conferirPosicao(no, escrita) {
      const t = no.obj.tipo;
      if (conhecido(t) && t !== 'lista' && t !== 'texto') {
        erro(`Só dá para usar [ ] em lista ou texto, e ${nomeDaVariavel(no.obj) ? `"${no.obj.name}"` : 'isso'} é ${t}`, no);
      } else if (escrita && t === 'texto') {
        erro('Só dá para trocar posições de uma lista (texto não pode ser alterado)', no);
      }
      const ti = no.index.tipo;
      const k = constante(no.index);
      if (conhecido(ti) && ti !== 'número') {
        erro(`Posição inválida: a posição precisa ser um número inteiro a partir de 0, e recebeu ${ti}`, no.index);
      } else if (typeof k === 'number' && (!Number.isInteger(k) || k < 0)) {
        erro(`Posição inválida: ${fmt(k, true)}. Use um número inteiro a partir de 0`, no.index);
      }
    }
    function conferirPronta(e) {
      const pronta = REGRAS.prontas[e.name];
      if (!pronta || funcoes.has(e.name) || e.args.length !== aridade[e.name]) return;
      // Com todos os valores constantes, a função pronta roda já na análise.
      const consts = e.args.map(constante);
      if (consts.every((v) => v !== undefined)) {
        try {
          pronta(consts, e.line);
        } catch (x) {
          if (!(x instanceof FogeErro)) throw x;
          erro(x.message, e);
        }
        return;
      }
      const tipos = e.args.map((a) => a.tipo);
      const ruim = (aceitos) => tipos.find((t) => conhecido(t) && !aceitos.includes(t));
      if (e.name === 'TAMANHO') {
        const t = ruim(['texto', 'lista']);
        if (t) erro(`TAMANHO só funciona com texto ou lista, e recebeu ${t}`, e);
      } else if (e.name !== 'TEXTO') {
        const t = ruim(['número', 'texto']);
        if (t) erro(`${e.name} precisa de um número (ou de um texto com um número), e recebeu ${t}`, e);
      }
    }
    function checar(e) {
      switch (e.type) {
        case 'List': e.items.forEach(checar); break;
        case 'Unary': checar(e.arg); break;
        case 'Logical':
        case 'Binary': checar(e.left); checar(e.right); break;
        case 'Assign': checar(e.value); checarAlvo(e.target); break;
        case 'Update': checarAlvo(e.target); break;
        case 'Index': checar(e.obj); checar(e.index); break;
        case 'Call': e.args.forEach(checar); break;
        default: break;
      }
      e.tipo = T(e);
      switch (e.type) {
        case 'Unary':
          if (e.op === '-' && conhecido(e.arg.tipo) && e.arg.tipo !== 'número') {
            erro(`Não dá para usar "-" em ${e.arg.tipo}${semValor(e.arg, e.arg)}`, e);
          }
          break;
        case 'Binary':
          conferirConta(e.op, e.left, e.right, e);
          break;
        case 'Assign':
          if (e.op !== '=') conferirConta(e.op[0], e.target, e.value, e);
          if (e.target.type === 'Index') conferirPosicao(e.target, true);
          break;
        case 'Update':
          if (conhecido(e.target.tipo) && e.target.tipo !== 'número') {
            erro(`"${e.op}" só funciona com número, e a variável tem ${e.target.tipo}${semValor(e.target, e.target)}`, e);
          }
          if (e.target.type === 'Index') conferirPosicao(e.target, true);
          break;
        case 'Index':
          conferirPosicao(e, false);
          break;
        case 'Call':
          conferirPronta(e);
          break;
        default:
          break;
      }
    }
    function checarAlvo(t) {
      if (t.type === 'Index') { checar(t.obj); checar(t.index); }
      t.tipo = T(t);
    }
    const todos = [...ast.globals, ...ast.funcs.flatMap((f) => f.body), ...ast.main.body];
    for (const s of todos) raizes(s, checar);

    for (const sym of simbolos) {
      const t = tipoSym(sym);
      sym.tipo = t === SEM_INFO ? DESCONHECIDO : t;
      if (sym.especie === 'variável' && !sym.lida) {
        aviso(`A senhora fez "${sym.nome}", mas o valor dela nunca é usado`, { line: sym.linha, col: sym.coluna });
      }
    }

    const porPosicao = (a, b) => (a.linha - b.linha) || ((a.coluna || 0) - (b.coluna || 0));
    const vistos = new Set();
    const unicos = erros.sort(porPosicao).filter((e) => {
      const k = `${e.linha}:${e.coluna}:${e.message}`;
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    });
    return {
      erros: unicos,
      avisos: avisos.sort(porPosicao),
      simbolos: simbolos.map((s) => ({ nome: s.nome, tipo: s.tipo, especie: s.especie, escopo: s.escopo, linha: s.linha, coluna: s.coluna })),
      funcoes: ast.funcs.map((f) => ({ nome: f.name, parametros: f.params, linha: f.line })),
    };
  }

  // Roda a análise semântica e para no primeiro erro, levando a lista toda.
  function exigirSemantica(ast) {
    const sem = analisar(ast);
    if (sem.erros.length) {
      const e = sem.erros[0];
      e.erros = sem.erros;
      e.avisos = sem.avisos;
      throw e;
    }
    return sem;
  }

  // ---------------------------------------------------------------------------
  // Interpretador: executa a AST direto, sem gerar código
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

  class Interp {
    constructor(io) {
      this.io = io;
      this.rt = criarRuntime(io, FogeErro, CONFIG); // regras de tipo, funções prontas e limites
      this.funcs = new Map();
      this.globals = new Env(null);
    }

    tick(line) {
      this.rt.passo(line);
    }

    run(ast) {
      for (const f of ast.funcs) {
        if (this.funcs.has(f.name)) throw new FogeErro(`A função "${f.name}" foi declarada duas vezes`, f.line);
        if (this.rt.prontas[f.name]) throw new FogeErro(`"${f.name}" já é uma função pronta da linguagem. Escolha outro nome`, f.line);
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
            env.set(t.name, this.rt.ler(s.line), t.line);
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
            const valor = this.rt.capturar(e); // erros fatais e sinais de laço passam direto
            const cenv = new Env(env);
            if (s.errName) cenv.declare(s.errName, valor, s.line);
            this.block(s.catchBody, cenv);
          }
          return;
        case 'Throw':
          throw this.rt.lancar(this.eval(s.expr, env), s.line);
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
          return this.rt.negativo(v, e.line);
        }
        case 'Logical': {
          const l = !!this.eval(e.left, env);
          if (e.op === '&&') return l ? !!this.eval(e.right, env) : false;
          return l ? true : !!this.eval(e.right, env);
        }
        case 'Binary':
          return this.rt.conta(e.op, this.eval(e.left, env), this.eval(e.right, env), e.line);
        case 'Assign': {
          let v = this.eval(e.value, env);
          if (e.op !== '=') v = this.rt.conta(e.op[0], this.eval(e.target, env), v, e.line);
          this.store(e.target, v, env);
          return v;
        }
        case 'Update': {
          const cur = this.rt.numero(this.eval(e.target, env), e.op, e.line);
          const nv = e.op === '++' ? cur + 1 : cur - 1;
          this.store(e.target, nv, env);
          return e.prefix ? nv : cur;
        }
        case 'Index':
          return this.rt.item(this.eval(e.obj, env), this.eval(e.index, env), e.line);
        case 'Call': return this.call(e, env);
        default:
          throw new Error('Expressão desconhecida: ' + e.type);
      }
    }

    store(target, v, env) {
      if (target.type === 'Ident') { env.set(target.name, v, target.line); return; }
      const obj = this.rt.lista(this.eval(target.obj, env), target.line);
      this.rt.guardar(v, obj, this.eval(target.index, env), target.line);
    }

    call(e, env) {
      const args = e.args.map((a) => this.eval(a, env));
      const pronta = this.rt.prontas[e.name];
      if (pronta) {
        if (args.length !== this.rt.aridade[e.name]) {
          throw new FogeErro(`${e.name} espera ${this.rt.aridade[e.name]} valor(es), mas recebeu ${args.length}`, e.line);
        }
        return pronta(args, e.line);
      }
      const f = this.funcs.get(e.name);
      if (!f) throw new FogeErro(`A senhora não conhece a função "${e.name}". Declare com "${KW_PHRASE.FUNC} ${e.name}(...)"`, e.line);
      if (args.length !== f.params.length) {
        throw new FogeErro(`A função "${e.name}" espera ${f.params.length} valor(es), mas recebeu ${args.length}`, e.line);
      }
      this.rt.entrar(e.line);
      const fenv = new Env(this.globals);
      f.params.forEach((p, i) => fenv.declare(p, args[i], f.line));
      try {
        this.block(f.body, fenv);
      } catch (sig) {
        if (sig instanceof ReturnSig) return sig.value;
        throw sig;
      } finally {
        this.rt.sair();
      }
      return undefined;
    }
  }

  // ---------------------------------------------------------------------------
  // Runtime: as regras de execução
  // ---------------------------------------------------------------------------
  // Esta função não usa nada de fora dela, só o que recebe nos parâmetros. Por
  // isso o gerador de código consegue copiar o texto dela para dentro do .js
  // gerado (veja montarArquivo), e o interpretador, o botão Compilar do site e o
  // programa traduzido seguem exatamente as mesmas regras e mensagens de erro.
  function criarRuntime(io, FogeErro, config) {
    const erro = (msg, linha) => new FogeErro(msg, linha);
    const fatal = (msg, linha) => {
      const e = erro(msg, linha);
      e.fatal = true; // nem o A SENHORA TÁ NERVOSA? segura
      return e;
    };

    function tipo(v) {
      if (typeof v === 'number') return 'número';
      if (typeof v === 'string') return 'texto';
      if (typeof v === 'boolean') return 'booleano';
      if (Array.isArray(v)) return 'lista';
      return 'nada';
    }

    // Transforma um valor no texto que o TEMOS GRAVADO! mostra.
    function fmt(v, dentro) {
      if (typeof v === 'string') return dentro ? JSON.stringify(v) : v;
      if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(parseFloat(v.toPrecision(12)));
      if (typeof v === 'boolean') return v ? config.verdadeiro : config.falso;
      if (Array.isArray(v)) return '[' + v.map((x) => fmt(x, true)).join(', ') + ']';
      return 'nada';
    }

    function numeroDe(x, nome, linha) {
      const n = typeof x === 'number' ? x : Number(String(x).trim().replace(',', '.'));
      if (typeof x === 'boolean' || x === undefined || Array.isArray(x) || String(x).trim() === '' || Number.isNaN(n)) {
        throw erro(`${nome}: não dá para transformar ${fmt(x, true)} em número`, linha);
      }
      return n;
    }

    function posicao(obj, i, linha) {
      if (typeof obj !== 'string' && !Array.isArray(obj)) throw erro(`Só dá para usar [ ] em lista ou texto, e isso é ${tipo(obj)}`, linha);
      if (typeof i !== 'number' || !Number.isInteger(i) || i < 0) throw erro(`Posição inválida: ${fmt(i, true)}. Use um número inteiro a partir de 0`, linha);
      return i;
    }

    function conta(op, l, r, linha) {
      switch (op) {
        case '+':
          if (typeof l === 'string' || typeof r === 'string') return fmt(l) + fmt(r);
          if (typeof l === 'number' && typeof r === 'number') return l + r;
          if (Array.isArray(l) && Array.isArray(r)) return l.concat(r);
          throw erro(`Não dá para somar ${tipo(l)} com ${tipo(r)}`, linha);
        case '-': case '*': case '/': case '%':
          if (typeof l !== 'number' || typeof r !== 'number') {
            throw erro(`A conta "${op}" só funciona com números, e recebeu ${tipo(l)} e ${tipo(r)}`, linha);
          }
          if ((op === '/' || op === '%') && r === 0) throw erro('Divisão por zero! Nem a Assembleia aprova isso', linha);
          return op === '-' ? l - r : op === '*' ? l * r : op === '/' ? l / r : l % r;
        case '==': return l === r;
        case '!=': return l !== r;
        default:
          if (!((typeof l === 'number' && typeof r === 'number') || (typeof l === 'string' && typeof r === 'string'))) {
            throw erro(`Não dá para comparar ${tipo(l)} com ${tipo(r)} usando "${op}"`, linha);
          }
          return op === '<' ? l < r : op === '>' ? l > r : op === '<=' ? l <= r : l >= r;
      }
    }

    // Funções prontas da linguagem (objetos sem protótipo: "toString" não é função pronta).
    const prontas = Object.assign(Object.create(null), {
      TAMANHO: (args, linha) => {
        const [x] = args;
        if (typeof x !== 'string' && !Array.isArray(x)) throw erro(`TAMANHO só funciona com texto ou lista, e recebeu ${tipo(x)}`, linha);
        return x.length;
      },
      NUMERO: (args, linha) => numeroDe(args[0], 'NUMERO', linha),
      INTEIRO: (args, linha) => Math.trunc(numeroDe(args[0], 'INTEIRO', linha)),
      TEXTO: (args) => fmt(args[0]),
      ALEATORIO: (args, linha) => {
        const a = Math.ceil(numeroDe(args[0], 'ALEATORIO', linha));
        const b = Math.floor(numeroDe(args[1], 'ALEATORIO', linha));
        if (b < a) throw erro('ALEATORIO: o mínimo é maior que o máximo', linha);
        return a + Math.floor(Math.random() * (b - a + 1));
      },
    });
    const aridade = Object.assign(Object.create(null), { TAMANHO: 1, NUMERO: 1, INTEIRO: 1, TEXTO: 1, ALEATORIO: 2 });

    // Proteções contra laço infinito e recursão infinita.
    let passos = 0;
    let profundidade = 0;
    function passo(linha) {
      if (++passos > config.maxPassos) {
        throw fatal(`A senhora correu demais! O programa passou de ${config.maxPassos / 1000000} milhões de passos. Será um laço infinito?`, linha);
      }
    }
    function entrar(linha) {
      if (++profundidade > config.maxProfundidade) {
        profundidade = 0;
        throw fatal(`A senhora entrou em mais de ${config.maxProfundidade} chamadas sem voltar. Recursão infinita?`, linha);
      }
    }
    function sair() {
      if (profundidade > 0) profundidade--;
    }

    function lista(obj, linha) {
      if (!Array.isArray(obj)) throw erro('Só dá para trocar posições de uma lista (texto não pode ser alterado)', linha);
      return obj;
    }
    function item(obj, i, linha) {
      const k = posicao(obj, i, linha);
      if (k >= obj.length) {
        throw erro(`A posição ${k} não existe: só tem ${obj.length} ${Array.isArray(obj) ? 'itens' : 'letras'} (começa do 0)`, linha);
      }
      return obj[k];
    }
    function guardar(v, obj, i, linha) {
      const k = posicao(obj, i, linha);
      if (k > obj.length) {
        throw erro(`A posição ${k} não existe. A lista tem ${obj.length} itens, então dá para usar até a posição ${obj.length} (que adiciona no final)`, linha);
      }
      obj[k] = v;
      return v;
    }
    function numero(v, op, linha) {
      if (typeof v !== 'number') throw erro(`"${op}" só funciona com número, e a variável tem ${tipo(v)}`, linha);
      return v;
    }
    function negativo(v, linha) {
      if (typeof v !== 'number') throw erro(`Não dá para usar "-" em ${tipo(v)}`, linha);
      return -v;
    }
    // QUER CONVERSAR COMIGO?: lê uma linha. Se ela parece um número, vira número.
    function ler(linha) {
      const t = io.readLine();
      if (t === null || t === undefined) throw erro(config.semEntrada, linha);
      return /^\s*-?\d+([.,]\d+)?\s*$/.test(t) ? Number(t.trim().replace(',', '.')) : t;
    }
    function lancar(v, linha) {
      const e = erro(`Me deixa em paz! ${fmt(v)}`, linha);
      e.lancado = true;
      e.valor = v;
      return e;
    }
    // A SENHORA TÁ NERVOSA?: devolve o valor do erro, ou deixa passar o que não é dela.
    function capturar(e) {
      if (!(e instanceof FogeErro) || e.fatal) throw e;
      return e.lancado ? e.valor : e.message;
    }
    // Transforma um erro do JavaScript na mensagem que a senhora mostra.
    function explicar(e) {
      if (e instanceof FogeErro) return { mensagem: e.message, linha: e.linha };
      if (e instanceof RangeError) return { mensagem: 'A senhora correu tanto que a pilha estourou. Recursão profunda demais?' };
      if (e instanceof ReferenceError) {
        const m = /'([^']+)'/.exec(e.message);
        return { mensagem: `A senhora ainda não fez "${m ? m[1] : '?'}": a variável global foi usada antes de ser declarada` };
      }
      return null;
    }

    const funcoes = new Map();
    return {
      tipo, fmt, conta, posicao, prontas, aridade, passo, entrar, sair, explicar,
      lista, item, guardar, numero, negativo, ler, lancar, capturar,
      // as funções abaixo só são usadas pelo código gerado
      funcao(nome, fn) {
        funcoes.set(nome, fn);
      },
      gravar(...valores) {
        io.write(valores.map((v) => fmt(v)).join(' ') + '\n');
      },
      formatar(v) {
        return fmt(v);
      },
      acumular(op, valor, atual, linha) {
        return conta(op[0], atual, valor, linha);
      },
      acumularItem(op, valor, obj, pos, linha, linhaAlvo) {
        const nv = conta(op[0], item(obj(), pos(), linhaAlvo), valor, linha);
        return guardar(nv, lista(obj(), linhaAlvo), pos(), linhaAlvo);
      },
      atualizarItem(op, prefixo, obj, pos, linha, linhaAlvo) {
        const atual = numero(item(obj(), pos(), linhaAlvo), op, linha);
        const nv = op === '++' ? atual + 1 : atual - 1;
        guardar(nv, lista(obj(), linhaAlvo), pos(), linhaAlvo);
        return prefixo ? nv : atual;
      },
      chamar(nome, args, linha) {
        const pronta = prontas[nome];
        if (pronta) {
          if (args.length !== aridade[nome]) throw erro(`${nome} espera ${aridade[nome]} valor(es), mas recebeu ${args.length}`, linha);
          return pronta(args, linha);
        }
        const f = funcoes.get(nome);
        if (!f) throw erro(`A senhora não conhece a função "${nome}". Declare com "${config.fraseFuncao} ${nome}(...)"`, linha);
        if (args.length !== f.length) throw erro(`A função "${nome}" espera ${f.length} valor(es), mas recebeu ${args.length}`, linha);
        passo(linha);
        entrar(linha);
        try {
          return f(...args);
        } finally {
          sair();
        }
      },
    };
  }

  // Entrada e saída no Node: o TEMOS GRAVADO! escreve no terminal e o
  // QUER CONVERSAR COMIGO? lê uma linha do teclado (ou do arquivo em "< entrada.txt").
  // Também é copiada para dentro do .js gerado.
  function entradaSaidaNode() {
    const fs = require('fs');
    const { StringDecoder } = require('string_decoder');
    const decodificador = new StringDecoder('utf8');
    const buffer = Buffer.alloc(4096);
    let resto = '';
    let acabou = false;
    return {
      write(texto) {
        process.stdout.write(texto);
      },
      readLine() {
        while (!acabou && !resto.includes('\n')) {
          let n = 0;
          try {
            n = fs.readSync(0, buffer, 0, buffer.length, null);
          } catch (e) {
            if (e.code === 'EAGAIN') { // entrada ainda sem dados: espera um pouco
              Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
              continue;
            }
            if (e.code !== 'EOF') throw e;
          }
          if (n > 0) resto += decodificador.write(buffer.subarray(0, n));
          else acabou = true;
        }
        if (!resto) return null;
        const i = resto.indexOf('\n');
        const linha = i < 0 ? resto : resto.slice(0, i);
        resto = i < 0 ? '' : resto.slice(i + 1);
        return linha.replace(/\r$/, '');
      },
    };
  }

  // No .js gerado: mostra os erros de execução do jeito da senhora, sem a pilha do Node.
  function terminarNode(foge) {
    process.on('uncaughtException', (e) => {
      const r = foge.explicar(e);
      if (!r) {
        console.error(e);
        process.exitCode = 70;
        return;
      }
      process.stderr.write(`Erro de execução${r.linha ? ' na linha ' + r.linha : ''}: ${r.mensagem}\n`);
      process.exitCode = 1;
    });
  }

  // ---------------------------------------------------------------------------
  // 4. Geração de código: AST -> JavaScript
  // ---------------------------------------------------------------------------
  // Percorre a AST já conferida pela análise semântica e escreve o JavaScript
  // equivalente. Quando os tipos que a análise deduziu garantem o resultado
  // (por exemplo, número + número), a conta vira o operador do próprio
  // JavaScript. Quando não garantem, ela vira uma chamada ao runtime (foge.*),
  // que confere os tipos na hora de rodar com as mesmas mensagens do interpretador.

  // Nomes que não podem virar variável em JavaScript, mais os nomes do runtime.
  const NOMES_RESERVADOS = new Set((
    'break case catch class const continue debugger default delete do else enum export extends false finally ' +
    'for function if implements import in instanceof interface let new null package private protected public ' +
    'return static super switch this throw true try typeof var void while with yield await arguments eval ' +
    'undefined NaN Infinity foge assembleia FogeErro entradaSaida require module exports process'
  ).split(' '));
  const JS_INICIO = /[\p{ID_Start}_]/u;
  const JS_PARTE = /\p{ID_Continue}/u;

  // Precedência dos operadores no JavaScript (maior = cola mais forte), para
  // só colocar parênteses onde precisa.
  const PREC = {
    ',': 0, '=': 1, '||': 2, '&&': 3, '==': 4, '!=': 4, '<': 5, '>': 5, '<=': 5, '>=': 5,
    '+': 6, '-': 6, '*': 7, '/': 7, '%': 7, unario: 8, posfixo: 9,
  };

  function compilarAst(ast) {
    const str = JSON.stringify;
    const pad = (n) => '  '.repeat(n);
    const tipoDe = (e) => e.tipo || DESCONHECIDO;
    const emVolta = (codigo, prec, min) => (prec < min ? `(${codigo})` : codigo);

    // Escopos da geração: o mesmo desenho da análise semântica, mas guardando
    // o nome JavaScript de cada variável.
    const escopo = (pai) => ({ vars: new Map(), js: new Set(), pai });
    function achar(sc, nome) {
      for (let s = sc; s; s = s.pai) if (s.vars.has(nome)) return s.vars.get(nome);
      throw new Error(`"${nome}" não foi declarado (a análise semântica deveria ter avisado)`);
    }
    // Cada declaração ganha um nome JavaScript. Quase sempre é o próprio nome;
    // só muda (X vira X_2) quando um bloco de fora já usa esse nome, quando é
    // uma palavra reservada do JavaScript ou quando tem um caractere inválido.
    function nomeJs(nome, sc) {
      let base = '';
      for (const c of nome) base += (base ? JS_PARTE : JS_INICIO).test(c) ? c : '_' + c.codePointAt(0).toString(16);
      const ocupado = (js) => {
        if (NOMES_RESERVADOS.has(js)) return true;
        for (let s = sc; s; s = s.pai) if (s.js.has(js)) return true;
        return false;
      };
      let js = base;
      for (let k = 2; ocupado(js); k++) js = base + '_' + k;
      sc.js.add(js);
      return js;
    }
    function declarar(sc, nome) {
      const js = nomeJs(nome, sc);
      sc.vars.set(nome, js);
      return js;
    }

    const globais = escopo(null);
    const nomesFuncoes = new Map();
    for (const f of ast.funcs) nomesFuncoes.set(f.name, nomeJs(f.name, globais));

    // A conta pode usar o operador do JavaScript? Só quando os tipos garantem o
    // mesmo resultado do runtime (e, na divisão, quando o divisor é uma
    // constante diferente de zero).
    function nativa(op, a, b, direita) {
      const numeros = a === 'número' && b === 'número';
      if (op === '+' || ORDEM.includes(op)) return numeros || (a === 'texto' && b === 'texto');
      if (op === '-' || op === '*') return numeros;
      if (op === '/' || op === '%') {
        const k = constante(direita);
        return numeros && typeof k === 'number' && k !== 0;
      }
      return false;
    }

    // ---- expressões ----------------------------------------------------------
    // "min" é a precedência mínima que a expressão precisa ter para não ganhar
    // parênteses em volta.
    function ex(e, sc, min) {
      switch (e.type) {
        case 'Lit':
          return typeof e.value === 'string' ? str(e.value) : String(e.value);
        case 'Ident':
          return achar(sc, e.name);
        case 'List':
          return '[' + e.items.map((x) => ex(x, sc, PREC['='])).join(', ') + ']';
        case 'Unary': {
          if (e.op === '!') return emVolta('!' + ex(e.arg, sc, PREC.unario), PREC.unario, min);
          if (tipoDe(e.arg) === 'número') {
            const c = ex(e.arg, sc, PREC.unario);
            return emVolta('-' + (c[0] === '-' ? ' ' : '') + c, PREC.unario, min);
          }
          return `foge.negativo(${ex(e.arg, sc, PREC['='])}, ${e.line})`;
        }
        case 'Logical': {
          const p = PREC[e.op];
          return emVolta(`${condicao(e.left, sc, p)} ${e.op} ${condicao(e.right, sc, p + 1)}`, p, min);
        }
        case 'Binary': {
          const p = PREC[e.op];
          if (e.op === '==' || e.op === '!=') {
            return emVolta(`${ex(e.left, sc, p)} ${e.op}= ${ex(e.right, sc, p + 1)}`, p, min);
          }
          if (nativa(e.op, tipoDe(e.left), tipoDe(e.right), e.right)) {
            return emVolta(`${ex(e.left, sc, p)} ${e.op} ${ex(e.right, sc, p + 1)}`, p, min);
          }
          return `foge.conta(${str(e.op)}, ${ex(e.left, sc, PREC['='])}, ${ex(e.right, sc, PREC['='])}, ${e.line})`;
        }
        case 'Assign':
          return atribuir(e, sc, min);
        case 'Update':
          return atualizar(e, sc, min);
        case 'Index':
          return `foge.item(${ex(e.obj, sc, PREC['='])}, ${ex(e.index, sc, PREC['='])}, ${e.line})`;
        case 'Call':
          return `foge.chamar(${str(e.name)}, [${e.args.map((a) => ex(a, sc, PREC['='])).join(', ')}], ${e.line})`;
        default:
          throw new Error('Expressão desconhecida: ' + e.type);
      }
    }

    // && e || sempre devolvem TÁ GRAVADO ou NÃO TÁ GRAVADO, como no interpretador.
    function condicao(e, sc, min) {
      if (tipoDe(e) === 'booleano') return ex(e, sc, min);
      return emVolta('!!' + ex(e, sc, PREC.unario), PREC.unario, min);
    }

    function atribuir(e, sc, min) {
      const t = e.target;
      const v = (m) => ex(e.value, sc, m);
      if (t.type === 'Ident') {
        const js = achar(sc, t.name);
        if (e.op === '=') return emVolta(`${js} = ${v(PREC['='])}`, PREC['='], min);
        if (nativa(e.op[0], tipoDe(t), tipoDe(e.value), e.value)) return emVolta(`${js} ${e.op} ${v(PREC['='])}`, PREC['='], min);
        return emVolta(`${js} = foge.acumular(${str(e.op)}, ${v(PREC['='])}, ${js}, ${e.line})`, PREC['='], min);
      }
      const obj = ex(t.obj, sc, PREC['=']);
      const pos = ex(t.index, sc, PREC['=']);
      if (e.op === '=') return `foge.guardar(${v(PREC['='])}, foge.lista(${obj}, ${t.line}), ${pos}, ${t.line})`;
      return `foge.acumularItem(${str(e.op)}, ${v(PREC['='])}, () => ${obj}, () => ${pos}, ${e.line}, ${t.line})`;
    }

    function atualizar(e, sc, min) {
      const t = e.target;
      if (t.type === 'Ident') {
        const js = achar(sc, t.name);
        if (tipoDe(t) === 'número') return e.prefix ? emVolta(e.op + js, PREC.unario, min) : emVolta(js + e.op, PREC.posfixo, min);
        if (e.prefix) return emVolta(`${js} = foge.numero(${js}, ${str(e.op)}, ${e.line}) ${e.op[0]} 1`, PREC['='], min);
        return emVolta(`foge.numero(${js}, ${str(e.op)}, ${e.line}), ${js}${e.op}`, PREC[','], min);
      }
      return `foge.atualizarItem(${str(e.op)}, ${e.prefix}, () => ${ex(t.obj, sc, PREC['='])}, () => ${ex(t.index, sc, PREC['='])}, ${e.line}, ${t.line})`;
    }

    // Quando o valor da expressão é jogado fora (X++; sozinho ou o passo do for).
    function semValor(e, sc) {
      if (e.type === 'Update' && e.target.type === 'Ident' && tipoDe(e.target) !== 'número') {
        const js = achar(sc, e.target.name);
        return `${js} = foge.numero(${js}, ${str(e.op)}, ${e.line}) ${e.op[0]} 1`;
      }
      return ex(e, sc, 0);
    }

    // A expressão pode mudar algum valor? (atribuição, ++/-- ou chamada de função)
    function temEfeito(e) {
      if (!e || typeof e !== 'object') return false;
      if (Array.isArray(e)) return e.some(temEfeito);
      if (e.type === 'Assign' || e.type === 'Update' || e.type === 'Call') return true;
      return Object.entries(e).some(([k, v]) => k !== 'sym' && v && typeof v === 'object' && temEfeito(v));
    }

    // ---- comandos ------------------------------------------------------------
    // O valor inicial é traduzido antes de declarar o nome, como no interpretador:
    // em "A SENHORA FEZ X = X + 1" o X da direita é o de fora.
    function declaracoes(s, sc) {
      return s.decls.map((d) => {
        const valor = d.init ? ex(d.init, sc, PREC['=']) : null;
        return { js: declarar(sc, d.name), valor };
      });
    }

    function bloco(stmts, sc, n, L) {
      for (const s of stmts) comando(s, sc, n, L);
    }

    function comando(s, sc, n, L) {
      const p = pad(n);
      switch (s.type) {
        case 'Var':
          for (const d of declaracoes(s, sc)) L.push(d.valor ? `${p}let ${d.js} = ${d.valor};` : `${p}let ${d.js};`);
          return;
        case 'Print': {
          // O interpretador transforma cada valor em texto logo depois de calculá-lo.
          // Se um valor seguinte pode mudar uma lista já calculada (L[0]++, F(L)...),
          // o código gerado faz o mesmo com foge.formatar, para a saída ser igual.
          // Número, texto e booleano não mudam, então não precisam disso.
          const fixo = (a) => ['número', 'texto', 'booleano'].includes(tipoDe(a));
          const args = s.args.map((a, i) => {
            const c = ex(a, sc, PREC['=']);
            return !fixo(a) && s.args.slice(i + 1).some(temEfeito) ? `foge.formatar(${c})` : c;
          });
          L.push(`${p}foge.gravar(${args.join(', ')});`);
          return;
        }
        case 'Input':
          for (const t of s.targets) L.push(`${p}${achar(sc, t.name)} = foge.ler(${s.line});`);
          return;
        case 'If':
          s.branches.forEach((b, i) => {
            L.push(`${p}${i ? '} else if' : 'if'} (${ex(b.cond, sc, 0)}) {`);
            bloco(b.body, escopo(sc), n + 1, L);
          });
          if (s.elseBody) {
            L.push(`${p}} else {`);
            bloco(s.elseBody, escopo(sc), n + 1, L);
          }
          L.push(`${p}}`);
          return;
        case 'While':
          L.push(`${p}while (${ex(s.cond, sc, 0)}) {`);
          L.push(`${p}  foge.passo(${s.line});`);
          bloco(s.body, escopo(sc), n + 1, L);
          L.push(`${p}}`);
          return;
        case 'For': {
          const fs = escopo(sc);
          let inicio = '';
          if (s.init && s.init.type === 'Var') {
            inicio = 'let ' + declaracoes(s.init, fs).map((d) => (d.valor ? `${d.js} = ${d.valor}` : d.js)).join(', ');
          } else if (s.init) {
            inicio = semValor(s.init.expr, fs);
          }
          const cond = s.cond ? ' ' + ex(s.cond, fs, 0) : '';
          const passo = s.step ? ' ' + semValor(s.step, fs) : '';
          L.push(`${p}for (${inicio};${cond};${passo}) {`);
          L.push(`${p}  foge.passo(${s.line});`);
          bloco(s.body, escopo(fs), n + 1, L);
          L.push(`${p}}`);
          return;
        }
        case 'Break':
          L.push(`${p}break;`);
          return;
        case 'Continue':
          L.push(`${p}continue;`);
          return;
        case 'Return':
          L.push(s.expr ? `${p}return ${ex(s.expr, sc, 0)};` : `${p}return;`);
          return;
        case 'Try': {
          L.push(`${p}try {`);
          bloco(s.body, escopo(sc), n + 1, L);
          L.push(`${p}} catch ($erro) {`);
          const cs = escopo(sc);
          if (s.errName) L.push(`${p}  let ${declarar(cs, s.errName)} = foge.capturar($erro);`);
          else L.push(`${p}  foge.capturar($erro);`);
          bloco(s.catchBody, cs, n + 1, L);
          L.push(`${p}}`);
          return;
        }
        case 'Throw':
          L.push(`${p}throw foge.lancar(${ex(s.expr, sc, PREC['='])}, ${s.line});`);
          return;
        case 'Expr':
          L.push(`${p}${semValor(s.expr, sc)};`);
          return;
        default:
          throw new Error('Comando desconhecido: ' + s.type);
      }
    }

    // ---- programa ------------------------------------------------------------
    // Ordem igual à do interpretador: registra as funções, cria as variáveis
    // globais e depois roda a Assembleia.
    const G = [];
    for (const g of ast.globals) {
      for (const d of declaracoes(g, globais)) G.push(d.valor ? `let ${d.js} = ${d.valor};` : `let ${d.js};`);
    }

    const F = [];
    for (const f of ast.funcs) {
      const fs = escopo(globais); // a função só enxerga os parâmetros e as globais
      const nome = nomesFuncoes.get(f.name);
      F.push(`function ${nome}(${f.params.map((prm) => declarar(fs, prm)).join(', ')}) {`);
      bloco(f.body, fs, 1, F);
      F.push('}');
      F.push(`foge.funcao(${str(f.name)}, ${nome});`);
      F.push('');
    }

    const M = ['function assembleia() {'];
    bloco(ast.main.body, escopo(globais), 1, M);
    M.push('}', 'assembleia();');

    const L = [];
    if (F.length) L.push(`// Funções (${KW_PHRASE.FUNC})`, ...F);
    if (G.length) L.push('// Variáveis globais', ...G, '');
    L.push(`// ${KW_PHRASE.INICIO}`, ...M);
    return L.join('\n') + '\n';
  }

  // O código traduzido, do jeito que o site mostra e o botão Compilar roda.
  function comCabecalho(corpo) {
    return [
      "'use strict';",
      `// Programa FogeScript traduzido para JavaScript (tradutor ${VERSAO}).`,
      '// Contas com tipos garantidos pela análise semântica usam os operadores do JavaScript.',
      '// As outras chamam o runtime (foge.*), que confere os tipos na hora de rodar.',
      '// O último número de cada chamada foge.* é a linha do código FogeScript.',
      '',
      corpo,
    ].join('\n');
  }

  // Texto de uma função deste arquivo, sem a indentação de dentro do módulo.
  const fonteDe = (fn) => fn.toString().replace(/\r\n/g, '\n').replace(/\n {2}/g, '\n');

  // O arquivo .js completo: o runtime (copiado das funções acima) mais o programa.
  // Ele roda sozinho com "node arquivo.js", sem precisar do fogescript.js.
  function montarArquivo(corpo, opcoes) {
    opcoes = opcoes || {};
    const fonte = opcoes.fonte || 'programa.foge';
    const saida = opcoes.saida || fonte.replace(/\.[^./\\]*$/, '') + '.js';
    const config = Object.assign({}, CONFIG, {
      semEntrada: 'A senhora não quer conversar: a Entrada acabou (não tem mais linhas para ler)',
    });
    const barra = '// ' + '='.repeat(75);
    return [
      "'use strict';",
      `// ${saida}: gerado pelo tradutor FogeScript ${VERSAO} a partir de ${fonte}.`,
      `// Para rodar: node ${saida}`,
      `// As respostas do ${KW_PHRASE.INPUT} vêm do teclado, uma por linha,`,
      `// ou de um arquivo: node ${saida} < entrada.txt`,
      '//',
      '// O arquivo tem duas partes: o runtime do FogeScript (as funções foge.*, que',
      '// conferem os tipos e geram as mensagens de erro) e, no fim, o programa traduzido.',
      '',
      barra,
      '// Runtime do FogeScript',
      barra,
      fonteDe(FogeErro),
      '',
      `const entradaSaida = (${fonteDe(entradaSaidaNode)})();`,
      '',
      `const foge = (${fonteDe(criarRuntime)})(entradaSaida, FogeErro, ${JSON.stringify(config)});`,
      '',
      `(${fonteDe(terminarNode)})(foge);`,
      '',
      barra,
      `// Programa traduzido de ${fonte}`,
      barra,
      corpo,
    ].join('\n');
  }

  // ---------------------------------------------------------------------------
  // Ferramentas para mostrar as etapas (usadas pelo site e pelo tradutor.js)
  // ---------------------------------------------------------------------------
  const NOME_TOKEN = { kw: 'palavra reservada', ident: 'identificador', num: 'número', str: 'texto' };

  // Tabela de tokens: linha, coluna, categoria, o texto lido e o nome interno.
  function listarTokens(tokens, src) {
    return tokens.filter((t) => t.type !== 'eof').map((t) => ({
      linha: t.line,
      coluna: t.col,
      categoria: NOME_TOKEN[t.type] || (DELIMITADORES.includes(t.value) ? 'delimitador' : 'operador'),
      lexema: src.slice(t.start, t.end).replace(/\s+/g, ' '),
      valor: t.type === 'kw' ? t.value : t.type === 'str' ? JSON.stringify(t.value) : String(t.value),
    }));
  }

  // Desenha a AST como uma árvore de texto. Depois da análise semântica, as
  // expressões aparecem com o tipo deduzido entre ⟨ ⟩.
  function desenharArvore(ast) {
    const linhas = [];
    const tipoDe = (e) => (e.tipo && e.tipo !== DESCONHECIDO ? `  ⟨${e.tipo}⟩` : '');
    const linhaDe = (s) => `  · linha ${s.line}`;
    const grupo = (rotulo, filhos) => ({ grupo: rotulo, filhos });
    function descrever(x) {
      if (x.grupo) return [x.grupo, x.filhos];
      switch (x.type) {
        case 'Programa':
          return ['Programa', [...x.funcs, ...x.globals, grupo(`Assembleia (${KW_PHRASE.INICIO})${linhaDe(x.main)}`, x.main.body)]];
        case 'Func': return [`Função ${x.name}(${x.params.join(', ')})${linhaDe(x)}`, x.body];
        case 'Var':
          return [`Declaração (A SENHORA FEZ)${linhaDe(x)}`,
            x.decls.map((d) => grupo(`variável ${d.name}${d.sym && d.sym.tipo && d.sym.tipo !== DESCONHECIDO ? `  ⟨${d.sym.tipo}⟩` : ''}`, d.init ? [d.init] : []))];
        case 'Print': return [`Saída (${KW_PHRASE.PRINT})${linhaDe(x)}`, x.args];
        case 'Input': return [`Entrada (${KW_PHRASE.INPUT}) ${x.targets.map((t) => t.name).join(', ')}${linhaDe(x)}`, []];
        case 'If': {
          const filhos = [];
          x.branches.forEach((b, i) => {
            filhos.push(grupo(i ? `senão se (${KW_PHRASE.ELSEIF})` : 'condição', [b.cond]));
            filhos.push(grupo('então', b.body));
          });
          if (x.elseBody) filhos.push(grupo(`senão (${KW_PHRASE.ELSE})`, x.elseBody));
          return [`Se (${KW_PHRASE.IF})${linhaDe(x)}`, filhos];
        }
        case 'While': return [`Enquanto (${KW_PHRASE.WHILE})${linhaDe(x)}`, [grupo('condição', [x.cond]), grupo('corpo', x.body)]];
        case 'For': {
          const filhos = [];
          if (x.init) filhos.push(grupo('início', [x.init.type === 'Expr' ? x.init.expr : x.init]));
          if (x.cond) filhos.push(grupo('condição', [x.cond]));
          if (x.step) filhos.push(grupo('passo', [x.step]));
          filhos.push(grupo('corpo', x.body));
          return [`Para (${KW_PHRASE.FOR})${linhaDe(x)}`, filhos];
        }
        case 'Break': return [`Parar (${KW_PHRASE.BREAK})${linhaDe(x)}`, []];
        case 'Continue': return [`Pular (${KW_PHRASE.CONTINUE})${linhaDe(x)}`, []];
        case 'Return': return [`Retorno (${KW_PHRASE.RETURN})${linhaDe(x)}`, x.expr ? [x.expr] : []];
        case 'Try': {
          const filhos = [grupo('tenta', x.body), grupo(`se der erro (${KW_PHRASE.CATCH})${x.errName ? ' guarda em ' + x.errName : ''}`, x.catchBody)];
          return [`Tentativa (${KW_PHRASE.TRY})${linhaDe(x)}`, filhos];
        }
        case 'Throw': return [`Lançar erro (${KW_PHRASE.THROW})${linhaDe(x)}`, [x.expr]];
        case 'Expr': {
          const [r, f] = descrever(x.expr);
          return [r + linhaDe(x), f];
        }
        case 'Lit':
          if (typeof x.value === 'number') return [`Número ${x.value}`, []];
          if (typeof x.value === 'string') return [`Texto ${JSON.stringify(x.value)}`, []];
          return [`Booleano ${x.value ? KW_PHRASE.TRUE : KW_PHRASE.FALSE}`, []];
        case 'Ident': return [`Variável ${x.name}${tipoDe(x)}`, []];
        case 'List': return [`Lista${tipoDe(x)}`, x.items];
        case 'Unary': return [`${x.op === '!' ? 'Não' : 'Menos'} ${x.op}${tipoDe(x)}`, [x.arg]];
        case 'Logical': return [`Lógica ${x.op}${tipoDe(x)}`, [x.left, x.right]];
        case 'Binary': return [`${['+', '-', '*', '/', '%'].includes(x.op) ? 'Conta' : 'Comparação'} ${x.op}${tipoDe(x)}`, [x.left, x.right]];
        case 'Assign': return [`Atribuição ${x.op}${tipoDe(x)}`, [x.target, x.value]];
        case 'Update': return [`${x.prefix ? x.op + ' antes' : x.op + ' depois'}${tipoDe(x)}`, [x.target]];
        case 'Index': return [`Posição [ ]${tipoDe(x)}`, [x.obj, x.index]];
        case 'Call': return [`Chamada ${x.name}(...)${tipoDe(x)}`, x.args];
        default: return [x.type, []];
      }
    }
    function desenhar(x, prefixo, ultimo, raiz) {
      const [rotulo, filhos] = descrever(x);
      linhas.push(raiz ? rotulo : prefixo + (ultimo ? '└── ' : '├── ') + rotulo);
      const p = raiz ? '' : prefixo + (ultimo ? '    ' : '│   ');
      filhos.forEach((f, i) => desenhar(f, p, i === filhos.length - 1, false));
    }
    desenhar(ast, '', true, true);
    return linhas.join('\n');
  }

  // Mensagem de erro completa, com a linha do código e uma setinha na coluna.
  function formatarErro(e, src) {
    const fase = NOME_FASE[e.fase] || 'Erro';
    const onde = e.linha ? ` na linha ${e.linha}${e.coluna ? `, coluna ${e.coluna}` : ''}` : '';
    let s = `${fase}${onde}: ${e.mensagem !== undefined ? e.mensagem : e.message}`;
    if (src && e.linha) {
      const texto = src.split(/\r?\n/)[e.linha - 1];
      if (texto !== undefined) {
        const n = String(e.linha);
        s += `\n  ${n} | ${texto.replace(/\t/g, ' ')}`;
        if (e.coluna) s += `\n  ${' '.repeat(n.length)} | ${' '.repeat(Math.max(0, e.coluna - 1))}^`;
      }
    }
    return s;
  }

  // ---------------------------------------------------------------------------
  // Funções principais
  // ---------------------------------------------------------------------------
  const paraObjeto = (e) => ({ fase: e.fase, mensagem: e.message, linha: e.linha, coluna: e.coluna });

  function criarIO(opts, out) {
    const lines = (opts.input || '').split(/\r?\n/);
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    let ptr = 0;
    return {
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
  }

  function resultadoErro(e, output, extra, compilado) {
    const r = Object.assign({ ok: false, output }, extra);
    if (e instanceof FogeErro) {
      return Object.assign(r, {
        error: e.message, linha: e.linha, coluna: e.coluna, fase: e.fase,
        erros: (e.erros || [e]).map(paraObjeto),
      });
    }
    // No interpretador, um ReferenceError seria um defeito do próprio interpretador.
    const x = e instanceof ReferenceError && !compilado ? null : REGRAS.explicar(e);
    if (x) {
      return Object.assign(r, { error: x.mensagem, linha: x.linha, fase: 'execução', erros: [{ fase: 'execução', mensagem: x.mensagem, linha: x.linha }] });
    }
    const msg = `Erro interno do ${compilado ? 'compilador' : 'interpretador'}: ${e.message}`;
    return Object.assign(r, { error: msg, fase: 'interno', erros: [{ fase: 'interno', mensagem: msg }] });
  }

  /**
   * Executa um programa FogeScript com o interpretador (depois das três análises).
   * opts.input   texto da caixa de Entrada (um valor por linha)
   * opts.prompt  função chamada quando a Entrada acaba (ex.: window.prompt)
   * opts.onOutput(texto) recebe cada linha impressa
   * Retorna { ok, output, avisos, error?, linha?, coluna?, fase?, erros? }
   */
  function run(src, opts) {
    opts = opts || {};
    const out = [];
    const io = criarIO(opts, out);
    let avisos = [];
    try {
      const ast = parse(src);
      avisos = exigirSemantica(ast).avisos;
      new Interp(io).run(ast);
      return { ok: true, output: out.join(''), avisos };
    } catch (e) {
      return resultadoErro(e, out.join(''), { avisos: e.avisos || avisos }, false);
    }
  }

  /**
   * Traduz um programa FogeScript para JavaScript e devolve o código.
   * opcoes.completo  true para o arquivo .js que roda sozinho no Node (com o runtime)
   * opcoes.fonte     nome do arquivo .foge (aparece no comentário do topo)
   * Erros léxicos, sintáticos e semânticos viram FogeErro.
   */
  function compile(src, opcoes) {
    const ast = parse(src);
    exigirSemantica(ast);
    const corpo = compilarAst(ast);
    return opcoes && opcoes.completo ? montarArquivo(corpo, opcoes) : comCabecalho(corpo);
  }

  /**
   * Traduz e executa o JavaScript gerado. Recebe as mesmas opções de run() e
   * retorna também o código gerado em "codigo" (null se o programa tem erro).
   */
  function runCompiled(src, opts) {
    opts = opts || {};
    const out = [];
    const io = criarIO(opts, out);
    let codigo = null;
    let avisos = [];
    try {
      const ast = parse(src);
      avisos = exigirSemantica(ast).avisos;
      codigo = comCabecalho(compilarAst(ast));
      const programa = new Function('foge', codigo);
      programa(criarRuntime(io, FogeErro, CONFIG));
      return { ok: true, output: out.join(''), codigo, avisos };
    } catch (e) {
      return resultadoErro(e, out.join(''), { codigo, avisos: e.avisos || avisos }, true);
    }
  }

  /**
   * O tradutor completo, etapa por etapa, sem executar nada.
   * Retorna { ok, tokens, ast, semantica, codigo, arquivo, erros, avisos }:
   * cada etapa fica null se uma etapa anterior deu erro.
   */
  function traduzir(src, opcoes) {
    const r = { ok: false, tokens: null, ast: null, semantica: null, codigo: null, arquivo: null, erros: [], avisos: [] };
    try {
      r.tokens = tokenize(src);
      r.ast = parse(src);
      r.semantica = analisar(r.ast);
      r.avisos = r.semantica.avisos;
      if (r.semantica.erros.length) {
        r.erros = r.semantica.erros.map(paraObjeto);
        return r;
      }
      const corpo = compilarAst(r.ast);
      r.codigo = comCabecalho(corpo);
      r.arquivo = montarArquivo(corpo, opcoes);
      r.ok = true;
    } catch (e) {
      if (!(e instanceof FogeErro)) throw e;
      r.erros = [paraObjeto(e)];
    }
    return r;
  }

  return {
    run, runCompiled, compile, traduzir,
    tokenize, parse, analisar,
    listarTokens, desenharArvore, formatarErro, entradaSaidaNode,
    KEYWORDS, FogeErro, version: VERSAO,
  };
});
