# GeoMCP v2-llm-parser

Version thu 2 bo sung parser dung LLM, van giu nguyen parser cu.

## Highlights

- Them tool moi: `read_and_draw_geometry_v2_llm`
- Parse de bai bang LLM roi tiep tuc build layout + render SVG nhu pipeline hien tai
- Co tuy chon `fallbackToHeuristic` de tu dong quay ve parser cu khi LLM loi
- Khong pha vo tool cu `read_and_draw_geometry`

## New Environment Variables

- `GEOMCP_OPENAI_API_KEY` hoac `OPENAI_API_KEY`
- `GEOMCP_OPENAI_MODEL` (optional)
- `GEOMCP_OPENAI_BASE_URL` (optional)

## Compatibility

- Backward compatible voi v1
- Khuyen nghi cho de bai da dang ngon ngu va cau truc phuc tap hon
