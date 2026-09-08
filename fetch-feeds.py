import urllib
import urllib.parse
import urllib.request

import json
import re
import os


def read_feeds() -> list[dict]:
    with open("feeds.json") as fp:
        feeds = json.load(fp)
        feeds = feeds["feeds"]
        return feeds


def create_id(s: str) -> str:
    s = s.replace("http://", "")
    s = s.replace("https://", "")
    s = s.replace("www.", "")
    s = s.replace(".", "-")
    s = s.replace("/", "-")
    s = s.replace(":", "-")
    s = s.replace("?", "-")
    s = s.replace("&", "-")
    s = s.replace("#", "-")
    s = s.replace("=", "-")
    s = re.sub(r"-+", "-", s)
    s = s.strip("-").strip()
    return s


def download(url: str, filepath: str) -> None:
    headers = {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0",
    }
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req) as response:
        with open(filepath, "wb") as fp:
            fp.write(response.read())


if __name__ == "__main__":
    feeds = read_feeds()
    for feed in feeds:
        url = feed["url"]
        id = create_id(url)
        filename = f"feeds/{id}.xml"
        if os.path.isfile(filename):
            continue
        try:
            print(f"fetching '{url}', '{id}'")
            download(url, filename)
        except Exception as e:
            print(f"failed to fetch '{url}', exception: {e}")
