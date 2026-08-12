from __future__ import annotations

from html.parser import HTMLParser
import json
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "docs" / "site"


class SiteParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[str] = []
        self.images: list[dict[str, str | None]] = []
        self.meta: list[dict[str, str | None]] = []
        self.scripts: list[dict[str, str | None]] = []
        self.headings: list[str] = []
        self._heading: str | None = None
        self._parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag == "br" and self._heading:
            self._parts.append(" ")
        elif tag == "a" and values.get("href"):
            self.links.append(values["href"] or "")
        elif tag == "img":
            self.images.append(values)
        elif tag == "meta":
            self.meta.append(values)
        elif tag == "script":
            self.scripts.append(values)
        elif tag in {"h1", "h2", "h3"}:
            self._heading = tag
            self._parts = []

    def handle_data(self, data: str) -> None:
        if self._heading:
            self._parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == self._heading:
            self.headings.append(" ".join("".join(self._parts).split()))
            self._heading = None
            self._parts = []


def parse_site() -> tuple[str, SiteParser]:
    html = (SITE / "index.html").read_text(encoding="utf-8")
    parser = SiteParser()
    parser.feed(html)
    return html, parser


def test_pages_site_has_complete_static_bundle() -> None:
    required = {
        "index.html",
        "styles.css",
        "app.js",
        "robots.txt",
        "sitemap.xml",
        "site.webmanifest",
        ".nojekyll",
        "assets/icon.png",
        "assets/dashboard.png",
    }

    missing = sorted(path for path in required if not (SITE / path).is_file())
    assert missing == []


def test_pages_site_has_search_and_social_metadata() -> None:
    html, parser = parse_site()
    keyed = {(item.get("name") or item.get("property")): item.get("content") for item in parser.meta}

    assert "<title>DueFlow — Turn deadlines into an actionable local schedule</title>" in html
    assert keyed["description"] and "local-first" in keyed["description"]
    assert keyed["og:title"] == "DueFlow — Deadlines in, actionable schedule out"
    assert keyed["og:url"] == "https://ustinian5.github.io/DueFlow/"
    assert keyed["og:image"].endswith("/assets/dashboard.png")
    assert keyed["twitter:card"] == "summary_large_image"
    assert 'rel="canonical" href="https://ustinian5.github.io/DueFlow/"' in html
    assert '"@type": "SoftwareApplication"' in html
    assert '"softwareVersion": "0.1.1"' in html


def test_pages_site_links_and_assets_are_valid() -> None:
    _, parser = parse_site()
    external_hosts = set()

    for target in parser.links:
        if target.startswith("#"):
            continue
        parsed = urlparse(target)
        if parsed.scheme:
            assert parsed.scheme == "https"
            external_hosts.add(parsed.netloc)
        else:
            assert (SITE / parsed.path).exists(), target

    for image in parser.images:
        source = image.get("src")
        assert source and (SITE / source).is_file()
        assert image.get("alt") is not None

    assert external_hosts == {"github.com"}
    assert "https://github.com/Ustinian5/DueFlow" in parser.links
    assert "https://github.com/Ustinian5/DueFlow/releases/tag/v0.1.1" in parser.links


def test_pages_site_is_accessible_and_tracking_free() -> None:
    html, parser = parse_site()

    assert parser.headings[0] == "Deadlines arrive scattered. Your plan shouldn't."
    assert "Skip to content" in html
    assert 'aria-live="polite"' in html
    assert "prefers-reduced-motion" in (SITE / "styles.css").read_text(encoding="utf-8")
    assert all(not script.get("src", "").startswith("http") for script in parser.scripts)

    combined = html + (SITE / "app.js").read_text(encoding="utf-8")
    for forbidden in ["google-analytics", "gtag(", "segment.com", "posthog", "mixpanel"]:
        assert forbidden not in combined.lower()


def test_pages_manifest_and_discovery_files_match_canonical_url() -> None:
    manifest = json.loads((SITE / "site.webmanifest").read_text(encoding="utf-8"))
    robots = (SITE / "robots.txt").read_text(encoding="utf-8")
    sitemap = (SITE / "sitemap.xml").read_text(encoding="utf-8")

    assert manifest["name"] == "DueFlow"
    assert manifest["start_url"] == "./"
    assert manifest["icons"][0]["src"] == "assets/icon.png"
    assert "Sitemap: https://ustinian5.github.io/DueFlow/sitemap.xml" in robots
    assert "<loc>https://ustinian5.github.io/DueFlow/</loc>" in sitemap


def test_pages_workflow_uses_least_required_permissions_and_current_actions() -> None:
    workflow = (ROOT / ".github" / "workflows" / "pages.yml").read_text(encoding="utf-8")

    for expected in [
        "contents: read",
        "pages: write",
        "id-token: write",
        "actions/checkout@v6",
        "actions/configure-pages@v5",
        "actions/upload-pages-artifact@v4",
        "actions/deploy-pages@v4",
        "name: github-pages",
        "cancel-in-progress: true",
        "path: docs/site",
    ]:
        assert expected in workflow


def test_readme_links_to_live_project_site() -> None:
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    assert "https://ustinian5.github.io/DueFlow/" in readme
