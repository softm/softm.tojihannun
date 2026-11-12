# RTMS bulk ingestion layout

The historical loader accepts official XLSX first and CSV only as a fallback.

## Input naming

Place an official export in an ingestion workspace using:

```
inbox/<stream>/<province>/<YYYY>-<stream>-<province>.xlsx
```

Examples:

```
inbox/apartment-sale/서울특별시/2025-apartment-sale-서울특별시.xlsx
inbox/apartment-rent/경기도/2025-apartment-rent-경기도.xlsx
inbox/rowHouse-sale/충청남도/2024-rowHouse-sale-충청남도.xlsx
```

Do not commit the original workbook merely for archival duplication. Before removal, generate and retain its provenance manifest with SHA-256, bytes, parsed row count and scope.

## Canonical output

```
data/transactions/segments/<district>/<stream>/<YYYYMM>.json.gz
```

The gzip JSON is the canonical service payload. A segment may be replaced only after the entire XLSX scope is parsed and validated.

## Distribution

The authoritative owner for each district is `data/transactions/storage-registry.json`.
The importer must route every output segment to exactly one of `realestate-data-001..020`.
Never duplicate a segment into multiple active owners.

## Incremental phase

Once all intended historical XLSX scopes have manifests and verified segments, scheduled OpenAPI workers refresh only recent data and cancellations/corrections.
