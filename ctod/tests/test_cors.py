import asyncio
import unittest
from unittest.mock import patch
from starlette.middleware.cors import CORSMiddleware
from ctod.server.settings import Settings


class CorsTests(unittest.IsolatedAsyncioTestCase):
    async def call(self, origin, method="GET", regex=None):
        with patch("sys.argv", ["ctod"]), patch.dict("os.environ", {}, clear=True):
            settings = Settings()
        async def endpoint(scope, receive, send):
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": b"terrain"})
        app = CORSMiddleware(endpoint, allow_origins=["https://mars.example.org"],
                             allow_origin_regex=settings.cors_allow_origin_regex if regex is None else regex,
                             allow_methods=["GET"], allow_headers=["*"])
        messages = []
        async def send(message): messages.append(message)
        async def receive(): return {"type": "http.request", "body": b""}
        headers = [(b"origin", origin.encode())]
        if method == "OPTIONS":
            headers += [(b"access-control-request-method", b"GET"),
                        (b"access-control-request-headers", b"accept")]
        await app({"type": "http", "method": method, "headers": headers}, receive, send)
        return messages[0]

    async def test_loopback_all_ports_and_preflight(self):
        for origin in ["http://localhost:5500", "http://127.0.0.1:8317",
                       "https://localhost", "http://[::1]:9123"]:
            for method in ["GET", "OPTIONS"]:
                response = await self.call(origin, method)
                self.assertEqual(response["status"], 200)
                self.assertIn((b"access-control-allow-origin", origin.encode()), response["headers"])

    async def test_other_hosts_need_explicit_allowlist(self):
        for origin in ["http://localhost.evil.test:5500", "http://127.0.0.1.evil.test", "null", "https://unlisted.example"]:
            response = await self.call(origin)
            self.assertNotIn(b"access-control-allow-origin", dict(response["headers"]))
        response = await self.call("https://mars.example.org")
        self.assertIn(b"access-control-allow-origin", dict(response["headers"]))

    async def test_loopback_policy_can_be_disabled(self):
        response = await self.call("http://localhost:5500", regex="")
        self.assertNotIn(b"access-control-allow-origin", dict(response["headers"]))
