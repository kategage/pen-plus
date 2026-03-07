# PEN-Plus Clinical Resource Hub

A static site (GitHub Pages) for browsing, searching, and filtering clinical resources used in the [PEN-Plus](https://www.penplus.org/) program for severe non-communicable diseases in low-income settings.

Resources are automatically synced from a shared [Google Drive folder](https://drive.google.com/drive/folders/1AJ596cpxzQDUo685nR7Q1pM2d6dcGGgQ) containing 200+ clinical documents (PDF, DOCX, PPTX, XLSX, and Google Workspace files).

## Features

- **Browse & Filter** — filter resources by category, file type, and language
- **Keyword Search** — client-side debounced search across resource names, categories, and paths
- **Recent Updates** — dedicated page showing resources sorted by last modified date
- **Auto-Sync** — GitHub Actions workflow syncs the resource catalog from Google Drive weekly (Monday 06:00 UTC) and on manual trigger
- **Auto-Classification** — categories derived from folder structure and keyword matching; language auto-detected from folder/file names
- **No Dependencies** — plain HTML/CSS/JS frontend; Python sync script uses only the standard library

## Project Structure

```
clinical-resources/
├── index.html              # Browse page with search + filters
├── updates.html            # Recent Updates page (sorted by modified date)
├── css/styles.css          # Responsive styles
├── js/app.js               # Client-side search, filter, and render logic
├── data/resources.json     # Auto-generated resource catalog
└── sync/
    └── sync_drive.py       # Python script — crawls Google Drive API v3

.github/workflows/
└── sync-resources.yml      # Weekly + manual workflow_dispatch
```

## Setup

### Repository Secrets

Add these secrets in **Settings > Secrets and variables > Actions**:

| Secret | Description |
|--------|-------------|
| `GOOGLE_API_KEY` | Google Cloud API key with the Drive API enabled |
| `PEN_REPO_DRIVE_LINK` | Google Drive folder ID (e.g. `1AJ596cpxzQDUo685nR7Q1pM2d6dcGGgQ`) |

### GitHub Pages

1. Go to **Settings > Pages**
2. Set source to the branch and `/clinical-resources` as the root (or use `docs/` if you prefer to rename)
3. The site will be available at `https://<org>.github.io/pen-plus/`

### Running the Sync Manually

- Go to **Actions > Sync Drive Resources > Run workflow**
- Or run locally:
  ```bash
  export GOOGLE_API_KEY="your-api-key"
  export DRIVE_FOLDER_ID="1AJ596cpxzQDUo685nR7Q1pM2d6dcGGgQ"
  python clinical-resources/sync/sync_drive.py
  ```

## How It Works

1. **Sync script** (`sync_drive.py`) uses the Google Drive API v3 with an API key to recursively crawl the public Drive folder
2. It builds a JSON catalog (`resources.json`) with metadata for each file: name, type, category, language, path, link, size, and modified date
3. Categories are inferred from folder names and keyword matching (e.g. "Oncology", "Cardiology", "Training")
4. Languages are detected from folder/file name patterns (English, French, Spanish, Portuguese, Swahili, Kinyarwanda, Amharic)
5. The **GitHub Actions workflow** runs the sync weekly and commits `resources.json` if it changed
6. The **static frontend** loads `resources.json` and renders a searchable, filterable interface with no server required
