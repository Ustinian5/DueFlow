from __future__ import annotations

from html.parser import HTMLParser
import json
from pathlib import Path
import re
from urllib.parse import urlparse

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "docs" / "site"
ZH_SITE = SITE / "zh"
PREVIEW_DOWNLOAD = (
    "https://github.com/Ustinian5/DueFlow/releases/download/v0.1.1/"
    "DueFlow-Desktop_0.1.1_arm64_20260812T193208Z.app.zip"
)
PREVIEW_CHECKSUM = f"{PREVIEW_DOWNLOAD}.sha256"


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
        "service-worker.js",
        ".nojekyll",
        "assets/icon.png",
        "assets/dashboard.png",
        "assets/social-preview.png",
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
    assert keyed["og:image"].endswith("/assets/social-preview.png")
    assert keyed["og:image:width"] == "1280"
    assert keyed["og:image:height"] == "640"
    assert keyed["twitter:image"] == keyed["og:image"]
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
    assert keyed["og:image"].endswith("/assets/social-preview.png")
    assert keyed["og:image:width"] == "1280"
    assert keyed["og:image:height"] == "640"
    assert keyed["twitter:image"] == keyed["og:image"]
    assert keyed["twitter:card"] == "summary_large_image"
    assert 'rel="canonical" href="https://ustinian5.github.io/DueFlow/zh/"' in html
    assert 'hreflang="en" href="https://ustinian5.github.io/DueFlow/"' in html
    assert 'hreflang="zh-CN" href="https://ustinian5.github.io/DueFlow/zh/"' in html
    assert '"inLanguage": "zh-CN"' in html
    assert parser.headings[0] == "截止信息四处分散。 你的计划不该如此。"


def test_social_preview_meets_github_image_requirements() -> None:
    preview = SITE / "assets" / "social-preview.png"
    data = preview.read_bytes()

    assert data.startswith(b"\x89PNG\r\n\x1a\n")
    assert int.from_bytes(data[16:20], "big") == 1280
    assert int.from_bytes(data[20:24], "big") == 640
    assert preview.stat().st_size < 1_000_000
    assert (ROOT / "docs" / "images" / "social-preview.svg").is_file()


def test_english_site_advertises_chinese_alternate() -> None:
    html, _ = parse_site()

    assert 'hreflang="zh-CN" href="https://ustinian5.github.io/DueFlow/zh/"' in html
    assert 'href="zh/" lang="zh-CN" hreflang="zh-CN"' in html
    assert "<strong>81</strong><span>project checks</span>" in html


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


def test_pages_site_promotes_verified_standalone_preview() -> None:
    english, english_parser = parse_site()
    chinese, chinese_parser = parse_site(ZH_SITE / "index.html")

    for html, parser in [(english, english_parser), (chinese, chinese_parser)]:
        assert parser.links.count(PREVIEW_DOWNLOAD) == 2
        assert PREVIEW_CHECKSUM in parser.links
        assert html.count("data-preview-download") == 2
        assert f'"downloadUrl": "{PREVIEW_DOWNLOAD}"' in html
        assert '"operatingSystem": "macOS (Apple Silicon)"' in html

    assert "Download for Apple Silicon" in english
    assert "No Python or Conda at runtime" in english
    assert "下载 Apple Silicon 预览版" in chinese
    assert "运行时无需 Python 或 Conda" in chinese


def test_pages_site_has_local_browser_sample() -> None:
    english, _ = parse_site()
    chinese, _ = parse_site(ZH_SITE / "index.html")
    script = (SITE / "app.js").read_text(encoding="utf-8")
    styles = (SITE / "styles.css").read_text(encoding="utf-8")

    for html in [english, chinese]:
        assert html.count("data-browser-demo") == 1
        assert html.count("data-demo-form") == 1
        assert html.count("data-demo-input") == 1
        assert html.count("data-demo-run") == 1
        assert html.count("data-demo-result") == 1
        assert html.count("data-demo-star") == 1
        assert html.count("data-demo-share") == 2
        assert html.count("data-demo-share-status") == 1
        assert html.count("data-demo-install") == 1
        assert html.count("data-demo-copy-plan") == 1
        assert html.count("data-demo-download-calendar") == 1
        assert html.count("data-demo-export-status") == 1
        assert "2026-09-30" in html

    assert "Turn one deadline into a reverse plan." in english
    assert "Nothing is uploaded." in english
    assert "After the first visit, the sample works offline." in english
    assert "把一个截止日期变成倒排计划。" in chinese
    assert "内容不会上传。" in chinese
    assert "首次访问后还可离线使用。" in chinese
    assert "Share this local demo" in english
    assert "分享这个本地演示" in chinese
    assert "Copy generated plan" in english
    assert "Download calendar (.ics)" in english
    assert "复制生成的计划" in chinese
    assert "下载日历（.ics）" in chinese
    assert 'form?.addEventListener("submit"' in script
    assert 'shareButton?.addEventListener("click"' in script
    assert "parseIsoDate" in script
    assert "replaceChildren" in script
    assert "navigator.share(shareData)" in script
    assert "navigator.clipboard.writeText" in script
    assert 'window.addEventListener("beforeinstallprompt"' in script
    assert 'installButton?.addEventListener("click"' in script
    assert 'window.addEventListener("appinstalled"' in script
    assert "navigator.serviceWorker.register" in script
    assert 'copyPlanButton?.addEventListener("click"' in script
    assert 'calendarButton?.addEventListener("click"' in script
    assert 'type: "text/calendar;charset=utf-8"' in script
    assert "BEGIN:VCALENDAR" in script
    assert "END:VCALENDAR" in script
    assert "BEGIN:VEVENT" in script
    assert "END:VEVENT" in script
    assert "DTSTART;VALUE=DATE" in script
    assert "DTEND;VALUE=DATE" in script
    assert "URL.createObjectURL" in script
    assert "URL.revokeObjectURL" in script
    assert "dueflow-reverse-plan-" in script
    assert "AbortError" in script
    assert "https://ustinian5.github.io/DueFlow/zh/" in script
    assert "I turned one deadline into a five-step reverse plan" in script
    assert "我用 DueFlow 的本地浏览器样例" in script
    assert ".browser-demo-result[hidden]" in styles
    assert ".browser-demo-conversion" in styles
    assert ".browser-demo-share-status" in styles
    assert ".browser-demo-export" in styles
    assert ".browser-demo-export-status" in styles

    for forbidden in ["fetch(", "XMLHttpRequest", "sendBeacon", "WebSocket"]:
        assert forbidden not in script


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
    assert "<strong>81</strong><span>项目检查</span>" in html

    combined = html + (SITE / "app.js").read_text(encoding="utf-8")
    for forbidden in ["google-analytics", "gtag(", "segment.com", "posthog", "mixpanel"]:
        assert forbidden not in combined.lower()


