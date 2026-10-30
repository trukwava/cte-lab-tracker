"""Local QR-document renderer. Input is JSON array of non-sensitive URLs from stdin."""
import json
import sys
import qrcode
from qrcode.image.svg import SvgPathImage

urls = json.load(sys.stdin)
if not isinstance(urls, list) or len(urls) > 24:
    raise ValueError('Expected at most 24 URLs')
result = []
for url in urls:
    if not isinstance(url, str) or len(url) > 250:
        raise ValueError('Invalid URL')
    img = qrcode.make(url, image_factory=SvgPathImage, box_size=5, border=2)
    result.append(img.to_string(encoding='unicode'))
print(json.dumps(result))
