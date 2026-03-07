/**
 * PEN-Plus Clinical Resource Hub
 * Client-side search, filter, and render logic.
 */

(function () {
    "use strict";

    var DATA_URL = "data/resources.json";
    var DEBOUNCE_MS = 300;
    var catalog = null;

    // ===== Helpers =====

    function debounce(fn, ms) {
        var timer;
        return function () {
            var args = arguments;
            var ctx = this;
            clearTimeout(timer);
            timer = setTimeout(function () {
                fn.apply(ctx, args);
            }, ms);
        };
    }

    function escapeHtml(str) {
        var div = document.createElement("div");
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    function formatDate(isoStr) {
        if (!isoStr) return "—";
        var d = new Date(isoStr);
        return d.toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
        });
    }

    function formatSize(bytes) {
        if (!bytes || bytes === 0) return "";
        var units = ["B", "KB", "MB", "GB"];
        var i = 0;
        var size = bytes;
        while (size >= 1024 && i < units.length - 1) {
            size /= 1024;
            i++;
        }
        return size.toFixed(i > 0 ? 1 : 0) + " " + units[i];
    }

    function getIconClass(type) {
        var t = type.toLowerCase().replace(/\s+/g, "-");
        var known = [
            "pdf", "docx", "doc", "google-doc",
            "pptx", "ppt", "google-slides",
            "xlsx", "xls", "google-sheet",
            "png", "jpeg", "mp4",
        ];
        return known.indexOf(t) >= 0 ? "icon-" + t : "icon-default";
    }

    function getIconLabel(type) {
        var map = {
            "Google Doc": "DOC",
            "Google Sheet": "XLS",
            "Google Slides": "PPT",
        };
        return map[type] || type.substring(0, 4);
    }

    // ===== Data Loading =====

    function loadCatalog(callback) {
        var xhr = new XMLHttpRequest();
        xhr.open("GET", DATA_URL, true);
        xhr.onload = function () {
            if (xhr.status === 200) {
                try {
                    catalog = JSON.parse(xhr.responseText);
                    callback(null, catalog);
                } catch (e) {
                    callback(e);
                }
            } else {
                callback(new Error("HTTP " + xhr.status));
            }
        };
        xhr.onerror = function () {
            callback(new Error("Network error"));
        };
        xhr.send();
    }

    // ===== Filtering & Sorting =====

    function filterResources(resources, query, category, type, language) {
        return resources.filter(function (r) {
            if (category && r.category !== category) return false;
            if (type && r.type !== type) return false;
            if (language && r.language !== language) return false;
            if (query) {
                var q = query.toLowerCase();
                var searchable = (r.name + " " + r.category + " " + r.path + " " + r.language).toLowerCase();
                if (searchable.indexOf(q) === -1) return false;
            }
            return true;
        });
    }

    function sortResources(resources, sortKey) {
        var sorted = resources.slice();
        switch (sortKey) {
            case "name-asc":
                sorted.sort(function (a, b) { return a.name.localeCompare(b.name); });
                break;
            case "name-desc":
                sorted.sort(function (a, b) { return b.name.localeCompare(a.name); });
                break;
            case "modified-desc":
                sorted.sort(function (a, b) { return (b.modifiedTime || "").localeCompare(a.modifiedTime || ""); });
                break;
            case "modified-asc":
                sorted.sort(function (a, b) { return (a.modifiedTime || "").localeCompare(b.modifiedTime || ""); });
                break;
        }
        return sorted;
    }

    // ===== Rendering =====

    function renderResourceCard(r) {
        var sizeStr = formatSize(r.size);
        var sizeTag = sizeStr ? '<span class="meta-tag">' + escapeHtml(sizeStr) + "</span>" : "";

        return (
            '<div class="resource-card">' +
                '<div class="resource-card-header">' +
                    '<div class="resource-icon ' + getIconClass(r.type) + '">' +
                        escapeHtml(getIconLabel(r.type)) +
                    "</div>" +
                    '<div class="resource-name">' +
                        '<a href="' + escapeHtml(r.link) + '" target="_blank" rel="noopener">' +
                            escapeHtml(r.name) +
                        "</a>" +
                    "</div>" +
                "</div>" +
                (r.path ? '<div class="resource-path" title="' + escapeHtml(r.path) + '">' + escapeHtml(r.path) + "</div>" : "") +
                '<div class="resource-modified">Modified: ' + escapeHtml(formatDate(r.modifiedTime)) + "</div>" +
                '<div class="resource-meta">' +
                    '<span class="meta-tag category">' + escapeHtml(r.category) + "</span>" +
                    '<span class="meta-tag language">' + escapeHtml(r.language) + "</span>" +
                    '<span class="meta-tag">' + escapeHtml(r.type) + "</span>" +
                    sizeTag +
                "</div>" +
            "</div>"
        );
    }

    function renderUpdateItem(r) {
        var d = r.modifiedTime ? new Date(r.modifiedTime) : null;
        var dayStr = d ? d.getDate().toString() : "—";
        var monthYear = d
            ? d.toLocaleDateString("en-US", { month: "short", year: "numeric" })
            : "";
        var sizeStr = formatSize(r.size);
        var sizeTag = sizeStr ? '<span class="meta-tag">' + escapeHtml(sizeStr) + "</span>" : "";

        return (
            '<div class="update-item">' +
                '<div class="update-date">' +
                    '<div class="day">' + escapeHtml(dayStr) + "</div>" +
                    '<div class="month-year">' + escapeHtml(monthYear) + "</div>" +
                "</div>" +
                '<div class="update-details">' +
                    '<div class="update-name">' +
                        '<a href="' + escapeHtml(r.link) + '" target="_blank" rel="noopener">' +
                            escapeHtml(r.name) +
                        "</a>" +
                    "</div>" +
                    '<div class="update-meta">' +
                        '<span class="meta-tag category">' + escapeHtml(r.category) + "</span>" +
                        '<span class="meta-tag language">' + escapeHtml(r.language) + "</span>" +
                        '<span class="meta-tag">' + escapeHtml(r.type) + "</span>" +
                        sizeTag +
                    "</div>" +
                "</div>" +
            "</div>"
        );
    }

    // ===== Browse Page =====

    function initBrowsePage() {
        var searchInput = document.getElementById("searchInput");
        var categoryFilter = document.getElementById("categoryFilter");
        var typeFilter = document.getElementById("typeFilter");
        var languageFilter = document.getElementById("languageFilter");
        var sortSelect = document.getElementById("sortSelect");
        var clearBtn = document.getElementById("clearFilters");
        var resourcesList = document.getElementById("resourcesList");
        var noResults = document.getElementById("noResults");
        var resultsCount = document.getElementById("resultsCount");
        var loadingState = document.getElementById("loadingState");
        var resetSearch = document.getElementById("resetSearch");
        var emptyState = document.getElementById("emptyState");

        if (!searchInput) return; // Not the browse page

        // Show empty state if catalog has no resources
        if (catalog.totalResources === 0) {
            loadingState.hidden = true;
            if (emptyState) emptyState.hidden = false;
            return;
        }

        function populateFilters() {
            catalog.categories.forEach(function (c) {
                var opt = document.createElement("option");
                opt.value = c;
                opt.textContent = c;
                categoryFilter.appendChild(opt);
            });
            catalog.types.forEach(function (t) {
                var opt = document.createElement("option");
                opt.value = t;
                opt.textContent = t;
                typeFilter.appendChild(opt);
            });
            catalog.languages.forEach(function (l) {
                var opt = document.createElement("option");
                opt.value = l;
                opt.textContent = l;
                languageFilter.appendChild(opt);
            });
        }

        function render() {
            var query = searchInput.value.trim();
            var category = categoryFilter.value;
            var type = typeFilter.value;
            var language = languageFilter.value;
            var sortKey = sortSelect.value;

            var filtered = filterResources(catalog.resources, query, category, type, language);
            var sorted = sortResources(filtered, sortKey);

            resultsCount.textContent = sorted.length + " of " + catalog.totalResources + " resources";

            if (sorted.length === 0) {
                resourcesList.innerHTML = "";
                noResults.hidden = false;
            } else {
                noResults.hidden = true;
                resourcesList.innerHTML = sorted.map(renderResourceCard).join("");
            }
        }

        var debouncedRender = debounce(render, DEBOUNCE_MS);

        searchInput.addEventListener("input", debouncedRender);
        categoryFilter.addEventListener("change", render);
        typeFilter.addEventListener("change", render);
        languageFilter.addEventListener("change", render);
        sortSelect.addEventListener("change", render);

        clearBtn.addEventListener("click", function () {
            searchInput.value = "";
            categoryFilter.value = "";
            typeFilter.value = "";
            languageFilter.value = "";
            sortSelect.value = "modified-desc";
            render();
        });

        resetSearch.addEventListener("click", function () {
            searchInput.value = "";
            categoryFilter.value = "";
            typeFilter.value = "";
            languageFilter.value = "";
            render();
        });

        populateFilters();
        loadingState.hidden = true;
        render();
    }

    // ===== Updates Page =====

    function initUpdatesPage() {
        var updatesList = document.getElementById("updatesList");
        var loadingState = document.getElementById("loadingState");

        if (!updatesList || document.getElementById("searchInput")) return; // Not the updates page

        var sorted = catalog.resources.slice().sort(function (a, b) {
            return (b.modifiedTime || "").localeCompare(a.modifiedTime || "");
        });

        loadingState.hidden = true;
        updatesList.innerHTML = sorted.map(renderUpdateItem).join("");
    }

    // ===== Footer Info =====

    function updateFooter() {
        var lastSynced = document.getElementById("lastSynced");
        var totalResources = document.getElementById("totalResources");
        if (lastSynced) lastSynced.textContent = formatDate(catalog.generatedAt);
        if (totalResources) totalResources.textContent = catalog.totalResources.toString();
    }

    // ===== Init =====

    loadCatalog(function (err) {
        if (err) {
            var loadingState = document.getElementById("loadingState");
            if (loadingState) {
                loadingState.innerHTML =
                    '<p style="color:#e74c3c;">Failed to load resources. Please try again later.</p>';
            }
            console.error("Failed to load catalog:", err);
            return;
        }

        updateFooter();
        initBrowsePage();
        initUpdatesPage();
    });
})();
