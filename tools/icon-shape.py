# Source of truth for the deepmemory mark: one whale, three holes.
#
# Coordinates are on a 36x36 grid. Edit here, then run `node tools/icon-emit.mjs`
# and paste the two paths it prints into `icon.svg` and `lib/client.js`.
# BODY is the silhouette (implicitly closed); DOTS are punched out of it.
TOP = (0x72, 0x8F, 0xFF)
BOTTOM = (0x3B, 0x50, 0xE3)

BODY = [
    ('M', (7.9, 21.6)),
    ('C', (7.1, 15.2), (10.6, 10.5), (16.4, 10.3)),
    ('C', (20.2, 10.2), (23.6, 11.9), (25.4, 14.9)),
    ('L', (30.6, 12.4)),
    ('L', (24.6, 17.5)),
    ('L', (29.9, 22.6)),
    ('C', (27.4, 23.4), (23.8, 24.9), (19.9, 25.4)),
    ('C', (15.4, 25.9), (11.3, 25.5), (9.1, 23.5)),
    ('C', (8.4, 22.8), (8.0, 22.2), (7.9, 21.6)),
]

FLUKE = []
EYE = (12.1, 17.4, 0.95)
EYE_COLOR = (255, 255, 255)
DOTS = [(14.6, 22.2, 0.92), (18.5, 22.5, 0.92), (22.3, 22.1, 0.92)]