def test_pages_manifest_and_discovery_files_match_canonical_url() -> None:
    manifest = json.loads((SITE / "site.webmanifest").read_text(encoding="utf-8"))
    robots = (SITE / "robots.txt").read_text(encoding="utf-8")
    sitemap = (SITE / "sitemap.xml").read_text(encoding="utf-8")

    assert manifest["name"] == "DueFlow"
    assert manifest["id"] == "./"
    assert manifest["scope"] == "./"
    assert manifest["start_url"] == "./"
    assert manifest["display"] == "standalone"
    assert manifest["categories"] == ["productivity", "utilities"]
    assert manifest["icons"][0]["src"] == "assets/icon.png"
    assert "Sitemap: https://ustinian5.github.io/DueFlow/sitemap.xml" in robots
    assert "<loc>https://ustinian5.github.io/DueFlow/</loc>" in sitemap
    assert "<loc>https://ustinian5.github.io/DueFlow/zh/</loc>" in sitemap


def test_pages_browser_sample_has_scoped_offline_cache() -> None:
    worker = (SITE / "service-worker.js").read_text(encoding="utf-8")

    for expected in [
        'const CACHE_PREFIX = "dueflow-site-"',
        '"./zh/index.html"',
        '"./site.webmanifest"',
        '"./assets/icon.png"',
        'self.addEventListener("install"',
        'self.addEventListener("activate"',
        'self.addEventListener("fetch"',
        "cache.addAll(CORE_URLS)",
        "self.skipWaiting()",
        "self.clients.claim()",
        'request.method !== "GET"',
        "url.origin !== self.location.origin",
        'request.mode === "navigate"',
        "caches.match(ROOT_URL)",
    ]:
        assert expected in worker

    assert "https://" not in worker
    assert "http://" not in worker


def test_browser_sample_local_exports_do_not_submit_user_content() -> None:
    script = (SITE / "app.js").read_text(encoding="utf-8")

    assert "buildPlanText" in script
    assert "buildCalendar" in script
    assert "navigator.clipboard.writeText(buildPlanText())" in script
    assert "new Blob([buildCalendar()]" in script
    assert "generatedMilestones" in script
    assert "generatedDeadline" in script
    assert "generatedRisk" in script

    for forbidden in ["fetch(", "XMLHttpRequest", "sendBeacon", "WebSocket"]:
        assert forbidden not in script

    worker = (SITE / "service-worker.js").read_text(encoding="utf-8")
    assert 'const CACHE_NAME = `${CACHE_PREFIX}v2`' in worker


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

    assert "Try the Browser Sample - No Install" in readme
    assert 'href="https://ustinian5.github.io/DueFlow/#demo"' in readme
    assert 'src="docs/images/browser-sample-en.png"' in readme
    assert "无需安装，直接在浏览器试用" in chinese
    assert 'href="https://ustinian5.github.io/DueFlow/zh/#demo"' in chinese
    assert 'src="docs/images/browser-sample-zh.png"' in chinese

    for relative_path in [
        "docs/images/browser-sample-en.png",
        "docs/images/browser-sample-zh.png",
    ]:
        screenshot = ROOT / relative_path
        data = screenshot.read_bytes()
        assert data.startswith(b"\x89PNG\r\n\x1a\n")
        assert int.from_bytes(data[16:20], "big") == 1440
        assert int.from_bytes(data[20:24], "big") == 1057
        assert screenshot.stat().st_size < 500_000

    pdf = PdfReader(ROOT / "README.pdf")
    pdf_text = "\n".join(page.extract_text() or "" for page in pdf.pages)
    assert len(pdf.pages) == 7
    assert "Open the 60-second browser sample" in pdf_text
    assert "Why DueFlow" in pdf_text
    assert "DueFlow - MIT licensed - github.com/Ustinian5/DueFlow" in pdf_text
    assert "<div" not in pdf_text
    assert "<a href" not in pdf_text


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
