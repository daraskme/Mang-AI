# 漫画用フォント

2026-10-06、利用者提供の `GenEiAntique_v6.0a.zip` と [作者の利用条件](https://okoneya.jp/font/)、[公式配布一覧](https://okoneya.jp/font/download.html)、[SIL Open Font License 1.1公式本文](https://openfontlicense.org/open-font-license-official-text/) を照合した。

源暎アンチックは商用漫画・有償配布作品へ使用でき、作品へのクレジットは必須ではない。制作した漫画自体をOFLにする必要はない。アプリへの同梱・再配布は、フォントの著作権表示とOFL全文を保持して行う。フォント単体での販売はしない。改変版の予約名や作者の推奨を示す表示にはOFLの制約がある。[作者の条件](https://okoneya.jp/font/)、[OFL FAQ](https://openfontlicense.org/ofl-faq/)

Mang-AIの漫画の台詞・思考・地の文・文字には、全角等幅の通常版 **源暎アンチック v6** を標準として使う。アプリの操作UIは従来の読みやすいUI書体を使う。詰版は今回の標準書体には採用しない。文字内容や吹き出し座標は変更せず、フォントの変更で収まりが変わる場合は編集画面で調整する。

| 配布物 | 保存先と扱い |
|---|---|
| 未改変TTF | `public/fonts/genei-antique/GenEiAntiqueNv6-M.ttf` |
| 著作権表示・OFL全文 | `public/fonts/genei-antique/OFLicense.txt`。元のCP932を内容を保持してUTF-8へ変換 |
| 作者の説明書 | `public/fonts/genei-antique/README.txt`。元のUTF-16をUTF-8へ変換 |

TTFのSHA-256：`a04b166a260e67635bff99512355a14de459620df6451d1ee72b4d072370df55`。フォントの改名・サブセット化・グリフ改変はしていない。アプリのライセンスとは別に、フォントはOFL 1.1のまま配布する。

エディターは同梱フォントを読み込む。ギャラリーの漫画ページ、ダウンロードSVG、作品書き出しSVGには未改変TTFを埋め込み、同時にmetadataへ著作権表示とOFL全文を収録する。これにより別PCでもOSへのフォントインストールを要しない。作品書き出しには読みやすい `FONT-LICENSE.txt` も添える。PNGには描画結果を焼き込み、漫画の表面へライセンス文を表示しない。
