# RTMS historical bulk import policy

## Authoritative sources

Historical baseline MUST come from the official MOLIT Real Transaction Price Disclosure System bulk export. **Prefer XLSX; CSV is a fallback input only when XLSX is unavailable.**

- Public Data Portal dataset: https://www.data.go.kr/data/3050988/fileData.do
- Official export UI: https://rt.molit.go.kr/pt/xls/xls.do?mobileAt=

The official dataset describes roughly 20,000,000 rows and allows selecting building type, sale/rent, region and contract-date range, then downloading Excel/CSV. The official UI states that a province-level contract-date range is limited to one year.

## Fixed ingestion strategy

1. Historical baseline: official **XLSX-first** bulk export. CSV is fallback only.
2. Normalize each official row into the same stream schema used by the API collector.
3. Split by legal district, stream and contract month.
4. Store canonical service segments as gzip JSON: `<district>/<stream>/<YYYYMM>.json.gz`.
5. Distribute segments to the single owner in `storage-registry.json` across realestate-data-001..020.
6. Verify source row counts, segment hashes and ownership before publishing.
7. After baseline completion, OpenAPI is used only for recent incremental updates, cancellations and corrections. Do not use month-by-month OpenAPI backfill as the primary historical acquisition method.

## Stream mapping

| Transaction | Official type | Internal stream |
|---|---|---|
| sale | apartment | apartment-sale |
| sale | row house / multiplex | rowHouse-sale |
| sale | detached / multi-family | detached-sale |
| sale | officetel | officetel-sale |
| sale | presale / occupancy right | rights-sale |
| sale | commercial / business | commercial-sale |
| sale | land | land-sale |
| sale | factory / warehouse etc. | factory-sale |
| rent | apartment | apartment-rent |
| rent | row house / multiplex | rowHouse-rent |
| rent | detached / multi-family | detached-rent |
| rent | officetel | officetel-rent |

The export UI exposes apartment, row house/multiplex, detached/multi-family, officetel, presale/occupancy right, commercial/business, land, factory/warehouse etc., and sale/rent. Only combinations officially offered by the export are imported.

## Provenance

For every imported source file keep a manifest containing:
- official source URL
- download/observation timestamp
- transaction type and building type
- province / district scope
- contract-date start/end
- original filename
- original format (XLSX preferred; CSV fallback)
- byte size
- SHA-256
- parsed row count
- accepted/rejected row counts
- resulting segment count
- target shard IDs

Do not commit API keys, cookies, browser state or credentials.

## OpenAPI role after baseline

OpenAPI host: `https://apis.data.go.kr/1613000/`.
The endpoint list is defined in `scripts/rtms/catalog.json`. API refresh must be bounded to recent periods and corrections/cancellations after the historical file baseline is verified.

## Safety

- Never overwrite a newer verified segment with an older file.
- Never count a retired/mirrored copy twice.
- Never infer missing rows as zero.
- Never mark nationwide historical collection complete until every intended bulk-export scope has a provenance manifest and all resulting segments pass hash/count validation.
