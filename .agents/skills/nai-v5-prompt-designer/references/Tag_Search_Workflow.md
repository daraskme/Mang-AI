# タグ検索

## いつ検索するか

新キャラ、流行衣装、体位の英語名が不明、ユーザーが「調べて」と言ったとき。カラー漫画の画風タグ（`artist:` 以外）を検討するときは先に [Color_Manga_Style_Tags.md](Color_Manga_Style_Tags.md) を読む。既定の R-STY は変えない。

## 優先順

1. NovelAI公式Docs
2. NovelAI UI のタグ補完（ユーザー環境。こちらからは見えないので、不確実なら汎用タグへ分解）
3. Danbooru タグ／wiki（髪型、服、ポーズ、体位）
4. 公式作品の外見情報
5. X：流行の発見のみ。タグ確定の一次情報にしない

## クエリ例

```text
site:docs.novelai.net/en/image V5
site:danbooru.donmai.us/wiki_pages cowgirl position
site:danbooru.donmai.us/wiki_pages tag_group:sexual_positions
[clothing] danbooru tag
```

Xは `NAI V5` `cowgirl` `source#` などで構図の癖を拾い、公式・Danbooruタグへ翻訳する。

## 分解

自然文をタグへ。体位は lexicon の正式名1つ。

- silver twin tails with black ribbons → `silver hair, twintails, black hair ribbon`
- 騎乗位で下から → `cowgirl position, from below`
- 四つん這い後背 → `doggystyle, sex from behind, from behind`

## 固有名

ユーザーが特定キャラのイメージを指名したとき：先に [Character_Tag_Lookup.md](Character_Tag_Lookup.md)（辞書は `user-provided/`。無ければ分解）。それ以外の明示は Character へ。不確実なら外見分解。

## 避ける

検索結果の生列挙、同義語の山、コードブロック内の日本語、SNS造語の断定、実写タグ。
