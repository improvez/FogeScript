'use strict';
// 01-tipos-e-operadores.js: gerado pelo tradutor FogeScript 1.2.0 a partir de 01-tipos-e-operadores.foge.
// Para rodar: node 01-tipos-e-operadores.js
// As respostas do QUER CONVERSAR COMIGO? vêm do teclado, uma por linha,
// ou de um arquivo: node 01-tipos-e-operadores.js < entrada.txt
//
// O arquivo tem duas partes: o runtime do FogeScript (as funções foge.*, que
// conferem os tipos e geram as mensagens de erro) e, no fim, o programa traduzido.

// ===========================================================================
// Runtime do FogeScript
// ===========================================================================
class FogeErro extends Error {
  constructor(mensagem, linha, coluna, fase) {
    super(mensagem);
    this.name = 'FogeErro';
    this.linha = linha;
    this.coluna = coluna;
    this.fase = fase || 'execução';
  }
}

const entradaSaida = (function entradaSaidaNode() {
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
})();

const foge = (function criarRuntime(io, FogeErro, config) {
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
})(entradaSaida, FogeErro, {"verdadeiro":"TÁ GRAVADO","falso":"NÃO TÁ GRAVADO","fraseFuncao":"NÃO, EU NUNCA FIZ ISSO","maxPassos":5000000,"maxProfundidade":300,"semEntrada":"A senhora não quer conversar: a Entrada acabou (não tem mais linhas para ler)"});

(function terminarNode(foge) {
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
})(foge);

// ===========================================================================
// Programa traduzido de 01-tipos-e-operadores.foge
// ===========================================================================
// A SENHORA TRABALHA NA ASSEMBLEIA?
function assembleia() {
  let dias = 22;
  let salario = 8800.5;
  let nome = "Dona Cida";
  let correu = true;
  let provas = ["vídeo", "foto", "ponto"];
  foge.gravar("Nome:", nome, "| dias:", dias, "| salário:", salario);
  foge.gravar("Correu?", correu, "| provas:", foge.formatar(provas), "| quantas:", foge.chamar("TAMANHO", [provas], 15));
  foge.gravar("10 + 3 =", 10 + 3);
  foge.gravar("10 - 3 =", 10 - 3);
  foge.gravar("10 * 3 =", 10 * 3);
  foge.gravar("10 / 4 =", 10 / 4);
  foge.gravar("10 % 3 =", 10 % 3);
  foge.gravar("2 + 3 * 4 =", 2 + 3 * 4, "| (2 + 3) * 4 =", (2 + 3) * 4);
  foge.gravar("Por dia:", foge.chamar("INTEIRO", [foge.conta("/", salario, dias, 24)], 24));
  foge.gravar("5 == 5:", 5 === 5, "| 5 != 5:", 5 !== 5);
  foge.gravar("3 < 7:", 3 < 7, "| 3 > 7:", 3 > 7);
  foge.gravar("7 <= 7:", 7 <= 7, "| 8 >= 9:", 8 >= 9);
  foge.gravar("\"ana\" < \"beto\":", "ana" < "beto");
  foge.gravar("e:", correu && dias > 20, "| ou:", false || correu, "| não:", !correu);
  let frase = "A senhora " + "trabalha " + "na Assembleia?";
  foge.gravar(frase, "(" + foge.chamar("TEXTO", [foge.chamar("TAMANHO", [frase], 37)], 37) + " letras)");
  foge.gravar("Primeira letra:", foge.item(nome, 0, 38));
  let x = 10;
  x += 5;
  x -= 3;
  x *= 2;
  x++;
  foge.gravar("x =", x);
}
assembleia();
