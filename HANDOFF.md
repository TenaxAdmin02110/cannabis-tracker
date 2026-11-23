# National Cannabis Outlook Tracker: client site handoff

For Brooks. Written November 23, 2026, from Aimee's Claude session.

## What this is

A copy of the tracker that runs without Claude, at a Tenax address, so it can be shared with clients:

- **Address:** `https://tracker.tenaxstrategies.com`
- **Repository:** `TenaxAdmin02110/cannabis-tracker` on GitHub (public), served by GitHub Pages

The tracker in Claude stays the working version. This site shows whatever page and data files are in the repository, so it is current only when the daily refresh also publishes here. That publish step is the part that needs you.

## Status

| Step | Who | State |
|---|---|---|
| Standalone site built and tested with mock data | Aimee's Claude | Done |
| GitHub account `TenaxAdmin02110` and the repository | Aimee | Done |
| Site files uploaded; GitHub Pages on, serving the `main` branch | Aimee's Claude | Done November 23 |
| Custom domain `tracker.tenaxstrategies.com` set on the repository | Aimee's Claude | Done November 23 |
| DNS record at GoDaddy: CNAME `tracker` to `tenaxadmin02110.github.io` | Aimee's Claude | Done November 23 |
| "Enforce HTTPS" ticked in the repository's Settings, Pages | Aimee | To do once GitHub has issued the certificate (up to an hour after setup) |
| Push access to the repository from your Claude | Brooks | To do |
| First publish with real data, checked against the tracker | Brooks | To do |
| Publish step added to the daily refresh | Brooks | To do |

Until the first publish, the site shows "This tracker has not been published yet."

## How the site is put together

| Path | What it is | Changes when |
|---|---|---|
| `page/index.html` | The tracker's page, exactly as stored in the tracker | Every publish |
| `data/<id>.json` | One file per dataset, named for the dataset's id | Whenever that dataset changes |
| `data/manifest.json` | List of datasets, written by `tools/stamp.py` | Every publish, by the script |
| `index.html`, `assets/` | The shell and the code that stands in for Claude's dashboard framework | Rarely, by hand |
| `tools/` | The publish check and a helper | Rarely, by hand |

The site reads the tracker's own page, so edits you make to the tracker's page in Claude carry over at the next publish with no rebuild.

The 12 datasets, and their file names here:

| Dataset id | File in the tracker | File in the repository |
|---|---|---|
| `states` | states.json | `data/states.json` |
| `news` | news.json | `data/news.json` |
| `events` | events.json | `data/events.json` |
| `odds` | odds.json | `data/odds.json` |
| `players` | players.json | `data/players.json` |
| `pathways` | pathways.json | `data/pathways.json` |
| `senate` | senate.json | `data/senate.json` |
| `munis` | munis.json | `data/munis.json` |
| `munigeo` | munigeo.json | `data/munigeo.json` |
| `basemap` | basemap.json | `data/basemap.json` |
| `counties` | **counties2.json** | `data/counties.json` |
| `shapes` | **shapes2.json** | `data/shapes.json` |

The file name here is always the dataset's id, whatever the file is called in the tracker.

## One-time setup

### 1. Give your Claude push access

Your Claude needs to push to `TenaxAdmin02110/cannabis-tracker`. Two ways:

- **Use the Tenax account:** connect the `TenaxAdmin02110` GitHub account to your Claude. Aimee has the login.
- **Use your own GitHub account:** Aimee adds it as a collaborator on the repository, and you connect that account to your Claude.

Either way, the Claude GitHub app has to be allowed on this repository. If a push is refused, Claude's message says which of these is missing.

### 2. First publish

Do this in a Claude session on your account, because only the tracker's owner can read its data files.

1. Clone the repository.
2. Save all 12 data files from the tracker to disk and copy each to `data/<id>.json` (table above). Copy the files as they are. Claude must not retype or regenerate their contents; the map files are large and one slip breaks a map.
3. Save the tracker's page (the stored text of its `index.html`) to disk with the tool's save-to-file option, then run `python3 tools/save_page.py <saved file>`. The helper accepts the page's HTML or the stored document that wraps it.
4. Run `python3 tools/stamp.py`. It checks every file the page reads and writes `data/manifest.json`. Publish only if it prints `OK TO PUBLISH`.
5. Preview before pushing: run `python3 -m http.server 8000` in the repository folder and open `http://localhost:8000`.
6. Commit and push to `main`. GitHub Pages updates the site within a few minutes.

### 3. Check it against the tracker

