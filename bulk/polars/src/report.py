import argparse
import json
import polars as pl


def build_report(input_csv_path: str) -> dict:
    frame = pl.read_csv(input_csv_path)
    return {
        "totalRows": frame.height,
        "duplicateHostnames": frame.select(
            pl.col("hostname").is_duplicated().sum()
        ).item(),
        "emptyIpRows": frame.select(
            pl.col("ip_address").is_null().sum()
        ).item(),
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Polars post-load cleanup report"
    )
    parser.add_argument("--input", required=True, help="Path to exported CSV")
    parser.add_argument("--output", required=True, help="Path to write JSON report")
    args = parser.parse_args()

    report = build_report(args.input)
    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(report, handle)


if __name__ == "__main__":
    main()