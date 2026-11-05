# FogeScript

A linguagem de programação da senhora que trabalha na Assembleia. Ela é inspirada na [BIRL](https://birl-language.github.io/) e no meme do repórter que pergunta "A senhora trabalha na Assembleia?": a senhora jura que nunca fez nada e sai correndo. Por isso todo bloco termina com **FUGIU**.

O projeto é um **tradutor de FogeScript para JavaScript**, com as quatro etapas de um compilador: análise léxica, análise sintática, análise semântica e geração de código. Ele foi escrito em JavaScript puro e roda no navegador e no Node, sem instalar nada.

- Site com editor: https://fogescript.vercel.app (ou abra o `index.html`)
- Especificação da linguagem (tokens, gramática EBNF, regras semânticas e exemplos): [`docs/especificacao.pdf`](docs/especificacao.pdf)

## Como usar

### No navegador

Abra o site, escolha um exemplo e aperte:

- **Pega a senhora!**: roda o programa com o interpretador.
- **Compilar para JavaScript**: traduz o programa, mostra cada etapa em abas (tokens, árvore sintática, tabela de símbolos e o JavaScript gerado) e roda o JavaScript gerado. O botão **Baixar .js** salva o programa traduzido.

### Na linha de comando

Precisa do [Node.js](https://nodejs.org) 18 ou mais novo. Não tem dependências para instalar.

```bash
node tradutor.js exemplos/somador.foge
```

Isso cria `exemplos/somador.js`, que roda sozinho:

```bash
node exemplos/somador.js
```

As respostas do `QUER CONVERSAR COMIGO?` vêm do teclado, uma por linha, ou de um arquivo:

```bash
node exemplos/somador.js < exemplos/somador.entrada
```

No PowerShell o `<` não funciona. Use:

```powershell
Get-Content exemplos/somador.entrada | node exemplos/somador.js
```

Outras opções do tradutor:

| Comando | O que faz |
|---|---|
| `node tradutor.js prog.foge -o saida.js` | Escolhe o nome do arquivo gerado |
| `node tradutor.js prog.foge --rodar` | Traduz e já roda o programa gerado |
| `node tradutor.js prog.foge --tokens` | Mostra os tokens (análise léxica) |
| `node tradutor.js prog.foge --arvore` | Mostra a árvore sintática (análise sintática) |
| `node tradutor.js prog.foge --simbolos` | Mostra a tabela de símbolos e os tipos deduzidos (análise semântica) |
| `node tradutor.js prog.foge --codigo` | Mostra o JavaScript gerado |
| `node tradutor.js prog.foge --interpretar` | Roda com o interpretador, sem gerar arquivo |

### Testes

```bash
node testes/rodar-testes.js
```

Roda 24 testes:

- **5 programas válidos** (`testes/validos`). Cada um é rodado de três jeitos (interpretador, JavaScript gerado no site e arquivo `.js` gerado no Node) e a saída tem que ser igual ao arquivo `.saida`. A entrada vem do arquivo `.entrada`.
- **12 programas com erro** (`testes/erros`): 3 léxicos, 3 sintáticos, 5 semânticos e 1 de execução. A primeira linha de cada um diz o erro esperado, e o teste confere a etapa, a linha e a coluna.
- **7 exemplos do site** (`exemplos`): os três jeitos de rodar têm que dar a mesma saída.

As evidências (código original, JavaScript gerado e resultado da execução) ficam em [`testes/resultados`](testes/resultados).

## Arquivos

| Arquivo | O que é |
|---|---|
| `fogescript.js` | O tradutor: análise léxica, sintática, semântica, geração de código, runtime e interpretador |
| `tradutor.js` | Tradutor de linha de comando: lê um `.foge` e grava o `.js` |
| `index.html` | Site com editor, entrada/saída, as etapas do tradutor, dicionário e tutorial |
| `exemplos/*.foge` | Programas de exemplo (e a entrada de alguns, em `.entrada`) |
| `testes/` | Programas de teste, o script que roda os testes e as evidências |
| `docs/especificacao.pdf` | Documento de especificação (o mesmo conteúdo está em `docs/especificacao.html`) |

## Como o tradutor funciona

```
código .foge → 1. léxico → tokens → 2. sintático → AST → 3. semântico → AST com tipos → 4. geração → código .js
                                                                                      ↘ interpretador (roda a AST direto)
```

1. **Análise léxica** (`tokenize`): separa o texto em tokens (palavras-chave, nomes, números, textos, operadores e delimitadores) e descarta espaços e comentários. Acusa símbolo estranho, texto sem aspas de fechamento e nome começando com número.
2. **Análise sintática** (`parse`): um analisador descendente recursivo confere a gramática e monta a árvore sintática abstrata (AST). Acusa FUGIU faltando, parêntese sem fechar, comando incompleto e "senão" sem "se".
3. **Análise semântica** (`analisar`): confere variável não declarada, variável declarada duas vezes no mesmo bloco, função que não existe ou com o número errado de valores, `VOLTA AQUI!` fora de laço e tipos incompatíveis (texto vezes número, comparar lista com número...). Como a linguagem não pede tipo na declaração, o analisador deduz o tipo de cada variável pelos valores que ela recebe. Também mostra avisos, como variável que nunca é usada.
4. **Geração de código** (`compile`): percorre a AST e escreve o JavaScript. Quando a análise semântica garante os tipos, a conta vira o operador do próprio JavaScript; quando não garante (por exemplo, um valor que vem da Entrada), ela chama o runtime `foge.*`, que confere os tipos na hora de rodar.

Todo erro diz a etapa, a linha e a coluna:

```
Erro semântico na linha 9, coluna 20: A senhora nunca fez "totl". Declare antes com "A SENHORA FEZ totl". Você quis dizer "total"?
  9 |     TEMOS GRAVADO!(totl);
    |                    ^
```

### Exemplo de tradução

```
A SENHORA TRABALHA NA ASSEMBLEIA?
    A SENHORA FEZ X = 1 + 2 * 3;
    A SENHORA FEZ NOME;
    QUER CONVERSAR COMIGO?(NOME);
    SE A SENHORA NÃO É FUNCIONÁRIA (X > 5)
        TEMOS GRAVADO!("Oi, " + NOME, X);
    FUGIU
FUGIU
```

vira

```js
function assembleia() {
  let X = 1 + 2 * 3;
  let NOME;
  NOME = foge.ler(4);
  if (X > 5) {
    foge.gravar(foge.conta("+", "Oi, ", NOME, 6), X);
  }
}
assembleia();
```

`X` só recebe números, então `1 + 2 * 3` e `X > 5` usam os operadores do JavaScript. `NOME` vem da Entrada (pode ser número ou texto), então a soma chama `foge.conta`, que confere os tipos ao rodar. O último número de cada chamada `foge.*` é a linha do código FogeScript, usada nas mensagens de erro.

O arquivo `.js` que o tradutor grava traz, antes do programa, o runtime (as funções `foge.*`), por isso roda sozinho com `node`.

## Dicionário oficial

Todo bloco termina com **FUGIU**. As palavras-chave aceitam maiúsculas ou minúsculas, com ou sem acento.

| Conceito | FogeScript |
|---|---|
| Início (main) | `A SENHORA TRABALHA NA ASSEMBLEIA?` |
| Fim de bloco | `FUGIU` |
| Saída (print) | `TEMOS GRAVADO!(...)` |
| Entrada (input) | `QUER CONVERSAR COMIGO?(X)` |
| Variável | `A SENHORA FEZ X = 1;` |
| If | `SE A SENHORA NÃO É FUNCIONÁRIA (cond)` |
| Else if | `ENTÃO A SENHORA É O QUÊ? (cond)` |
| Else | `E TÁ CORRENDO POR QUÊ?` |
| While | `ENQUANTO TIVER CORRENDO (cond)` |
| For | `SENHORA? SENHORA?! (início; cond; passo)` |
| Break | `VOLTA AQUI!` |
| Continue | `DEIXA ELA CORRER` |
| Função | `NÃO, EU NUNCA FIZ ISSO NOME(A, B)` |
| Chamar função | `CHAMA A SENHORA NOME(A, B)` (ou só `NOME(A, B)`) |
| Return | `CHEGA DE CORRER valor;` |
| True / False | `TÁ GRAVADO` / `NÃO TÁ GRAVADO` |
| Try / Catch | `DEIXA EU TE PERGUNTAR` … `A SENHORA TÁ NERVOSA? (ERRO)` |
| Throw | `ME DEIXA EM PAZ! "mensagem";` |

Tipos: número (inteiro ou com casas decimais), texto, booleano e lista. Comentários: `// uma linha` ou `/* várias */`.

Funções prontas: `TAMANHO`, `NUMERO`, `INTEIRO`, `TEXTO`, `ALEATORIO(a, b)`.

## Exemplo

```
NÃO, EU NUNCA FIZ ISSO SOMAR(A, B)
    CHEGA DE CORRER A + B;
FUGIU

A SENHORA TRABALHA NA ASSEMBLEIA?
    A SENHORA FEZ A, B, RES;
    QUER CONVERSAR COMIGO?(A, B);
    RES = CHAMA A SENHORA SOMAR(A, B);
    SE A SENHORA NÃO É FUNCIONÁRIA (RES == 37)
        TEMOS GRAVADO!("37! Tá gravado!");
    E TÁ CORRENDO POR QUÊ?
        TEMOS GRAVADO!("O resultado é", RES);
    FUGIU
FUGIU
```
