/**
 * PEN-Plus Clinical Resource Hub
 * Client-side search, filter, and render logic for all pages.
 * Features: pagination, fuzzy search, dark mode, date range filter,
 *           breadcrumb paths, keyboard navigation.
 */

(function () {
    "use strict";

    var DATA_URL = "data/resources.json";
    var DEBOUNCE_MS = 250;
    var RECENT_DAYS = 14;
    var HOMEPAGE_RECENT_COUNT = 5;
    var PAGE_SIZE = 25;
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
        var diffDays = (new Date() - new Date(isoStr)) / (1000 * 60 * 60 * 24);
        return diffDays <= RECENT_DAYS;
    }

    function daysAgo(isoStr) {
        if (!isoStr) return Infinity;
        return (new Date() - new Date(isoStr)) / (1000 * 60 * 60 * 24);
    }

    // ===== Fuzzy Search =====

    function fuzzyMatch(text, query) {
        text = text.toLowerCase();
        query = query.toLowerCase();
        // Exact substring match gets highest score
        if (text.indexOf(query) >= 0) return 1.0;
        // Token-based: all query tokens must appear somewhere
        var tokens = query.split(/\s+/);
        var allFound = true;
        for (var i = 0; i < tokens.length; i++) {
            if (tokens[i] && text.indexOf(tokens[i]) === -1) {
                allFound = false;
                break;
            }
        }
        if (allFound && tokens.length > 1) return 0.8;
        // Character-sequence fuzzy: all chars in order
        var ti = 0;
        var matched = 0;
        for (var qi = 0; qi < query.length; qi++) {
            while (ti < text.length) {
                if (text[ti] === query[qi]) {
                    matched++;
                    ti++;
                    break;
                }
                ti++;
            }
        }
        if (matched === query.length) return 0.5 * (matched / text.length);
        return 0;
    }

    function fuzzyFilterResources(resources, query, category, type, language, dateRange) {
        var results = [];
        for (var i = 0; i < resources.length; i++) {
            var r = resources[i];
            if (category && r.category !== category) continue;
            if (type && r.type !== type) continue;
            if (language && r.language !== language) continue;
            if (dateRange && dateRange !== "all") {
                var days = parseInt(dateRange, 10);
                if (daysAgo(r.modifiedTime) > days) continue;
            }
            if (query) {
                var searchable = r.name + " " + r.category + " " + r.path + " " + r.language;
                var score = fuzzyMatch(searchable, query);
                if (score <= 0) continue;
                results.push({ resource: r, score: score });
            } else {
                results.push({ resource: r, score: 0 });
            }
        }
        // If searching, sort by relevance first
        if (query) {
            results.sort(function (a, b) { return b.score - a.score; });
        }
        return results.map(function (item) { return item.resource; });
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

    // ===== Dark Mode =====

    function initDarkMode() {
        var toggle = document.getElementById("darkModeToggle");
        if (!toggle) return;

        var stored = localStorage.getItem("pen-plus-dark-mode");
        if (stored === "true" || (!stored && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
            document.documentElement.classList.add("dark");
            toggle.setAttribute("aria-pressed", "true");
        }

        toggle.addEventListener("click", function () {
            var isDark = document.documentElement.classList.toggle("dark");
            localStorage.setItem("pen-plus-dark-mode", isDark ? "true" : "false");
            toggle.setAttribute("aria-pressed", isDark ? "true" : "false");
        });
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
        if (t === "pdf") {
            return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M10 13h4"/><path d="M10 17h4"/><path d="M10 9h1"/></svg>';
        }
        if (t === "docx" || t === "doc" || t === "google doc") {
            return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h8"/><path d="M8 9h2"/></svg>';
        }
        if (t === "pptx" || t === "ppt" || t === "google slides") {
            return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="12" r="4"/><path d="M12 8v8"/><path d="M8 12h8"/></svg>';
        }
        if (t === "xlsx" || t === "xls" || t === "google sheet") {
            return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M8 18l4-8"/><path d="M12 18l-4-8"/></svg>';
        }
        if (t === "png" || t === "jpeg") {
            return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>';
        }
        if (t === "mp4") {
            return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m10 9 5 3-5 3V9Z"/></svg>';
        }
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></svg>';
    }

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

    // ===== Breadcrumb Rendering =====

    function renderBreadcrumb(path) {
        if (!path) return "";
        var parts = path.split("/").filter(function (p) { return p.trim() !== ""; });
        if (parts.length === 0) return "";
        var crumbs = parts.map(function (part) {
            return '<span class="breadcrumb-segment">' + escapeHtml(part) + '</span>';
        });
        return '<div class="resource-breadcrumb">' + crumbs.join('<span class="breadcrumb-sep">/</span>') + '</div>';
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

    function renderResourceCard(r, index) {
        var sizeStr = formatSize(r.size);
        var sizeTag = sizeStr ? '<span class="meta-tag">' + escapeHtml(sizeStr) + "</span>" : "";
        var newTag = isRecent(r.modifiedTime) ? '<span class="meta-tag new-badge">New</span>' : "";
        var idx = typeof index === "number" ? index : 0;

        return (
            '<div class="resource-card" tabindex="0" data-index="' + idx + '" data-link="' + escapeHtml(r.link) + '">' +
                '<div class="resource-card-header">' +
                    renderResourceIcon(r.type) +
                    '<div class="resource-name">' +
                        '<a href="' + escapeHtml(r.link) + '" target="_blank" rel="noopener">' +
                            escapeHtml(r.name) +
                        "</a>" +
                    "</div>" +
                "</div>" +
                renderBreadcrumb(r.path) +
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
                    renderBreadcrumb(r.path) +
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

    // ===== Pagination =====

    function renderPagination(totalItems, currentPage, onPageChange) {
        var totalPages = Math.ceil(totalItems / PAGE_SIZE);
        if (totalPages <= 1) return "";

        var html = '<div class="pagination">';

        // Previous
        if (currentPage > 1) {
            html += '<button class="pagination-btn" data-page="' + (currentPage - 1) + '">&laquo; Prev</button>';
        } else {
            html += '<button class="pagination-btn" disabled>&laquo; Prev</button>';
        }

        // Page numbers
        var startPage = Math.max(1, currentPage - 2);
        var endPage = Math.min(totalPages, currentPage + 2);

        if (startPage > 1) {
            html += '<button class="pagination-btn" data-page="1">1</button>';
            if (startPage > 2) html += '<span class="pagination-ellipsis">&hellip;</span>';
        }

        for (var p = startPage; p <= endPage; p++) {
            if (p === currentPage) {
                html += '<button class="pagination-btn active">' + p + '</button>';
            } else {
                html += '<button class="pagination-btn" data-page="' + p + '">' + p + '</button>';
            }
        }

        if (endPage < totalPages) {
            if (endPage < totalPages - 1) html += '<span class="pagination-ellipsis">&hellip;</span>';
            html += '<button class="pagination-btn" data-page="' + totalPages + '">' + totalPages + '</button>';
        }

        // Next
        if (currentPage < totalPages) {
            html += '<button class="pagination-btn" data-page="' + (currentPage + 1) + '">Next &raquo;</button>';
        } else {
            html += '<button class="pagination-btn" disabled>Next &raquo;</button>';
        }

        html += '</div>';
        return html;
    }

    // ===== Keyboard Navigation =====

    function initKeyboardNav(containerSelector) {
        document.addEventListener("keydown", function (e) {
            var container = document.querySelector(containerSelector);
            if (!container) return;

            var cards = container.querySelectorAll(".resource-card[tabindex]");
            if (cards.length === 0) return;

            var focused = document.activeElement;
            var currentIdx = -1;
            for (var i = 0; i < cards.length; i++) {
                if (cards[i] === focused) { currentIdx = i; break; }
            }

            // Only handle arrow keys when a card is focused
            if (currentIdx === -1) return;

            var cols = 1;
            if (cards.length >= 2) {
                var firstTop = cards[0].getBoundingClientRect().top;
                for (var c = 1; c < cards.length; c++) {
                    if (cards[c].getBoundingClientRect().top > firstTop + 5) {
                        cols = c;
                        break;
                    }
                }
                if (cols === 1 && cards.length >= 2 && Math.abs(cards[1].getBoundingClientRect().top - firstTop) < 5) {
                    cols = cards.length;
                }
            }

            var nextIdx = -1;
            switch (e.key) {
                case "ArrowRight": nextIdx = Math.min(currentIdx + 1, cards.length - 1); break;
                case "ArrowLeft": nextIdx = Math.max(currentIdx - 1, 0); break;
                case "ArrowDown": nextIdx = Math.min(currentIdx + cols, cards.length - 1); break;
                case "ArrowUp": nextIdx = Math.max(currentIdx - cols, 0); break;
                case "Enter":
                    var link = focused.getAttribute("data-link");
                    if (link) window.open(link, "_blank", "noopener");
                    e.preventDefault();
                    return;
            }

            if (nextIdx >= 0 && nextIdx !== currentIdx) {
                e.preventDefault();
                cards[nextIdx].focus();
            }
        });
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

        var statTotal = document.getElementById("statTotal");
        var statCategories = document.getElementById("statCategories");
        var statLanguages = document.getElementById("statLanguages");
        var statTypes = document.getElementById("statTypes");

        if (statTotal) statTotal.textContent = catalog.totalResources.toString();
        if (statCategories) statCategories.textContent = catalog.categories.length.toString();
        if (statLanguages) statLanguages.textContent = catalog.languages.length.toString();
        if (statTypes) statTypes.textContent = catalog.types.length.toString();

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

        // Hero search with fuzzy matching
        function doHeroSearch() {
            var q = heroSearch.value.trim();
            heroSearchClear.hidden = q.length === 0;
            if (q.length < 2) {
                heroSearchResults.hidden = true;
                return;
            }
            var results = fuzzyFilterResources(catalog.resources, q, "", "", "", "");
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
        var dateRangeFilter = document.getElementById("dateRangeFilter");
        var sortSelect = document.getElementById("sortSelect");
        var clearBtn = document.getElementById("clearFilters");
        var resourcesList = document.getElementById("resourcesList");
        var noResults = document.getElementById("noResults");
        var resultsCount = document.getElementById("resultsCount");
        var loadingState = document.getElementById("loadingState");
        var resetSearch = document.getElementById("resetSearch");
        var emptyState = document.getElementById("emptyState");
        var paginationContainer = document.getElementById("pagination");

        if (!searchInput || !resourcesList) return;
        if (document.getElementById("heroSearch")) return;

        var urlParams = new URLSearchParams(window.location.search);
        var presetCategory = urlParams.get("category") || "";

        var currentPage = 1;

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
            if (presetCategory) {
                categoryFilter.value = presetCategory;
            }
        }

        function render() {
            var query = searchInput.value.trim();
            var category = categoryFilter.value;
            var type = typeFilter.value;
            var language = languageFilter.value;
            var dateRange = dateRangeFilter ? dateRangeFilter.value : "";
            var sortKey = sortSelect.value;

            if (searchClear) searchClear.hidden = query.length === 0;

            // Use fuzzy search
            var filtered = fuzzyFilterResources(catalog.resources, query, category, type, language, dateRange);
            // Only sort if not a text search (fuzzy already sorts by relevance)
            var sorted = query ? filtered : sortResources(filtered, sortKey);

            var totalFiltered = sorted.length;
            var totalPages = Math.ceil(totalFiltered / PAGE_SIZE);
            if (currentPage > totalPages) currentPage = Math.max(1, totalPages);

            var startIdx = (currentPage - 1) * PAGE_SIZE;
            var pageItems = sorted.slice(startIdx, startIdx + PAGE_SIZE);

            var countStart = totalFiltered > 0 ? startIdx + 1 : 0;
            var countEnd = Math.min(startIdx + PAGE_SIZE, totalFiltered);
            resultsCount.textContent = "Showing " + countStart + "\u2013" + countEnd + " of " + totalFiltered + " resources";

            if (sorted.length === 0) {
                resourcesList.innerHTML = "";
                noResults.hidden = false;
                if (paginationContainer) paginationContainer.innerHTML = "";
            } else {
                noResults.hidden = true;
                resourcesList.innerHTML = pageItems.map(function (r, i) {
                    return renderResourceCard(r, startIdx + i);
                }).join("");

                // Pagination
                if (paginationContainer) {
                    paginationContainer.innerHTML = renderPagination(totalFiltered, currentPage);
                    // Bind pagination clicks
                    var btns = paginationContainer.querySelectorAll("[data-page]");
                    for (var i = 0; i < btns.length; i++) {
                        btns[i].addEventListener("click", function () {
                            currentPage = parseInt(this.getAttribute("data-page"), 10);
                            render();
                            // Scroll to top of results
                            resourcesList.scrollIntoView({ behavior: "smooth", block: "start" });
                        });
                    }
                }
            }
        }

        var debouncedRender = debounce(function () {
            currentPage = 1;
            render();
        }, DEBOUNCE_MS);

        function resetAndRender() {
            currentPage = 1;
            render();
        }

        searchInput.addEventListener("input", debouncedRender);
        categoryFilter.addEventListener("change", resetAndRender);
        typeFilter.addEventListener("change", resetAndRender);
        languageFilter.addEventListener("change", resetAndRender);
        if (dateRangeFilter) dateRangeFilter.addEventListener("change", resetAndRender);
        sortSelect.addEventListener("change", resetAndRender);

        if (searchClear) {
            searchClear.addEventListener("click", function () {
                searchInput.value = "";
                searchClear.hidden = true;
                currentPage = 1;
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
            if (dateRangeFilter) dateRangeFilter.value = "";
            sortSelect.value = "modified-desc";
            currentPage = 1;
            render();
        });

        resetSearch.addEventListener("click", function () {
            searchInput.value = "";
            if (searchClear) searchClear.hidden = true;
            categoryFilter.value = "";
            typeFilter.value = "";
            languageFilter.value = "";
            if (dateRangeFilter) dateRangeFilter.value = "";
            currentPage = 1;
            render();
        });

        populateFilters();
        if (loadingState) loadingState.hidden = true;
        render();

        // Keyboard nav for resource cards
        initKeyboardNav("#resourcesList");
    }

    // ===== Updates Page =====

    function initUpdatesPage() {
        var updatesList = document.getElementById("updatesList");
        var loadingState = document.getElementById("loadingState");
        var updatesTimeFilter = document.getElementById("updatesTimeFilter");
        var updatesCount = document.getElementById("updatesCount");
        var noUpdates = document.getElementById("noUpdates");

        if (!updatesList || !updatesTimeFilter) return;
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

    // Dark mode should init immediately (before catalog loads)
    initDarkMode();

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
