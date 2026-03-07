#!/usr/bin/env python3
"""
Sync Google Drive folder contents to resources.json for the PEN-Plus Clinical Resource Hub.

Uses Google Drive API v3 with an API key (no OAuth required for public folders).
Standard library only - no external dependencies.
"""

import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime

API_KEY = os.environ.get("GOOGLE_API_KEY", "")
_RAW_FOLDER = os.environ.get("DRIVE_FOLDER_ID", "")


def extract_folder_id(raw):
    """Extract a bare folder ID from a full Drive URL or return as-is."""
    if not raw:
        return ""
    # Handle full URLs like https://drive.google.com/drive/folders/1ABC...
    m = re.search(r"/folders/([A-Za-z0-9_-]+)", raw)
    if m:
        return m.group(1)
    # Handle URLs with id= parameter
    m = re.search(r"[?&]id=([A-Za-z0-9_-]+)", raw)
    if m:
        return m.group(1)
    # Already a bare ID
    return raw.strip()


ROOT_FOLDER_ID = extract_folder_id(_RAW_FOLDER)
DRIVE_API = "https://www.googleapis.com/drive/v3"

# File type mappings
FILE_TYPE_MAP = {
    "application/pdf": "PDF",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PPTX",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
    "application/vnd.google-apps.document": "Google Doc",
    "application/vnd.google-apps.spreadsheet": "Google Sheet",
    "application/vnd.google-apps.presentation": "Google Slides",
    "application/vnd.google-apps.folder": "folder",
    "application/msword": "DOC",
    "application/vnd.ms-excel": "XLS",
    "application/vnd.ms-powerpoint": "PPT",
    "image/png": "PNG",
    "image/jpeg": "JPEG",
    "video/mp4": "MP4",
}

# Language detection patterns
LANGUAGE_PATTERNS = {
    "French": [r"\bfr\b", r"\bfrench\b", r"\bfrançais\b", r"\bfrancais\b"],
    "Spanish": [r"\bes\b", r"\bspanish\b", r"\bespañol\b", r"\bespanol\b"],
    "Portuguese": [r"\bpt\b", r"\bportuguese\b", r"\bportuguês\b", r"\bportugues\b"],
    "Swahili": [r"\bsw\b", r"\bswahili\b", r"\bkiswahili\b"],
    "Kinyarwanda": [r"\brw\b", r"\bkinyarwanda\b"],
    "Amharic": [r"\bam\b", r"\bamharic\b"],
}

# Category keywords for classification
CATEGORY_KEYWORDS = {
    "Oncology": ["oncology", "cancer", "tumor", "tumour", "chemotherapy", "palliative"],
    "Cardiology": ["cardiology", "cardiac", "heart", "cardiovascular", "ecg", "echo"],
    "Endocrinology": ["endocrine", "diabetes", "thyroid", "insulin", "hba1c"],
    "Hematology": ["hematology", "haematology", "sickle cell", "anemia", "anaemia", "blood"],
    "Nephrology": ["nephrology", "kidney", "renal", "dialysis", "ckd"],
    "Neurology": ["neurology", "neuro", "epilepsy", "seizure", "stroke"],
    "Pulmonology": ["pulmonology", "pulmonary", "respiratory", "asthma", "copd", "lung"],
    "Rheumatology": ["rheumatology", "rheumatic", "arthritis", "lupus"],
    "Pediatrics": ["pediatric", "paediatric", "child", "neonatal", "infant"],
    "Surgery": ["surgery", "surgical", "operative", "perioperative"],
    "Mental Health": ["mental health", "psychiatry", "depression", "anxiety", "psychosis"],
    "Infectious Disease": ["infectious", "hiv", "aids", "tuberculosis", "tb", "malaria", "hepatitis"],
    "Training": ["training", "curriculum", "course", "module", "workshop", "education"],
    "Guidelines": ["guideline", "protocol", "standard", "sop", "algorithm"],
    "Forms & Templates": ["form", "template", "checklist", "register", "log"],
    "Research": ["research", "study", "publication", "journal", "abstract"],
}


def api_request(url):
    """Make a GET request to the Drive API."""
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"  HTTP {e.code}: {body[:200]}", file=sys.stderr)
        raise
    except urllib.error.URLError as e:
        print(f"  URL Error: {e.reason}", file=sys.stderr)
        raise


def list_files(folder_id, page_token=None):
    """List files in a Drive folder using API key auth."""
    params = {
        "q": f"'{folder_id}' in parents and trashed = false",
        "key": API_KEY,
        "fields": "nextPageToken,files(id,name,mimeType,modifiedTime,size,webViewLink,parents)",
        "pageSize": "100",
        "orderBy": "name",
    }
    if page_token:
        params["pageToken"] = page_token
    url = f"{DRIVE_API}/files?{urllib.parse.urlencode(params)}"
    return api_request(url)


