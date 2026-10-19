"""Build the approved echo test identity as portable SVG paths and PNG/ICO exports.

Build-only requirements: fonttools==4.60.1, Pillow. Run on Windows with Segoe UI
and Microsoft YaHei installed. Application users do not need these tools.
"""
from pathlib import Path
import hashlib
import html
import json
import os
import shutil
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / '.runtime/brand-tools'))
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from PIL import Image

OUT = ROOT / 'docs/brand'
INK = '#122D39'
MINT = '#42D6B0'
PAPER = '#F6F8F4'
FONTS = Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Fonts'


def lettering(text, x, baseline, size, color=INK, bold=False, chinese=False):
    """Outline every glyph so GitHub/Linux render the same wordmark as Windows."""
    font = TTFont(FONTS / ('msyhbd.ttc' if bold else 'msyh.ttc'), fontNumber=0) if chinese else TTFont(FONTS / ('segoeuib.ttf' if bold else 'segoeui.ttf'))
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    scale = size / font['head'].unitsPerEm
    cursor = 0
    shapes = []
    for char in text:
        glyph = glyphs[cmap[ord(char)]]
        pen = SVGPathPen(glyphs)
        glyph.draw(pen)
        shapes.append(f'<path transform="translate({cursor:.3f} 0)" d="{pen.getCommands()}"/>')
        cursor += glyph.width
    font.close()
    return f'<g fill="{color}" transform="translate({x} {baseline}) scale({scale:.7f} {-scale:.7f})">'+''.join(shapes)+'</g>', cursor * scale


def mark(color=INK, accent=MINT):
    return f'''<g fill="none" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 78C27 40 53 17 86 13M23 110C33 143 56 165 87 171" stroke="{accent}" stroke-width="10"/>
      <path d="M142 61C127 41 105 34 82 42C55 51 40 79 47 106C54 134 83 149 110 141C124 137 134 129 142 118M47 91H104" stroke="{color}" stroke-width="18"/>
      <path d="M103 89L114 100L134 79" stroke="{accent}" stroke-width="14"/>
    </g>'''


def wordmark(x=193, baseline=135, size=118, color=INK):
    echo, width = lettering('echo', x, baseline, size, color, bold=True)
    test, _ = lettering('test', x + width + 14, baseline, size, color)
    return echo + test


def svg(width, height, body, title='echo test'):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-label="{html.escape(title, quote=True)}"><title>{html.escape(title)}</title>{body}</svg>\n'


