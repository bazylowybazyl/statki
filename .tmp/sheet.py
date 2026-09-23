# contact sheet: python sheet.py out.png cols img1 img2 ...  (labels = file names)
import sys
from PIL import Image, ImageDraw
out, cols, files = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
w, h = 960, 540
rows = (len(files) + cols - 1) // cols
sheet = Image.new('RGB', (w * cols, h * rows), (20, 20, 20))
d = ImageDraw.Draw(sheet)
for i, f in enumerate(files):
    im = Image.open(f).convert('RGB').resize((w, h), Image.LANCZOS)
    x, y = (i % cols) * w, (i // cols) * h
    sheet.paste(im, (x, y))
    name = f.replace(chr(92), '/').split('/')[-1]
    d.rectangle((x, y, x + 8 * len(name) + 10, y + 18), fill=(0, 0, 0))
    d.text((x + 5, y + 3), name, fill=(255, 255, 0))
sheet.save(out)
print(out)
