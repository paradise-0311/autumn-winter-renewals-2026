"""Copy the public aggregate snapshots to a GitHub Pages build."""

import json
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


DATA_URL = "https://autumn-winter-renewals-2026.leafy-owlet-6920.chatgpt.site/snapshots.json"


def require_fields(record, names):
    if not isinstance(record, dict) or record.keys() != set(names.split()):
        raise ValueError("Unexpected public snapshot fields")


def public_snapshots():
    request = Request(DATA_URL, headers={"User-Agent": "CodexRenewalSync/1.0"})
    with urlopen(request, timeout=20) as response:
        rows = json.load(response)
    if not isinstance(rows, list) or not rows:
        raise ValueError("No public snapshots")
    previous = ""
    for row in rows:
        require_fields(row, "time teacherCount grades teachers changes")
        if not isinstance(row["time"], str) or row["time"] <= previous:
            raise ValueError("Public snapshots are out of order")
        previous = row["time"]
        for grade in row["grades"].values():
            require_fields(grade, "enrolled renewed sameTeacher")
        for teacher in row["teachers"]:
            require_fields(teacher, "name grade enrolled renewed")
        if row["changes"] is not None:
            require_fields(row["changes"], "added removed corrected")
    return json.dumps(rows, ensure_ascii=False, separators=(",", ":")) + "\n"


if __name__ == "__main__":
    output = Path(sys.argv[1])
    try:
        payload = public_snapshots()
    except (HTTPError, URLError, TimeoutError) as error:
        if not output.is_file():
            raise
        print(f"Public snapshots unavailable ({error}). Serving the saved public copy.", file=sys.stderr)
    else:
        output.write_text(payload, encoding="utf-8")
