"""Regenerate the inline preview frame embedded in js/app.js.

The exact frame (assets/frame.webp) is 1.4 MB of lossless artwork, which on
mobile data means several seconds of an empty preview. A small copy is
embedded directly in app.js so the preview paints with no network request at
all; the exact file replaces it once it arrives, and every export uses the
exact file only.

Run from the project root:   python tools/inline-frame.py
"""
import base64, io, os, re, sys

SOURCE = os.path.join("Assests", "Frame.png")
TARGET = os.path.join("js", "app.js")
WIDTH, QUALITY = 440, 62

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is required:  pip install pillow")

if not os.path.exists(SOURCE):
    sys.exit("cannot find %s - run this from the project root" % SOURCE)

src = Image.open(SOURCE).convert("RGBA")
height = round(WIDTH * src.size[1] / src.size[0])
buf = io.BytesIO()
src.resize((WIDTH, height), Image.LANCZOS).save(
    buf, "WEBP", quality=QUALITY, method=6, alpha_quality=90)
uri = "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()

js = io.open(TARGET, encoding="utf-8").read()
line = "  var FRAME_INLINE = '%s';" % uri
pattern = re.compile(r"^  var FRAME_INLINE = '[^']*';$", re.M)

if pattern.search(js):
    js = pattern.sub(lambda m: line, js, count=1)
else:
    anchor = "  var MAX_SOURCE_EDGE = 2200;    // downscale huge phone photos once, on load\n"
    if anchor not in js:
        sys.exit("could not find the insertion point in %s" % TARGET)
    block = (anchor + "\n"
             "  /* A small copy of the artwork, embedded so the preview paints with no\n"
             "     network request. The exact frame replaces it once loaded, and every\n"
             "     export uses the exact one. Regenerate: python tools/inline-frame.py */\n"
             + line + "\n")
    js = js.replace(anchor, block, 1)

io.open(TARGET, "w", encoding="utf-8").write(js)
print("inlined %dx%d q%d  ->  %.1f KB of base64 in %s"
      % (WIDTH, height, QUALITY, len(uri) / 1024, TARGET))
