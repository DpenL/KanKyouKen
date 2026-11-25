# Where components sit, and structure modes for an assembly game

**Source limits.** The session's network blocks page fetches from kanjivg.tagaini.net and unicode.org, so **every web source below was seen only as a search snippet**. What could be checked was checked against local primary data: the Unicode Character Database 15.1 (Python `unicodedata`), the KanjiVG checkout at commit 9d7220d (the same commit as our cache) and the Make Me a Hanzi checkout. The Heisig Moodle slides are not in this session, and full-text copies of RTK that looked unauthorised.

## 1. Position classes and how they map

| Japanese [W1–W3] | Sits | IDS | KanjiVG label | Most frequent in KanjiVG |
|---|---|---|---|---|
| 偏 hen | left | ⿰ left | `left` | 氵 木 亻 扌 糸 |
| 旁 tsukuri | right | ⿰ right | `right` | 口 攵 刂 頁 |
| 冠 kanmuri | top | ⿱ top | `top` | 亠 艹 宀 |
| 脚 ashi | bottom | ⿱ bottom | `bottom` | 八 口 心 |
| 垂 tare | top and left | ⿸ | `tare`/`tarec` | 广 尸 疒 厂 虍 |
| 繞 nyō | left and bottom | ⿺ | `nyo`/`nyoc` | 辶 廴 走 鬼 |
| 構 kamae | encloses | ⿴ 囗; ⿵ 門 冂; ⿶ 凵; ⿷ 匚; ⿹ 勹 弋 气; 行 split around its content | `kamae`/`kamaec`, rarely `⿵A/B`, `⿶1/2` | 門 囗 匚 行 |
| (none) | | ⿲ ⿳ ⿻ ⿼ ⿽ | none | |

- The Japanese names belong to the **radical**: "kihen" is 木 used as a hen, and the partner gets no name [W2, W7]. KanjiVG labels every group, radical or not.
- The names follow tradition, not geometry. 虍 is toragashira/torakanmuri, a top name [W4], yet it wraps from the upper left, and KanjiVG labels it `tare` 50 times. That *-gashira* variant of kanmuri is the only finer class I could source.
- **Chinese.** 偏旁 once meant the left (偏) and right (旁) sides; now it means any component [W6]. Positions are named 头 (top), 底 (bottom) and 框 (frame); two blog-level sources disagree on 旁 versus 边 for the sides [W8]. Structure classes: 独体, 左右, 上下, 左中右, 上中下, 全包围, several 半包围 and 镶嵌. Wikipedia counts 13 first-level categories (⿸: 廣 居 病) [W9]. GF 0014-2009 names 514 basic components [W10].
- **IDS.** Names confirmed locally in UCD 15.1: ⿰ LEFT TO RIGHT, ⿱ ABOVE TO BELOW, ⿲/⿳ with MIDDLE, ⿴ FULL SURROUND, ⿵ SURROUND FROM ABOVE, ⿶ FROM BELOW, ⿷ FROM LEFT, ⿸ FROM UPPER LEFT, ⿹ FROM UPPER RIGHT, ⿺ FROM LOWER LEFT, ⿻ OVERLAID, ⿼ FROM RIGHT, ⿽ FROM LOWER RIGHT. ⿾ ⿿ ㇯ reflect, rotate or subtract rather than place. U+2FF0–2FFB came from GBK in Unicode 3.0, and 2FFC–2FFF arrived in 15.1 [W11]. IRG guidelines prefer minimal decompositions and avoid ⿻ [W12].
- **Measured mapping (ours).** I compared KanjiVG's top-level labels with Make Me a Hanzi's first IDS operator for the 5,190 characters in both. Agreement: ⿰ to left+right 2,993/3,022; ⿱ to top+bottom 1,278/1,362; ⿸ to tare 189/236 (反 右 在 unlabelled); ⿺ to nyo 125/128; ⿴ 21/28, ⿷ 12/14, ⿵ 46/70 and ⿹ 21/37 to kamae. KanjiVG writes ⿲/⿳ as nested pairs (17/21, 54/57). ⿻ is mostly unlabelled, and 術 街 衛 are ⿻ there but kamae in KanjiVG. Make Me a Hanzi describes Chinese forms: it has no 効 or 関, and its 往 differs.
- **Heisig** (snippets only). RTK orders kanji by "primitive elements", which may be radicals, kanji or nameless stroke groups [W14]. Position changes a primitive: 一 above another primitive is "ceiling" and below is "floor" (study notes) [W15]; 水 "can be written with three drops to the left of another primitive" (fan page quoting the book) [W16]. **Not verified:** any general position scheme of Heisig's, his enclosure names, the course slides.

