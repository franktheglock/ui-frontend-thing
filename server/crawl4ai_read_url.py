import asyncio
import contextlib
import gc
import io
import json
import sys
import warnings
from typing import Any

from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig
from crawl4ai.content_filter_strategy import PruningContentFilter
from crawl4ai.markdown_generation_strategy import DefaultMarkdownGenerator


def _normalize_markdown(markdown_result: Any) -> str:
    if markdown_result is None:
        return ""
    if isinstance(markdown_result, str):
        return markdown_result

    fit_markdown = getattr(markdown_result, "fit_markdown", None)
    if fit_markdown:
        return str(fit_markdown)

    raw_markdown = getattr(markdown_result, "raw_markdown", None)
    if raw_markdown:
        return str(raw_markdown)

    markdown_with_citations = getattr(markdown_result, "markdown_with_citations", None)
    if markdown_with_citations:
        return str(markdown_with_citations)

    return str(markdown_result)


async def _crawl(url: str) -> dict[str, Any]:
    browser_config = BrowserConfig(headless=True, verbose=False)
    run_config = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS,
        excluded_tags=["script", "style", "nav", "footer", "aside", "form", "noscript"],
        remove_overlay_elements=True,
        process_iframes=True,
        markdown_generator=DefaultMarkdownGenerator(
            content_filter=PruningContentFilter(threshold=0.48, threshold_type="fixed", min_word_threshold=5),
            options={"ignore_links": True},
        ),
    )

    result = None
    with contextlib.redirect_stdout(io.StringIO()):
        async with AsyncWebCrawler(config=browser_config) as crawler:
            result = await crawler.arun(url=url, config=run_config)
        # Allow pending subprocess transport cleanup callbacks to drain
        # before the event loop shuts down (avoids "Event loop is closed"
        # errors on Windows ProactorEventLoop).
        await asyncio.sleep(0.1)

    if not result.success:
        return {
            "success": False,
            "url": getattr(result, "url", url) or url,
            "title": "",
            "content": "",
            "error": getattr(result, "error_message", "Crawl failed") or "Crawl failed",
        }

    metadata = getattr(result, "metadata", {}) or {}
    title = metadata.get("title") or metadata.get("og:title") or ""
    content = _normalize_markdown(getattr(result, "markdown", None)).strip()

    return {
        "success": True,
        "url": getattr(result, "url", url) or url,
        "title": str(title).strip(),
        "content": content[:10000],
    }


def main() -> None:
    if len(sys.argv) < 2:
        sys.stdout.write(json.dumps({"success": False, "error": "URL argument is required."}))
        raise SystemExit(1)

    url = sys.argv[1]
    try:
        # Suppress "unclosed transport" ResourceWarning that fires on
        # Windows when Crawl4AI's browser subprocess pipes are GC'd after
        # the event loop closes.  The transports are harmless leftovers.
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", ResourceWarning)
            payload = asyncio.run(_crawl(url))
        # Force GC while nothing depends on the closed loop, so transport
        # __del__ methods don't stumble on a closed loop later.
        gc.collect()
        sys.stdout.write(json.dumps(payload, ensure_ascii=True))
    except Exception as error:  # pragma: no cover - runtime integration guard
        sys.stdout.write(json.dumps({
            "success": False,
            "url": url,
            "title": "",
            "content": "",
            "error": str(error),
        }, ensure_ascii=True))
        raise SystemExit(1)


if __name__ == "__main__":
    main()