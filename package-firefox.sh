#!/usr/bin/env sh

zip -r -FS -Z deflate clean-feeds.xpi icons/* viewer.* *.js manifest.json --exclude '*.git*'
