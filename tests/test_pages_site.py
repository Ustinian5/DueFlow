from __future__ import annotations

from html.parser import HTMLParser
import json
from pathlib import Path
import re
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "docs" / "site"
ZH_SITE = SITE / "zh"


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


def parse_site(path: Path | None = None) -> tuple[str, SiteParser]:
    html = (path or (SITE / "index.html")).read_text(encoding="utf-8")
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
        "zh/index.html",
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


def test_simplified_chinese_site_has_localized_search_metadata() -> None:
    html, parser = parse_site(ZH_SITE / "index.html")
    keyed = {(item.get("name") or item.get("property")): item.get("content") for item in parser.meta}

    assert '<html lang="zh-CN">' in html
    assert "<title>DueFlow — 把分散的截止信息变成可执行的本地计划</title>" in html
    assert keyed["description"] and "本地优先" in keyed["description"]
    assert keyed["og:locale"] == "zh_CN"
    assert keyed["og:url"] == "https://ustinian5.github.io/DueFlow/zh/"
    assert keyed["twitter:card"] == "summary_large_image"
    assert 'rel="canonical" href="https://ustinian5.github.io/DueFlow/zh/"' in html
    assert 'hreflang="en" href="https://ustinian5.github.io/DueFlow/"' in html
    assert 'hreflang="zh-CN" href="https://ustinian5.github.io/DueFlow/zh/"' in html
    assert '"inLanguage": "zh-CN"' in html
    assert parser.headings[0] == "截止信息四处分散。 你的计划不该如此。"


def test_english_site_advertises_chinese_alternate() -> None:
    html, _ = parse_site()

    assert 'hreflang="zh-CN" href="https://ustinian5.github.io/DueFlow/zh/"' in html
    assert 'href="zh/" lang="zh-CN" hreflang="zh-CN"' in html
    assert "<strong>73</strong><span>project checks</span>" in html


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


def test_simplified_chinese_site_links_and_assets_are_valid() -> None:
    _, parser = parse_site(ZH_SITE / "index.html")
    external_hosts = set()

    for target in parser.links:
        if target.startswith("#"):
            continue
        parsed = urlparse(target)
        if parsed.scheme:
            assert parsed.scheme == "https"
            external_hosts.add(parsed.netloc)
        else:
            assert (ZH_SITE / parsed.path).resolve().exists(), target

    for image in parser.images:
        source = image.get("src")
        assert source and (ZH_SITE / source).resolve().is_file()
        assert image.get("alt") is not None

    assert external_hosts == {"github.com"}
    assert "https://github.com/Ustinian5/DueFlow" in parser.links
    assert "../" in parser.links


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


def test_simplified_chinese_site_is_accessible_and_tracking_free() -> None:
    html, parser = parse_site(ZH_SITE / "index.html")

    assert "跳到正文" in html
    assert 'aria-live="polite"' in html
    assert all(not script.get("src", "").startswith("http") for script in parser.scripts)
    assert "data-copy-success=\"已复制\"" in html
    assert "<strong>73</strong><span>项目检查</span>" in html

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
    assert "<loc>https://ustinian5.github.io/DueFlow/zh/</loc>" in sitemap


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
    chinese = (ROOT / "README.zh-CN.md").read_text(encoding="utf-8")

    assert "https://ustinian5.github.io/DueFlow/" in readme
    assert 'href="README.zh-CN.md">简体中文</a>' in readme
    assert 'href="README.md">English</a>' in chinese
    assert "https://ustinian5.github.io/DueFlow/zh/" in chinese
    assert "conda run -n dueflow python scripts/run_demo.py" in chinese


def test_simplified_chinese_readme_local_file_links_resolve() -> None:
    chinese = (ROOT / "README.zh-CN.md").read_text(encoding="utf-8")
    targets = re.findall(r"\[[^\]]+\]\(([^)]+)\)", chinese)
    local_paths = {
        target.split("#", 1)[0]
        for target in targets
        if target and not target.startswith(("#", "http://", "https://"))
    }

    assert local_paths
    assert all((ROOT / target).exists() for target in local_paths)