## 2. What our data holds

**Cache** (192 entries: 186 SVGs and 6 `.missing` markers). There are 269 positions in 101 files: top 66, bottom 66, left 61, right 61, kamae 13 (門 in 7 characters; 囗 twice each in 回 因 困), nyo 1 and nyoc 1 (返). `kvg:part` appears as 9 pairs: 囗 (回因困), 二 (五吾語), 亠 (主), 干 (午), 日 (由).

**Full KanjiVG** (6,984 base files of 11,941). Positions: bottom 6,892, top 6,883, right 6,048, left 6,042, tare 445, tarec 426, kamae 331, nyo/nyoc 229 each, kamaec 21, ⿵A 11, ⿵B 6, middle 5, ⿶1 3, ⿶2 2. `kvg:part` 1/2/3/4 occurs 1,771/1,742/107/4 times in 1,268 files, most often on 弋, 十, 戈, 囗, 二 and 匚.
- Top-level splits are fully labelled in 6,337 of 6,534 split characters (97%). Inner splits: only 3,985 of 8,689 (46%). Taking labels from the component's own file adds 821 (55%). The labels are inconsistent: 寺 has top/bottom in 待特侍 but nothing in 持時詩.
- Depth of nested positioned groups: 0: 595, 1: 1,857, 2: 2,958, 3: 1,320, 4+: 254.
- File order is stroke order: `nyoc` comes before `nyo` in 120 files (辶 is written last) and after it in 54 (起).
- Variant forms by position are marked `kvg:variant` plus `kvg:original`: 氵←水, 扌←手, 忄←心, 亻←人, 刂←刀, ⻏←邑, 灬←火.
- KanjiVG's documentation says a position is relative to sibling groups and optional, and that kamae and middle are used inconsistently [W13].

**Our code.** `kanjivg.ts` `mapKanjiVGPosition` passes left, right, top, bottom and middle through. It maps kamae, tare and nyo, and IDC+A/1, to `enclosure`; their `…c` forms and IDC+B/2 map to `inside`. The raw label is kept as `positionDetail`, an unlabelled sibling of an enclosure becomes `inside`, `kvg:part` is stored as `n`, and `kvg:variant` is dropped. `decompose.ts` `encloseHint` reads only tare (top-left) and nyo (bottom-left); a kamae's shape comes from its strokes. Left, right, top and bottom never choose the frame: `layoutFromBoxes` cuts over the parts' boxes. `layout.ts` has rows, columns and seven enclosure shapes (⿴ ⿵ ⿶ ⿷ ⿸ ⿹ ⿺, but no ⿻ ⿼ ⿽). Its catalogue holds 9, 20 and 28 structures for 2, 3 and 4 slots.

## 3. Structure modes, simplest first

The starter set has 38 characters. At up to 4 slots they come out as R(S,S) 19; R(S,C(S,S)) 9 (持待特侍時詩路格絡); E:top(S) 6 (門 family); and one each of 閣 E:top(C(S,S)), 落 C(S,R(S,C(S,S))), 客 C(S,S,S) and 返 E:bottom-left. At 2 slots: ⿰ 28, ⿵ 7, ⿱ 2, ⿺ 1.

**(a) One fixed set of frames**, for example ⿰ ⿱ ⿵ ⿺ every round.
- *Data:* the right frame for each character.
- *Coverage:* all 38 at 2 slots. At 4 slots all 7 structures are needed; the three most common cover 34.
- *Breaks:* picking becomes a reflex (28 of the 38 are ⿰), and the catalogue grows too fast (9, 20, 28) to show the finer splits. Suits an easy or first-run mode.

