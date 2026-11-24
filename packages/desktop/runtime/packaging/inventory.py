"""Record the actual shipped Python and Node distributions for release review."""
from importlib.metadata import distributions
import json
from pathlib import Path
import sys

root = Path(sys.argv[1]).resolve()
rows = []
for dist in distributions():
    meta = dist.metadata
    notices = [str(Path(dist.locate_file(f)).relative_to(root)) for f in dist.files or []
               if any(part.lower().startswith(("license", "licence", "copying", "notice")) for part in f.parts)]
    rows.append({"ecosystem": "python", "name": meta["Name"], "version": dist.version,
                 "license": meta.get("License-Expression") or meta.get("License") or "see package notices",
                 "notices": notices})
for path in (root / "agent-runtime/node_modules").rglob("package.json"):
    if not (path.parent.parent.name == "node_modules" or path.parent.parent.name.startswith("@")):
        continue
    data = json.loads(path.read_text("utf-8"))
    if data.get("name") and data.get("version"):
        rows.append({"ecosystem": "npm", "name": data["name"], "version": data["version"],
                     "license": data.get("license", "see package notices")})
(root / "licenses/components.json").write_text(json.dumps(sorted(rows, key=lambda r: (r["ecosystem"], r["name"])),
                                                         indent=2) + "\n", encoding="utf-8")
