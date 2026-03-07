/**
 * PEN-Plus Clinical Resource Hub
 * Client-side search, filter, and render logic for all pages.
 */

(function () {
    "use strict";

    var DATA_URL = "data/resources.json";
    var DEBOUNCE_MS = 250;
    var RECENT_DAYS = 14; // "New" badge threshold
    var HOMEPAGE_RECENT_COUNT = 5;
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
        if (!isoStr) return "\u2014";
        var d = new Date(isoStr);
        return d.toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
        });
    }

    function formatDateShort(isoStr) {
        if (!isoStr) return "\u2014";
        var d = new Date(isoStr);
        return d.toLocaleDateString("en-US", {
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

    function isRecent(isoStr) {
        if (!isoStr) return false;
        var now = new Date();
        var mod = new Date(isoStr);
        var diffDays = (now - mod) / (1000 * 60 * 60 * 24);
        return diffDays <= RECENT_DAYS;
    }

    function daysAgo(isoStr) {
        if (!isoStr) return Infinity;
        return (new Date() - new Date(isoStr)) / (1000 * 60 * 60 * 24);
    }

    // ===== Icon SVGs =====

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
        return map[type] || type.substring(0, 4).toUpperCase();
    }

    function getIconSvg(type) {
        var t = type.toLowerCase();
        // PDF - document with lines
        if (t === "pdf") {
            return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M10 13h4"/><path d="M10 17h4"/><path d="M10 9h1"/></svg>';
        }
        // Word docs
        if (t === "docx" || t === "doc" || t === "google doc") {
            return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h8"/><path d="M8 9h2"/></svg>';
        }
        // PowerPoint
        if (t === "pptx" || t === "ppt" || t === "google slides") {
            return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="12" r="4"/><path d="M12 8v8"/><path d="M8 12h8"/></svg>';
        }
        // Excel
        if (t === "xlsx" || t === "xls" || t === "google sheet") {
            return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M8 18l4-8"/><path d="M12 18l-4-8"/></svg>';
        }
        // Images
        if (t === "png" || t === "jpeg") {
            return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>';
        }
        // Video
        if (t === "mp4") {
            return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m10 9 5 3-5 3V9Z"/></svg>';
        }
        // Default
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></svg>';
    }

    // Category icons (simple text/emoji mapped to categories)
    function getCategoryIcon(category) {
        var map = {
            "Oncology": "\u2695",
            "Cardiology": "\u2665",
            "Diabetes": "\u25CE",
            "Sickle Cell Disease": "\u25CF",
            "Rheumatic Heart Disease": "\u2661",
            "Training": "\u2302",
            "Data Tools": "\u2637",
            "Protocols": "\u2611",
            "General": "\u2606",
            "Surgery": "\u2702",
            "Pediatrics": "\u263A",
            "Mental Health": "\u2603",
            "Palliative Care": "\u2618",
            "Monitoring": "\u25A3",
            "Quality Improvement": "\u2713",
            "Research": "\u2609",
        };
        return map[category] || "\u25A1";
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

    function renderResourceIcon(type) {
        return (
            '<div class="resource-icon ' + getIconClass(type) + '">' +
                getIconSvg(type) +
                '<span class="resource-icon-label">' + escapeHtml(getIconLabel(type)) + '</span>' +
            '</div>'
        );
    }

    function renderResourceCard(r) {
        var sizeStr = formatSize(r.size);
        var sizeTag = sizeStr ? '<span class="meta-tag">' + escapeHtml(sizeStr) + "</span>" : "";
        var newTag = isRecent(r.modifiedTime) ? '<span class="meta-tag new-badge">New</span>' : "";

        return (
            '<div class="resource-card">' +
                '<div class="resource-card-header">' +
                    renderResourceIcon(r.type) +
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
                    newTag +
                "</div>" +
            "</div>"
        );
    }

    function renderUpdateItem(r) {
        var d = r.modifiedTime ? new Date(r.modifiedTime) : null;
        var dayStr = d ? d.getDate().toString() : "\u2014";
        var monthYear = d
            ? d.toLocaleDateString("en-US", { month: "short", year: "numeric" })
            : "";
        var sizeStr = formatSize(r.size);
        var sizeTag = sizeStr ? '<span class="meta-tag">' + escapeHtml(sizeStr) + "</span>" : "";
        var newTag = isRecent(r.modifiedTime) ? '<span class="meta-tag new-badge">New</span>' : "";

        return (
            '<div class="update-item">' +
                '<div class="update-date">' +
                    '<div class="day">' + escapeHtml(dayStr) + "</div>" +
                    '<div class="month-year">' + escapeHtml(monthYear) + "</div>" +
                "</div>" +
                renderResourceIcon(r.type) +
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
                        newTag +
                    "</div>" +
                "</div>" +
            "</div>"
        );
    }

    function renderRecentUpdateItem(r) {
        var sizeStr = formatSize(r.size);
        var sizeTag = sizeStr ? '<span class="meta-tag">' + escapeHtml(sizeStr) + "</span>" : "";

        return (
            '<div class="recent-update-item">' +
                '<div class="recent-update-date">' + escapeHtml(formatDateShort(r.modifiedTime)) + '</div>' +
                renderResourceIcon(r.type) +
                '<div class="recent-update-info">' +
                    '<div class="recent-update-name">' +
                        '<a href="' + escapeHtml(r.link) + '" target="_blank" rel="noopener">' +
                            escapeHtml(r.name) +
                        "</a>" +
                    '</div>' +
                    '<div class="recent-update-meta">' +
                        '<span class="meta-tag category">' + escapeHtml(r.category) + "</span>" +
                        '<span class="meta-tag language">' + escapeHtml(r.language) + "</span>" +
                        sizeTag +
                    '</div>' +
                '</div>' +
            '</div>'
        );
    }

    function renderHeroResultItem(r) {
        return (
            '<div class="hero-result-item">' +
                renderResourceIcon(r.type) +
                '<a href="' + escapeHtml(r.link) + '" target="_blank" rel="noopener">' +
                    escapeHtml(r.name) +
                '</a>' +
                '<span class="meta-tag category">' + escapeHtml(r.category) + '</span>' +
            '</div>'
        );
    }

    function renderCategoryCard(category, count) {
        var icon = getCategoryIcon(category);
        return (
            '<a class="category-card" href="resources.html?category=' + encodeURIComponent(category) + '">' +
                '<div class="category-card-icon">' + icon + '</div>' +
                '<div class="category-card-name">' + escapeHtml(category) + '</div>' +
                '<div class="category-card-count">' + count + ' resource' + (count !== 1 ? 's' : '') + '</div>' +
            '</a>'
        );
    }

    // ===== Homepage =====

    function initHomePage() {
        var heroSearch = document.getElementById("heroSearch");
        var heroSearchClear = document.getElementById("heroSearchClear");
        var heroSearchResults = document.getElementById("heroSearchResults");
        var heroResultsList = document.getElementById("heroResultsList");
        var categoryCards = document.getElementById("categoryCards");
        var recentUpdates = document.getElementById("recentUpdates");
        var homepageLoading = document.getElementById("homepageLoading");
        var homepageEmpty = document.getElementById("homepageEmpty");

        if (!heroSearch) return;

        // Stats
        var statTotal = document.getElementById("statTotal");
        var statCategories = document.getElementById("statCategories");
        var statLanguages = document.getElementById("statLanguages");
        var statTypes = document.getElementById("statTypes");

        if (statTotal) statTotal.textContent = catalog.totalResources.toString();
        if (statCategories) statCategories.textContent = catalog.categories.length.toString();
        if (statLanguages) statLanguages.textContent = catalog.languages.length.toString();
        if (statTypes) statTypes.textContent = catalog.types.length.toString();

        // Empty state
        if (catalog.totalResources === 0) {
            if (homepageLoading) homepageLoading.hidden = true;
            if (homepageEmpty) homepageEmpty.hidden = false;
            return;
        }

        if (homepageLoading) homepageLoading.hidden = true;

        // Category cards
        if (categoryCards) {
            var categoryCounts = {};
            catalog.resources.forEach(function (r) {
                categoryCounts[r.category] = (categoryCounts[r.category] || 0) + 1;
            });
            // Sort categories by count descending
            var sortedCategories = catalog.categories.slice().sort(function (a, b) {
                return (categoryCounts[b] || 0) - (categoryCounts[a] || 0);
            });
            categoryCards.innerHTML = sortedCategories.map(function (cat) {
                return renderCategoryCard(cat, categoryCounts[cat] || 0);
            }).join("");
        }

        // Recent updates
        if (recentUpdates) {
            var sorted = catalog.resources.slice().sort(function (a, b) {
                return (b.modifiedTime || "").localeCompare(a.modifiedTime || "");
            });
            var recent = sorted.slice(0, HOMEPAGE_RECENT_COUNT);
            if (recent.length > 0) {
                recentUpdates.innerHTML = recent.map(renderRecentUpdateItem).join("");
            } else {
                recentUpdates.innerHTML = '<p style="color:var(--color-text-light);padding:16px 0;">No resources found.</p>';
            }
        }

        // Hero search
        function doHeroSearch() {
            var q = heroSearch.value.trim();
            heroSearchClear.hidden = q.length === 0;

            if (q.length < 2) {
                heroSearchResults.hidden = true;
                return;
            }

            var results = filterResources(catalog.resources, q, "", "", "");
            var top = results.slice(0, 8);

            if (top.length === 0) {
                heroResultsList.innerHTML = '<div style="padding:16px;color:var(--color-text-secondary);text-align:center;">No resources match &ldquo;' + escapeHtml(q) + '&rdquo;</div>';
            } else {
                heroResultsList.innerHTML = top.map(renderHeroResultItem).join("");
            }
            heroSearchResults.hidden = false;
        }

        heroSearch.addEventListener("input", debounce(doHeroSearch, DEBOUNCE_MS));

        heroSearchClear.addEventListener("click", function () {
            heroSearch.value = "";
            heroSearchClear.hidden = true;
            heroSearchResults.hidden = true;
            heroSearch.focus();
        });

        // Close search results when clicking outside
        document.addEventListener("click", function (e) {
            if (!heroSearch.contains(e.target) && !heroSearchResults.contains(e.target)) {
                heroSearchResults.hidden = true;
            }
        });

        heroSearch.addEventListener("focus", function () {
            if (heroSearch.value.trim().length >= 2) {
                heroSearchResults.hidden = false;
            }
        });
    }

    // ===== Resources Page =====

    function initResourcesPage() {
        var searchInput = document.getElementById("searchInput");
        var searchClear = document.getElementById("searchClear");
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

        // This page must have searchInput AND resourcesList (not homepage)
        if (!searchInput || !resourcesList) return;
        // Don't run on homepage (homepage has heroSearch instead)
        if (document.getElementById("heroSearch")) return;

        // Check for URL params (e.g. ?category=Oncology)
        var urlParams = new URLSearchParams(window.location.search);
        var presetCategory = urlParams.get("category") || "";

        // Show empty state if catalog has no resources
        if (catalog.totalResources === 0) {
            if (loadingState) loadingState.hidden = true;
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

            // Apply preset from URL
            if (presetCategory) {
                categoryFilter.value = presetCategory;
            }
        }

        function render() {
            var query = searchInput.value.trim();
            var category = categoryFilter.value;
            var type = typeFilter.value;
            var language = languageFilter.value;
            var sortKey = sortSelect.value;

            // Search clear button
            if (searchClear) searchClear.hidden = query.length === 0;

            var filtered = filterResources(catalog.resources, query, category, type, language);
            var sorted = sortResources(filtered, sortKey);

            resultsCount.textContent = "Showing " + sorted.length + " of " + catalog.totalResources + " resources";

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

        if (searchClear) {
            searchClear.addEventListener("click", function () {
                searchInput.value = "";
                searchClear.hidden = true;
                render();
                searchInput.focus();
            });
        }

        clearBtn.addEventListener("click", function () {
            searchInput.value = "";
            if (searchClear) searchClear.hidden = true;
            categoryFilter.value = "";
            typeFilter.value = "";
            languageFilter.value = "";
            sortSelect.value = "modified-desc";
            render();
        });

        resetSearch.addEventListener("click", function () {
            searchInput.value = "";
            if (searchClear) searchClear.hidden = true;
            categoryFilter.value = "";
            typeFilter.value = "";
            languageFilter.value = "";
            render();
        });

        populateFilters();
        if (loadingState) loadingState.hidden = true;
        render();
    }

    // ===== Updates Page =====

    function initUpdatesPage() {
        var updatesList = document.getElementById("updatesList");
        var loadingState = document.getElementById("loadingState");
        var updatesTimeFilter = document.getElementById("updatesTimeFilter");
        var updatesCount = document.getElementById("updatesCount");
        var noUpdates = document.getElementById("noUpdates");

        if (!updatesList || !updatesTimeFilter) return;
        // Don't run on other pages
        if (document.getElementById("searchInput") || document.getElementById("heroSearch")) return;

        var allSorted = catalog.resources.slice().sort(function (a, b) {
            return (b.modifiedTime || "").localeCompare(a.modifiedTime || "");
        });

        function renderUpdates() {
            var filterVal = updatesTimeFilter.value;
            var filtered;
            if (filterVal === "all") {
                filtered = allSorted;
            } else {
                var days = parseInt(filterVal, 10);
                filtered = allSorted.filter(function (r) {
                    return daysAgo(r.modifiedTime) <= days;
                });
            }

            if (updatesCount) {
                updatesCount.textContent = filtered.length + " resource" + (filtered.length !== 1 ? "s" : "");
            }

            if (filtered.length === 0) {
                updatesList.innerHTML = "";
                if (noUpdates) noUpdates.hidden = false;
            } else {
                if (noUpdates) noUpdates.hidden = true;
                updatesList.innerHTML = filtered.map(renderUpdateItem).join("");
            }
        }

        updatesTimeFilter.addEventListener("change", renderUpdates);

        if (loadingState) loadingState.hidden = true;
        renderUpdates();
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
            var homepageLoading = document.getElementById("homepageLoading");
            if (homepageLoading) {
                homepageLoading.innerHTML =
                    '<p style="color:#e74c3c;">Failed to load resources. Please try again later.</p>';
            }
            console.error("Failed to load catalog:", err);
            return;
        }

        updateFooter();
        initHomePage();
        initResourcesPage();
        initUpdatesPage();
    });
})();