Open the site and the tracker side by side. The site was tested only with mock data shaped the way the page's code reads it, so this is the first real test.

- **Federal page:** the three counts, the map and its dots, news, deadlines, odds, key players, Senate table.
- **A state with a change coming** (the "Coming up" card), a **banned state** (pathway card), and a **state with no local data**.
- **Municipal map:** shading, county lines, labels, and the detail panel when you click an area.
- **News tabs and search**, on the federal page and a state page.
- **A phone-width window.**
- **Spacing and link style:** see "Differences from the tracker" below.

If `stamp.py` warns that a column is missing, check the part of the page that uses it. Its list of expected columns (`tools/expected-columns.json`) was written from the page's code, without sight of the real data.

## The daily publish step

Add this to the end of the refresh task's instructions:

```text
AFTER THE TRACKER IS REFRESHED: PUBLISH THE CLIENT SITE

The client-facing copy of this tracker is the GitHub repository
TenaxAdmin02110/cannabis-tracker, served at https://tracker.tenaxstrategies.com.
Publish to it at the end of every run, after the tracker itself has been
updated and checked. Never publish from a run in which the tracker's own
update failed or was skipped.

1. Clone the repository (branch main).
2. For every dataset file this run changed in the tracker, copy that same file
   from disk to data/<dataset id>.json in the repository. The file name is the
   dataset's id: states, news, events, odds, players, pathways, senate, munis,
   munigeo, basemap, counties (counties2.json in the tracker) and shapes
   (shapes2.json in the tracker). Copy with a shell command, byte for byte.
   Never retype or regenerate a file's contents. Leave files this run did not
   change as they are.
3. Save the tracker's current page (the stored text of its index.html) to disk
   with the tool's save-to-file option, not by retyping it, and run:
   python3 tools/save_page.py <saved file>
4. Run: python3 tools/stamp.py
   If it prints DO NOT PUBLISH, do not commit or push. Report its errors in the
   run summary and stop.
5. Change nothing else in the repository (index.html, assets/, tools/, CNAME,
   .nojekyll).
6. Commit with the message "Publish <YYYY-MM-DD>" and push to main. If nothing
   changed, skip the commit.
7. In the run summary, say whether the site was published, which files
   changed, and any warnings stamp.py printed.
```

## Differences from the tracker in Claude

- **Not carried over:** the Sources panel, comments and the edit pencil. They are Claude features.
- **Added by the site:** one line under the page, "Data last updated <date>", taken from the date a data file last changed.
- **Search engines:** the page is marked `noindex`, so it is reached only by its link. Delete that line in `index.html` to change this. Anyone with the link can open the site; there is no password.
- **Fonts:** the site loads Cormorant and Nunito Sans for readers who lack the brand fonts. In Claude, a reader sees those faces only if they are installed. Avenir still comes first for readers who have it.
- **Spacing:** the framework's spacing values are not published, so the ones in `assets/tokens.css` are approximations. Adjust them there if cards look tighter or looser than in the tracker.
- **Links:** links the page does not style itself are underlined in the text color. That is a choice made for this site.
- **Dark theme:** follows the reader's device setting, using the tracker's dark colors.
- **Look changes:** colors, fonts and corners are copied into `assets/tokens.css`. A later change to the tracker's look in Claude is not picked up until that file is updated.
- **Claude-only features:** if the page later uses `claude.use(...)` or a file stored in the tracker (`/_blob/...`), that part will not work here. `stamp.py` warns when it sees either.

## If something goes wrong

| What you see | Cause | Fix |
|---|---|---|
| "This tracker has not been published yet." | `data/manifest.json` is not in the repository | Run the first publish |
| "Some of this tracker's data did not load." | A file listed in the manifest is missing or broken | Run `python3 tools/stamp.py`, fix what it reports, push |
| A section is blank or a map is empty | The page changed and reads a column or dataset the files lack | Compare with the tracker; `stamp.py` names missing datasets |
| A bad publish went out | | Revert the last commit and push; the site returns to the previous version |

## What was and was not tested

- **Tested:** the site in Chrome with mock data, 75 checks covering the federal page, state pages, tabs, search, the municipal map, direct links to a state, a 400-pixel window, the dark theme, a missing data file and an unpublished site. The publish check's refusals were tested too.
- **Not tested:** real data. Aimee's account cannot read the tracker's data files.
- **The page copy in this package** is version 69 of the tracker's page (November 23). It was copied by hand through the conversation, so treat it as a placeholder. Your first publish replaces it with the tracker's own copy.