def write(name, content):
    file = OUT / name
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(content, encoding='utf-8', newline='\n')


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    write('mark.svg', svg(192, 192, mark()))
    write('mark-light.svg', svg(192, 192, mark('#FFFFFF')))
    write('mark-mono.svg', svg(192, 192, mark(INK, INK)))
    write('mark-white.svg', svg(192, 192, mark('#FFFFFF', '#FFFFFF')))
    write('logo.svg', svg(760, 192, mark() + wordmark()))
    write('logo-light.svg', svg(760, 192, mark('#FFFFFF') + wordmark(color='#FFFFFF')))
    write('logo-mono.svg', svg(760, 192, mark(INK, INK) + wordmark()))
    tagline, _ = lettering('每一次测试，都有回响', 198, 198, 28, chinese=True)
    write('logo-tagline.svg', svg(760, 230, mark() + wordmark() + tagline))
    stacked = '<g transform="translate(114 9)">'+mark()+'</g>'
    word_width = lettering('echo',0,0,118,bold=True)[1] + 14 + lettering('test',0,0,118)[1]
    stacked += f'<g transform="translate({(400-word_width*.65)/2:.3f} 184) scale(.65)">'+wordmark(x=0)+'</g>'
    write('logo-stacked.svg', svg(400, 300, stacked))
    app_icon = f'<rect x="8" y="8" width="496" height="496" rx="112" fill="{PAPER}"/><g transform="translate(70 52) scale(2)">'+mark()+'</g>'
    write('app-icon.svg', svg(512, 512, app_icon))
    write('app-icon-dark.svg', svg(512, 512, f'<rect x="8" y="8" width="496" height="496" rx="112" fill="{INK}"/><g transform="translate(70 52) scale(2)">'+mark('#FFFFFF')+'</g>'))
    # GitHub displays local SVGs without embedded fonts; all text below is paths.
    banner = f'<rect width="1280" height="420" rx="28" fill="{PAPER}"/>'
    banner += '<g transform="translate(68 80) scale(1.02)">'+mark()+wordmark()+'</g>'
    label, _ = lettering('WINDOWS DESKTOP AUTOMATION', 80, 49, 15, '#52756C', bold=True)
    line, _ = lettering('每一次测试，都有回响', 274, 285, 31, chinese=True)
    sub, _ = lettering('录制操作  /  识别控件  /  验证结果', 81, 363, 20, '#52756C', chinese=True)
    banner += label + line + sub
    for radius, opacity in [(95, '.5'), (137, '.32'), (179, '.18')]:
        banner += f'<circle cx="1156" cy="212" r="{radius}" fill="none" stroke="{MINT}" stroke-width="3" opacity="{opacity}"/>'
    banner += f'<circle cx="1156" cy="212" r="53" fill="{INK}"/><path d="M1132 212l17 17 32-35" fill="none" stroke="{MINT}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>'
    write('github-banner.svg', svg(1280, 420, banner))
    social = f'<rect width="1280" height="640" fill="{INK}"/>'
    social += '<g transform="translate(80 120) scale(1.35)">'+mark('#FFFFFF')+wordmark(color='#FFFFFF')+'</g>'
    line, _ = lettering('每一次测试，都有回响', 94, 438, 42, '#FFFFFF', chinese=True)
    sub, _ = lettering('Windows 桌面自动化测试工作台', 94, 523, 27, MINT, chinese=True)
    social += line + sub
    write('social-preview.svg', svg(1280, 640, social))
    shutil.copy2(OUT/'app-icon.svg', ROOT/'electron/assets/studio.svg')
    renderer_brand = ROOT/'electron/renderer/brand'
    renderer_brand.mkdir(exist_ok=True)
    shutil.copy2(OUT/'mark.svg', renderer_brand/'mark.svg')
    shutil.copy2(OUT/'mark.svg', OUT/'favicon.svg')
    jobs = []
    def export(source, output, width, height):
        jobs.append(dict(source='docs/brand/'+source, output=output, width=width, height=height))
    for name, width, height in [('mark',192,192),('mark-light',192,192),('mark-mono',192,192),('mark-white',192,192),('logo',760,192),('logo-light',760,192),('logo-mono',760,192),('logo-tagline',760,230),('logo-stacked',400,300)]:
        export(name+'.svg', 'docs/brand/'+name+'.png', width*3, height*3)
    export('github-banner.svg', 'docs/brand/github-banner.png', 2560, 840)
    export('social-preview.svg', 'docs/brand/social-preview.png', 1280, 640)
    export('app-icon-dark.svg', 'docs/brand/app-icon-dark.png', 1024, 1024)
    for size in (16,20,24,32,40,48,64,128,256,512,1024):
        export('app-icon.svg', f'docs/brand/icons/echo-test-{size}.png', size, size)
    write('exports.json', json.dumps(jobs, indent=2)+'\n')
    env = os.environ.copy()
    env.pop('ELECTRON_RUN_AS_NODE', None)
    rendered = subprocess.run([str(ROOT/'node_modules/electron/dist/electron.exe'), str(ROOT/'scripts/brand/export.cjs')], cwd=ROOT, env=env, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if rendered.returncode:
        raise RuntimeError(rendered.stdout + rendered.stderr)
    ico_sizes = (16,20,24,32,40,48,64,128,256)
    frames = [Image.open(OUT/f'icons/echo-test-{size}.png').convert('RGBA') for size in ico_sizes]
    frames[-1].save(OUT/'echo-test.ico', format='ICO', sizes=[(s,s) for s in ico_sizes], append_images=frames[:-1])
    shutil.copy2(OUT/'echo-test.ico', ROOT/'electron/assets/studio.ico')
    shutil.copy2(OUT/'icons/echo-test-256.png', ROOT/'electron/assets/studio.png')
    shutil.copy2(OUT/'echo-test.ico', OUT/'favicon.ico')
    shutil.copy2(OUT/'icons/echo-test-32.png', OUT/'favicon.png')
    for item in jobs:
        with Image.open(ROOT/item['output']) as image:
            assert image.size == (item['width'], item['height']), item['output']
            if item['source'].endswith('/mark.svg'):
                assert image.mode == 'RGBA' and image.getpixel((0,0))[3] == 0
    with Image.open(OUT/'echo-test.ico') as icon:
        assert icon.ico.sizes() == {(s,s) for s in ico_sizes}
    # Include the guide and the preview alongside the production assets.
    archive = ROOT/'dist/echo-test-brand-kit.zip'
    archive.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as bundle:
        for file in sorted(OUT.rglob('*')):
            if file.is_file() and file.name not in {'exports.json'}:
                bundle.write(file, 'echo-test-brand-kit/'+file.relative_to(OUT).as_posix())
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    archive.with_suffix('.zip.sha256').write_text(digest+'  '+archive.name+'\n', encoding='ascii')
    print(f'Validated {len(jobs)} PNG exports and {len(ico_sizes)} ICO frames. Brand kit: {archive}')


if __name__ == '__main__':
    main()
