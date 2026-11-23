# data/

One JSON file per dataset, named for the dataset's id in the tracker
(`states.json`, `news.json`, and so on), plus `manifest.json`.

The daily publish copies the data files here from the tracker and then runs
`python3 tools/stamp.py`, which checks them and writes `manifest.json`.
Do not edit `manifest.json` by hand. See `HANDOFF.md` in the repository root.
