# FogeScript

A linguagem de programação da senhora que trabalha na Assembleia. É inspirada na [BIRL](https://birl-language.github.io/), mas roda **direto no navegador**: o interpretador foi escrito em JavaScript, então não precisa de servidor nem de compilador.

Para usar, abra o `index.html` ou publique o repositório no GitHub Pages.

## Arquivos

| Arquivo | O que é |
|---|---|
| `index.html` | Site com editor, entrada/saída, dicionário e tutorial |
| `fogescript.js` | Interpretador (léxico, sintático e execução) |
| `exemplos/*.foge` | Programas de exemplo |

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

## O que mudou em relação ao dicionário original

- **Conflito corrigido:** `NUNCA FIZ ISSO` (false) estava dentro de `NÃO, EU NUNCA FIZ ISSO` (function). Agora true e false são `TÁ GRAVADO` e `NÃO TÁ GRAVADO`.
- **Fim de bloco:** o original não tinha um. Agora é `FUGIU`, no mesmo papel do `BIRL` na BIRL.
- **Novidades:** else if (`ENTÃO A SENHORA É O QUÊ?`), catch (`A SENHORA TÁ NERVOSA?`) e throw (`ME DEIXA EM PAZ!`). O try não tinha como tratar o erro.
- **Sem tipos como em C:** uma única palavra declara qualquer valor, e o `QUER CONVERSAR COMIGO?` não usa `%d`. Fica mais simples que a BIRL e combina com o JavaScript.
- **Proteções:** laço infinito e recursão infinita param com uma mensagem, em vez de travar o navegador. Os erros mostram a linha em que aconteceram.
