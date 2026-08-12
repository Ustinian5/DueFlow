#!/usr/bin/env python3
"""Standalone entry point for the DueFlow desktop API sidecar."""

from __future__ import annotations

import argparse
import json
import multiprocessing
import os
from pathlib import Path
import sys
import tempfile


LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}

if not getattr(sys, "frozen", False):
    PROJECT_ROOT = Path(__file__).resolve().parents[1]
    if str(PROJECT_ROOT) not in sys.path:
        sys.path.insert(0, str(PROJECT_ROOT))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="DueFlow bundled desktop API")
    parser.add_argument("--host", default=os.getenv("DUEFLOW_API_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("DUEFLOW_API_PORT", "8000")))
    parser.add_argument("--self-check", action="store_true")
    return parser.parse_args()


def validate_bind_address(host: str, port: int) -> None:
    if host not in LOOPBACK_HOSTS:
        raise SystemExit(f"DueFlow backend only binds to loopback hosts: {host}")
    if not 1 <= port <= 65535:
        raise SystemExit(f"DueFlow backend port must be between 1 and 65535: {port}")


def run_self_check() -> None:
    with tempfile.TemporaryDirectory(prefix="dueflow-backend-self-check-") as directory:
        root = Path(directory)
        os.environ.update(
            {
                "LLM_PROVIDER": "mock",
                "DATABASE_PATH": str(root / "dueflow.db"),
                "INBOX_PATH": str(root / "inbox"),
                "EXPORT_PATH": str(root / "exports"),
            }
        )
        from api.desktop import app

        routes = {route.path for route in app.routes}
        required_routes = {
            "/desktop/health",
            "/desktop/about",
            "/desktop/self-check",
            "/desktop/overview",
        }
        missing = sorted(required_routes - routes)
        if missing:
            raise SystemExit(f"DueFlow backend self-check missing routes: {', '.join(missing)}")
        print(
            json.dumps(
                {
                    "service": "dueflow-backend",
                    "status": "ok",
                    "required_routes": sorted(required_routes),
                },
                separators=(",", ":"),
            )
        )


def serve(host: str, port: int) -> None:
    os.environ.setdefault("LLM_PROVIDER", "mock")
    from api.desktop import app
    import uvicorn

    uvicorn.run(app, host=host, port=port, access_log=False, log_level="warning")


def main() -> None:
    multiprocessing.freeze_support()
    args = parse_args()
    if args.self_check:
        run_self_check()
        return
    validate_bind_address(args.host, args.port)
    serve(args.host, args.port)


if __name__ == "__main__":
    main()
