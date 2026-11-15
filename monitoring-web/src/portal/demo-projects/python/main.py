"""Python 3.10+, run: python main.py. No external packages."""
import os
import sys
import time
from pathlib import Path
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError
from urllib.parse import urlsplit
import re


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def main():
    env = Path('.env')
    if env.exists():
        for line in env.read_text(encoding='utf-8-sig').splitlines():
            name, sep, value = line.partition('=')
            if sep and name.strip().startswith('MRAPI_'):
                os.environ.setdefault(name.strip(), value.strip())
    base = os.environ.get('MRAPI_GATEWAY_URL', '').rstrip('/')
    api_id = os.environ.get('MRAPI_API_ID', '')
    key = os.environ.get('MRAPI_API_KEY', '')
    url = urlsplit(base)
    if (url.scheme != 'https' or not url.netloc or url.username or url.password
            or url.query or url.fragment or not re.fullmatch(r'[A-Za-z0-9_-]+', api_id)
            or not key.startswith('mrk_')):
        raise ValueError('Cấu hình .env chưa hợp lệ')
    request = Request(f'{base}/proxy/{api_id}/todos/1', headers={'x-api-key': key})
    start = time.monotonic()
    try:
        response = build_opener(NoRedirect).open(request, timeout=15)
    except HTTPError as error:
        response = error
    with response:
        body = response.read(65536).decode('utf-8', errors='replace').replace(key, '[API KEY ĐÃ ẨN]')
        print(f'HTTP {response.code} | {round((time.monotonic()-start)*1000)} ms | region: {response.headers.get("x-served-region", "")}')
        print(body)
        return 0 if 200 <= response.code < 300 else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError):
        print('Lỗi: kiểm tra .env, URL gateway, kết nối mạng và TLS.', file=sys.stderr)
        sys.exit(1)
