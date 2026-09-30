"""Rex Legend 本機開發伺服器。

用途：提供靜態檔案，並強制加上 no-cache 標頭，
避免瀏覽器快取舊的 JS module 導致改了看不到效果。

用法（在本資料夾執行）：
    python serve.py
然後開 http://localhost:8010
"""

import http.server
import socketserver
import os

PORT = 8010
# 以本檔所在資料夾為根目錄（遵守動態磁碟規則，不寫死磁碟代號）
ROOT = os.path.dirname(os.path.abspath(__file__))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        # 強制不快取，確保每次重整都抓最新檔案
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), NoCacheHandler) as httpd:
        print(f"Rex Legend server running at http://localhost:{PORT}  (root: {ROOT})")
        httpd.serve_forever()