def detect_language(name, path_parts):
    """Detect language from file/folder names."""
    search_text = " ".join(path_parts + [name]).lower()
    for language, patterns in LANGUAGE_PATTERNS.items():
        for pattern in patterns:
            if re.search(pattern, search_text, re.IGNORECASE):
                return language
    return "English"


def detect_category(name, path_parts):
    """Detect category from file name and folder path."""
    search_text = " ".join(path_parts + [name]).lower()
    for category, keywords in CATEGORY_KEYWORDS.items():
        for keyword in keywords:
            if keyword in search_text:
                return category
    # Use top-level folder name as category if no keyword match
    if path_parts:
        return path_parts[0]
    return "General"


def get_file_type(mime_type, name):
    """Map MIME type to a human-readable file type."""
    if mime_type in FILE_TYPE_MAP:
        return FILE_TYPE_MAP[mime_type]
    # Fallback: use file extension
    ext = name.rsplit(".", 1)[-1].upper() if "." in name else "Unknown"
    return ext


def get_drive_link(file_id, mime_type):
    """Generate the appropriate link for viewing/downloading."""
    if mime_type.startswith("application/vnd.google-apps."):
        return f"https://drive.google.com/file/d/{file_id}/view"
    return f"https://drive.google.com/file/d/{file_id}/view?usp=sharing"


def crawl_folder(folder_id, path_parts=None, depth=0):
    """Recursively crawl a Google Drive folder."""
    if path_parts is None:
        path_parts = []

    resources = []
    page_token = None
    page_num = 0

    while True:
        page_num += 1
        indent = "  " * depth
        print(f"{indent}Fetching page {page_num} of {'/' .join(path_parts) or 'root'}...")

        try:
            result = list_files(folder_id, page_token)
        except Exception as e:
            print(f"{indent}Error listing folder: {e}", file=sys.stderr)
            break

        files = result.get("files", [])
        print(f"{indent}  Found {len(files)} items")

        for f in files:
            mime = f.get("mimeType", "")
            name = f.get("name", "")
            file_id = f.get("id", "")

            if mime == "application/vnd.google-apps.folder":
                # Recurse into subfolder
                sub_resources = crawl_folder(file_id, path_parts + [name], depth + 1)
                resources.extend(sub_resources)
            else:
                file_type = get_file_type(mime, name)
                language = detect_language(name, path_parts)
                category = detect_category(name, path_parts)
                link = get_drive_link(file_id, mime)
                size = int(f.get("size", 0))
                modified = f.get("modifiedTime", "")

                resource = {
                    "id": file_id,
                    "name": name,
                    "type": file_type,
                    "mimeType": mime,
                    "category": category,
                    "language": language,
                    "path": "/".join(path_parts),
                    "link": link,
                    "size": size,
                    "modifiedTime": modified,
                }
                resources.append(resource)

        page_token = result.get("nextPageToken")
        if not page_token:
            break

    return resources


def build_catalog(resources):
    """Build the final catalog JSON structure."""
    categories = sorted(set(r["category"] for r in resources))
    types = sorted(set(r["type"] for r in resources))
    languages = sorted(set(r["language"] for r in resources))

    return {
        "generatedAt": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "totalResources": len(resources),
        "categories": categories,
        "types": types,
        "languages": languages,
        "resources": resources,
    }


def main():
    if not API_KEY:
        print("Error: GOOGLE_API_KEY environment variable not set", file=sys.stderr)
        sys.exit(1)
    if not ROOT_FOLDER_ID:
        print("Error: DRIVE_FOLDER_ID environment variable not set", file=sys.stderr)
        sys.exit(1)

    if _RAW_FOLDER != ROOT_FOLDER_ID:
        print(f"Extracted folder ID from URL: {ROOT_FOLDER_ID}")
    print(f"Starting sync from Drive folder: {ROOT_FOLDER_ID}")
    print(f"Timestamp: {datetime.utcnow().isoformat()}Z")
    print()

    resources = crawl_folder(ROOT_FOLDER_ID)
    print(f"\nTotal resources found: {len(resources)}")

    # Sort by modified time (newest first) as default
    resources.sort(key=lambda r: r.get("modifiedTime", ""), reverse=True)

    catalog = build_catalog(resources)

    # Write to resources.json
    output_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "data",
        "resources.json",
    )
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(catalog, f, indent=2, ensure_ascii=False)

    print(f"Catalog written to: {output_path}")
    print(f"Categories: {len(catalog['categories'])}")
    print(f"File types: {len(catalog['types'])}")
    print(f"Languages: {len(catalog['languages'])}")


if __name__ == "__main__":
    main()
