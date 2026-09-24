# Publicar um post

Posts novos ficam em `src/content/posts/<slug>.md` e não levam `originalUrl`. `pubDate` é obrigatório. A `description` tem no máximo 160 caracteres. `category` precisa existir em `src/content/categorias.json` e cada item de `tags` em `src/content/tags.json`.

```yaml
---
title: "Título do artigo"
description: "Resumo com até 160 caracteres."
pubDate: 2026-09-23
category: casa
tags: []
heroAlt: "Descrição da capa"
---

Primeiro parágrafo.
```

O `heroImage` entra no passo da capa. O build falha se a data estiver no futuro (tolerância de 5 minutos), se a categoria ou uma tag não existir, se a description passar de 160 caracteres, se `heroImage` apontar para um arquivo que não está no disco, ou se um link externo do corpo não estiver em `src/data/outbound-rel.json`.

## Passo a passo

1. Salve o Markdown em `src/content/posts/<slug>.md`.
2. Gere as candidatas de capa. Sem `--query`, a busca usa o `title`.

   ```
   node scripts/pexels-candidates.mjs --slug=<slug>
   node scripts/pexels-candidates.mjs --slug=<slug> --query="termos"
   ```

3. Abra `_extract/candidates/<slug>/index.html` e escolha um id. A página mostra id, fotógrafo e dimensões. Nenhuma foto é escolhida sozinha.
4. Confira a capa em dry-run e só depois grave.

   ```
   node scripts/apply-cover.mjs --slug=<slug> --pexels-id=<id> --alt="texto"
   node scripts/apply-cover.mjs --slug=<slug> --pexels-id=<id> --alt="texto" --apply
   ```

   O `--apply` baixa a foto original, salva `src/assets/posts/<slug>/capa.jpg` (1600px de largura, JPEG qualidade 82, sem metadados) e atualiza só `heroImage` e `heroAlt`.
5. Mapeie os links externos. Todo link externo novo entra em `src/data/outbound-rel.json` antes do build, com `"sponsored"` (pago ou afiliado), `"nofollow"` (rede própria) ou `""` (editorial).
6. Rode `pnpm build`.
7. Confira o post com `pnpm preview`.
8. Commit `post: <slug>`.
9. Push.

Posts novos entram sozinhos em Últimos Artigos e na categoria; mosaico, destaque e maisLidos da home só mudam editando `src/data/home.json`. Posts com `noindex: true` continuam nas páginas de categoria e tag, e ficam de fora de Últimos Artigos, das faixas da home, dos relacionados e da 404.
