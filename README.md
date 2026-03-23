# GeoMCP

MCP server de doc de hinh hoc va ve hinh chinh xac duoi dang SVG.

## Chuc nang hien tai

- Nhan de bai hinh hoc dang text (Tieng Viet hoac Tieng Anh co cau truc co ban)
- Parse cac doi tuong:
  - Diem (A, B, C...)
  - Doan co do dai (AB = 3)
  - Tam giac (tam giac ABC)
  - Dieu kien vuong tai diem (vuong tai A)
  - Tam giac can tai dinh, tam giac deu
  - Tam giac vuong (vi du: `tam giac vuong ABC tai A`)
  - Trung diem (M la trung diem cua AB)
  - Diem thuoc doan (D thuoc BC)
  - Hai duong thang song song (AB song song voi CD)
  - Hai duong thang vuong goc (AB vuong goc voi CD)
  - Duong cao, trung tuyen, phan giac
  - Tiep tuyen tai mot diem cua duong tron
  - Duong tron noi tiep, duong tron ngoai tiep tam giac
  - Duong tron theo duong kinh (duong tron duong kinh AB)
  - Tu giac co ban chuong trinh lop 6-9: hinh chu nhat, hinh vuong, hinh binh hanh, hinh thang
  - Duong tron tam-ban kinh
- Sinh toa do phu hop va render SVG
- Tra ve `diagnostics` de bao cac rang buoc chua du du kien

## Cai dat

```bash
npm install
```

## Chay dev

```bash
npm run dev
```

## Build va chay

```bash
npm run build
npm start
```

## Demo tuong tac

Co san mot demo HTML keo-tha cho bai toan mau:

```bash
open interactive-demo.html
```

Trong demo nay, ban co the keo diem `E` tren duong tron va cac diem phu thuoc nhu `A`, `B`, `H` se cap nhat theo rang buoc cua bai toan.

## Dua len GitHub va cho moi nguoi su dung

1. Tao repository moi tren GitHub (de o che do Public).
2. Trong thu muc du an, chay:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<username>/<repo>.git
git push -u origin main
```

3. Bat GitHub Pages:
  - Vao `Settings` -> `Pages`
  - `Source`: chon `Deploy from a branch`
  - `Branch`: chon `main` va folder `/ (root)`

4. Link cong khai se co dang:

```text
https://<username>.github.io/<repo>/
```

Trang nay se tu dong mo `interactive-demo.html` qua file `index.html`.

## Cau hinh MCP client

Vi du trong cau hinh MCP client, tro den lenh start:

```json
{
  "mcpServers": {
    "geomcp": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/GeoMCP/dist/index.js"]
    }
  }
}
```

## Tool cung cap

- `read_and_draw_geometry`
  - Input:
    - `problem` (string): de bai hinh hoc
  - Output:
    - JSON gom `parsed`, `layout`, `svg`

- `read_and_draw_geometry_v2_llm`
  - Input:
    - `problem` (string): de bai hinh hoc
    - `llmModel` (string, optional): model LLM
    - `fallbackToHeuristic` (boolean, optional, mac dinh `true`)
    - `useConstraintSolver` (boolean, optional, mac dinh `true`)
    - `solverIterations` (number, optional, mac dinh `160`)
  - Output:
    - JSON gom `parserVersion`, `solver`, `warnings`, `parsed`, `layout`, `svg`

## Version 2 (LLM parser)

Version cu van giu nguyen qua tool `read_and_draw_geometry`.
Version 2 dung LLM qua tool `read_and_draw_geometry_v2_llm`.

Version 2 da bo sung day du 3 huong:

1. Dung LLM de trich xuat structure JSON schema
2. Them bo giai rang buoc hinh hoc (constraint solver lap)
3. Tu dong suy dien va xu ly them quan he: duong cao, trung tuyen, tiep tuyen, vuong goc, diem thuoc duong, diem thuoc duong tron

Dat bien moi truong truoc khi chay server:

```bash
export GEOMCP_OPENAI_API_KEY="<your_api_key>"
export GEOMCP_OPENAI_MODEL="gpt-4.1-mini"
# optional
export GEOMCP_OPENAI_BASE_URL="https://api.openai.com/v1"
```

## Vi du de bai

```text
Cho tam giac ABC, AB = 5, AC = 6, BC = 7.
Ve duong cao tu A xuong BC tai H.
Ve trung tuyen tu B den M.
Ve phan giac cua goc BAC cat BC tai E.
AB song song voi DE.
AH vuong goc voi BC.
Ve duong tron noi tiep tam giac ABC va duong tron ngoai tiep tam giac ABC.
```

## Mau cau de parser nhan tot

- Song song: `AB song song voi CD`
- Vuong goc: `AB vuong goc voi CD`
- Duong cao: `duong cao tu A xuong BC tai H`
- Trung tuyen: `trung tuyen tu B den M` (M se la trung diem canh doi dien neu xac dinh duoc tam giac)
- Phan giac: `phan giac cua goc BAC cat BC tai E`
- Tiep tuyen: `tiep tuyen tai P cua duong tron tam O`
- Noi tiep: `duong tron noi tiep tam giac ABC`
- Ngoai tiep: `duong tron ngoai tiep tam giac ABC`
- Tam giac vuong: `tam giac vuong ABC tai A`
- Duong kinh: `duong tron duong kinh AB`
- Hinh chu nhat: `hinh chu nhat ABCD`
- Hinh vuong: `hinh vuong ABCD`
- Hinh binh hanh: `hinh binh hanh ABCD`
- Hinh thang: `hinh thang ABCD`

Tool se tra ve chuoi SVG ban co the luu thanh file `.svg` de xem hinh.

## Ghi chu

Ban MVP nay dung parser heuristic va bo dung hinh hinh hoc so cap. De dat do chinh xac cao voi de phuc tap, buoc tiep theo nen:

1. Dung LLM de trich xuat structure (JSON schema)
2. Them bo giai rang buoc hinh hoc day du (constraint solver)
3. Tu dong xu ly them quan he song song, phan giac, tiep tuyen, duong cao...