**(b) Alternatives per character** (Kumiki now; Zen Hanzi also stores one fixed, nested layout per character, e.g. 想 = `s_H` with `part_1` `s_V`, MECHANICS ZH-11).
- *Data:* the right structure (from the stroke boxes, or written into the set file) and the catalogue for the wrong ones.
- *Coverage:* 38/38, none guessed.
- *Breaks:* characters with a guessed layout (原) are left out; the slot count gives the part count away; only one of several defensible groupings counts (客 is C(S,S,S), not C(S,C(S,S))).

**(c) Frames from positions.** left+right gives ⿰, top+bottom ⿱, tare ⿸, nyo ⿺. For kamae, a table of about 12 elements gives the shape: 門冂 ⿵, 囗 ⿴, 匚匸 ⿷, 凵 ⿶, 勹弋戈气 ⿹, 行 a split row.
- *Data:* labels at every split, plus that table.
- *Coverage:* the top level is labelled for all 38. One level down, 寺 has no labels in 持時詩 and 各 none in 客, but 寺.svg and 各.svg do, so borrowing fixes all four. 反 (厂 又) has no labels anywhere, which matters only once it is split.
- *Breaks:* across KanjiVG, 45% of inner splits still need the geometry fallback; kamae does not say its shape; label order is not slot order; ⿲ comes out as pairs (斑 = 王 + [文 王]).
- *Gains:* "hen or tsukuri?" becomes something to ask the player, and `kvg:original` gives wrong-form distractors (水 offered where 氵 belongs).

**(d) Recursive assembly.** For 持, first build 寺 from 土 over 寸 in a sub-frame, then place 寺 as one tile in ⿰.
- *Data:* a frame for every level (from (c) or from geometry), and a tile for every intermediate part (its own glyph, or its strokes cut from the target).
- *Coverage:* 11 of the 38 are nested (the 9 R(S,C(S,S)), 落, 閣); for the other 27 this mode is the same as (b) or (c).
- *Breaks:* each level adds a step and another frame to choose. Some inner parts are not characters (龶, 𠂊, KanjiVG's CDP codes), so they have no name or tile. A component written in two goes (囗, 行, 弋) must stay one tile. A part changes shape with its position (木 narrows as a hen), so a sub-assembly looks squashed unless it is cut from the target's strokes.
- *Most dynamic version:* pick a part's sub-frame and form from where its parent puts it (女 on the left in 好, at the bottom in 妾 [W5]). This is where the hen/kanmuri rules come in: narrow a hen, flatten a kanmuri, take the variant form from `kvg:original`.

## Sources (all seen only as search snippets)

W1 https://www.wikiwand.com/en/articles/Simplified_table_of_Japanese_kanji_radicals · W2 https://hugkum.sho.jp/727585 (Shogakukan) · W3 https://kanjialive.com/214-traditiona · W4 https://ja.wiktionary.org/wiki/%E2%BB%81 · W5 https://www.wikipedia.org/wiki/Chinese_radical · W6 https://www.zdic.net/hant/偏旁 · W7 https://www.weblio.jp/content/部首 · W8 https://www.sohu.com/a/422293873_498038 and https://2blog.ilc.edu.tw/wp-content/uploads/sites/1163/24/24-2642056.pdf (blog-level) · W9 https://en.wikipedia.org/wiki/Chinese_character_structures · W10 https://en.wikipedia.org/wiki/Chinese_character_components · W11 https://www.unicode.org/charts/PDF/U2FF0.pdf · W12 https://www.unicode.org/irg/docs/n1107-IDSDecompositionGuidelines.pdf · W13 https://kanjivg.tagaini.net/svg-format.html · W14 https://en.wikipedia.org/wiki/Remembering_the_Kanji · W15 https://knowt.com/note/87bf076f-2843-4997-8975-299a8403eeed/Untitled · W16 https://hrussellzfac023.github.io/rtk/水/index.html · More IDS data for later: https://github.com/cjkvi/cjkvi-ids

The scripts that produced the counts were throwaway and are not kept; the counts can be redone over a KanjiVG checkout at the same commit.
