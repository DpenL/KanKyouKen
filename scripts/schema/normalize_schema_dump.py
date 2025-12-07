#!/usr/bin/env python
import sys
import pathlib
import os

ROOT = pathlib.Path(os.getenv("PROJECT_ROOT"))

sys.path.insert(0, str(ROOT))  # allow imports from project root
from scripts.schema.normalize import normalize


def main():
    infile = sys.argv[1]
    outfile = sys.argv[2]

    text = open(infile, "r", encoding="utf8").read()
    cleaned = normalize(text)
    open(outfile, "w", encoding="utf8").write(cleaned)

if __name__ == "__main__":
    main()
