from __future__ import annotations

import json
import re
from datetime import date, datetime
from decimal import Decimal

from nexus.shared.domain.errors import CapabilityUnavailableError, ValidationError

MAX_INPUT_ROWS = 5000
MAX_INPUT_COLUMNS = 64
MAX_RESULT_ROWS = 1000


def validate_sql_payload(payload: dict[str, object]) -> tuple[str, list[dict[str, object]]]:
    query = str(payload.get("query") or "").strip()
    if not query:
        raise ValidationError("query is required")
    rows = payload.get("rows")
    if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
        raise ValidationError("rows must be an array of objects")
    if len(rows) > MAX_INPUT_ROWS:
        raise ValidationError(f"sql_read accepts at most {MAX_INPUT_ROWS} input rows")
    clean = re.sub(r"/\*.*?\*/|--[^\n]*", " ", query, flags=re.DOTALL).strip()
    if not re.match(r"^(select|with)\b", clean, flags=re.IGNORECASE):
        raise ValidationError("sql_read only accepts SELECT or WITH queries")
    forbidden = re.compile(
        r"\b(attach|call|copy|create|delete|drop|export|import|insert|install|load|pragma|"
        r"update|alter|read_(?:csv|json|ndjson|parquet)\w*|parquet_scan|csv_scan|"
        r"json_scan|glob|httpfs|sqlite_scan|postgres_scan|shell|secret)\b",
        flags=re.IGNORECASE,
    )
    if (
        forbidden.search(clean)
        or ";" in clean.rstrip(";")
        or re.search(r"\b(from|join)\s+['\"]", clean, flags=re.IGNORECASE)
        or "://" in clean
    ):
        raise ValidationError("sql_read query contains a forbidden operation")
    columns = {str(key) for row in rows for key in row}
    if not columns or len(columns) > MAX_INPUT_COLUMNS:
        raise ValidationError(
            f"rows must contain between 1 and {MAX_INPUT_COLUMNS} columns"
        )
    return query, rows  # type: ignore[return-value]


def execute_sql_payload(payload: dict[str, object]) -> dict[str, object]:
    query, rows = validate_sql_payload(payload)
    try:
        import duckdb
    except ImportError as exc:
        raise CapabilityUnavailableError("DuckDB is unavailable in the sandbox image") from exc
    columns = sorted({str(key) for row in rows for key in row})
    types = {column: _duckdb_type([row.get(column) for row in rows]) for column in columns}
    quoted = {column: '"' + column.replace('"', '""') + '"' for column in columns}
    connection = duckdb.connect(":memory:")
    try:
        connection.execute("SET memory_limit='128MB'")
        connection.execute("SET threads=1")
        connection.execute("SET enable_external_access=false")
        connection.execute(
            "CREATE TABLE input ("
            + ", ".join(f"{quoted[column]} {types[column]}" for column in columns)
            + ")"
        )
        placeholders = ", ".join("?" for _ in columns)
        connection.executemany(
            f"INSERT INTO input VALUES ({placeholders})",
            [[_sql_value(row.get(column)) for column in columns] for row in rows],
        )
        cursor = connection.execute(query)
        result_columns = [item[0] for item in cursor.description]
        result_rows = cursor.fetchmany(MAX_RESULT_ROWS + 1)
        return {
            "columns": result_columns,
            "rows": [
                [_json_scalar(value) for value in row]
                for row in result_rows[:MAX_RESULT_ROWS]
            ],
            "truncated": len(result_rows) > MAX_RESULT_ROWS,
            "sandboxed": True,
        }
    finally:
        connection.close()


def _duckdb_type(values: list[object]) -> str:
    present = [value for value in values if value is not None]
    if present and all(isinstance(value, bool) for value in present):
        return "BOOLEAN"
    if present and all(isinstance(value, int) and not isinstance(value, bool) for value in present):
        return "BIGINT"
    if present and all(isinstance(value, (int, float)) for value in present):
        return "DOUBLE"
    return "VARCHAR"


def _sql_value(value: object) -> object:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def _json_scalar(value: object) -> object:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return str(value)
