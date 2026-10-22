"""Temporary local Maven Central bridge for networks where Java TLS fails."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urlsplit
from urllib.request import Request, urlopen
import os
import time


ROOT = Path(os.environ.get("LOCALAPPDATA", ".")) / "weisuoyuwei-build-tools" / "maven-cache"
ROOT.mkdir(parents=True, exist_ok=True)
BASE = "https://repo1.maven.org/maven2/"


class Handler(BaseHTTPRequestHandler):
    def do_HEAD(self):
        self.serve(send_body=False)

    def do_GET(self):
        self.serve(send_body=True)

    def serve(self, send_body):
        path = unquote(urlsplit(self.path).path)
        if not path.startswith("/maven2/") or ".." in Path(path).parts:
            self.send_error(404)
            return
        relative = path[len("/maven2/"):]
        if not relative or relative.endswith("/"):
            self.send_error(404)
            return
        cached = ROOT / relative
        if cached.exists():
            body = cached.read_bytes() if send_body else None
            self.send_response(200)
            self.send_header("Content-Length", str(cached.stat().st_size))
            self.end_headers()
            if body is not None:
                self.wfile.write(body)
            return
        for attempt in range(5):
            try:
                with urlopen(Request(BASE + relative, method="GET"), timeout=45) as response:
                    body = response.read()
                cached.parent.mkdir(parents=True, exist_ok=True)
                temp = cached.with_name(cached.name + "." + str(os.getpid()) + ".tmp")
                temp.write_bytes(body)
                temp.replace(cached)
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                if send_body:
                    self.wfile.write(body)
                return
            except HTTPError as error:
                if error.code == 404:
                    self.send_error(404)
                    return
            except (URLError, TimeoutError, OSError):
                pass
            time.sleep(attempt + 1)
        self.send_error(502, "Maven Central download failed")

    def log_message(self, format, *args):
        print(format % args, flush=True)


print("Maven bridge listening on 127.0.0.1:8765", flush=True)
ThreadingHTTPServer(("127.0.0.1", 8765), Handler).serve_forever()
