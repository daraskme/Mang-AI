from PIL import Image, ImageDraw
from pathlib import Path
folder = Path(__file__).resolve().parent.parent / 'examples' / 'demo'
folder.mkdir(parents=True, exist_ok=True)
for number, (bg, color, caption) in enumerate([
    ('#e9eee3', '#af623e', 'a rust-colored ceramic vase holding three leafy stems stands on a light table against a pale green wall.'),
    ('#e3e7eb', '#5d7b93', 'a blue ceramic vase holding three leafy stems stands on a light table against a pale blue wall.'),
    ('#ebe5db', '#928159', 'an ochre ceramic vase holding three leafy stems stands on a light table against a beige wall.')
], 1):
    im = Image.new('RGB', (512, 512), bg)
    d = ImageDraw.Draw(im)
    d.rectangle((0,370,512,512),fill='#d4c5af')
    d.ellipse((128,382,386,420),fill='#b3ac9b')
    for end in [(194,110),(265,83),(327,154)]:
        d.line((255,297,*end),fill='#536b45',width=7)
        x,y=end
        d.ellipse((x-22,y-13,x+21,y+25),fill='#658254')
        d.ellipse((x-3,y+29,x+30,y+46),fill='#728e60')
    d.polygon([(217,280),(294,280),(317,363),(291,400),(215,400),(191,363)],fill=color)
    d.ellipse((217,272,294,292),fill='#4b473f')
    im.save(folder / f'vase_{number:02}.png')
    (folder / f'vase_{number:02}.txt').write_text('@demo_vase, '+caption+'\n',encoding='utf-8')
