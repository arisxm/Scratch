#!/usr/bin/env python3
"""Generate the customer installation guide (PDF) for a Scratch release.

    pip install reportlab fonttools brotli
    python3 scripts/make-install-guide.py "release/Scratch Installation Guide.pdf"

Edit the text below and regenerate. Set SUPPORT to add a contact section, and
set SIGNED = True once the installer is code-signed (it changes the
SmartScreen advice, which must stay accurate).
"""
import glob
import json
import os
import sys
import tempfile

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont as RLFont
from reportlab.platypus import (Image, KeepTogether, ListFlowable, ListItem, Paragraph,
                                SimpleDocTemplate, Spacer, Table, TableStyle)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PKG = json.load(open(os.path.join(ROOT, 'package.json'), encoding='utf-8'))
VERSION = PKG['version']
PUBLISHER = PKG['author']['name']
SUPPORT = ''        # e.g. 'support@example.com'; leave empty to omit the section
SIGNED = False      # True once Scratch_Setup.exe is Authenticode-signed

INK = HexColor('#27304a')
SOFT = HexColor('#5d6478')
PEN = HexColor('#3550a8')
PAPER = HexColor('#fff3a6')
BAND = HexColor('#fbe37c')


def register_fonts():
    """Static instances of the app's own variable fonts (bundled in node_modules)."""
    tmp = tempfile.mkdtemp()
    src = {
        'figtree': glob.glob(os.path.join(ROOT, 'node_modules/@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2'))[0],
        'caveat': glob.glob(os.path.join(ROOT, 'node_modules/@fontsource-variable/caveat/files/caveat-latin-wght-normal.woff2'))[0],
    }
    for name, family, weight in [('Body', 'figtree', 400), ('BodySemi', 'figtree', 600),
                                 ('BodyBold', 'figtree', 800), ('Hand', 'caveat', 700)]:
        font = TTFont(src[family])
        font.flavor = None
        font = instancer.instantiateVariableFont(font, {'wght': weight})
        # Every instance inherits the variable font's PostScript name, and the
        # PDF library embeds fonts by that name, so without this all weights
        # collapse into one (headings and <b> came out light).
        ps = f'{family.capitalize()}-{name}{weight}'
        for rec in font['name'].names:
            if rec.nameID in (4, 6):
                rec.string = ps
        path = os.path.join(tmp, f'{name}.ttf')
        font.save(path)
        pdfmetrics.registerFont(RLFont(name, path))
    # so <b>…</b> inside a paragraph switches to the semi-bold face
    pdfmetrics.registerFontFamily('Body', normal='Body', bold='BodySemi', italic='Body', boldItalic='BodySemi')


def styles():
    base = dict(fontName='Body', fontSize=10.2, leading=14.6, textColor=INK, alignment=TA_LEFT)
    return {
        'title': ParagraphStyle('title', fontName='Hand', fontSize=34, leading=36, textColor=INK),
        'sub': ParagraphStyle('sub', fontName='BodySemi', fontSize=11, leading=15, textColor=SOFT),
        'h2': ParagraphStyle('h2', fontName='BodyBold', fontSize=13, leading=17, textColor=INK, spaceBefore=12, spaceAfter=4),
        'body': ParagraphStyle('body', **base, spaceAfter=5),
        'small': ParagraphStyle('small', **{**base, 'fontSize': 9, 'leading': 12.5, 'textColor': SOFT}),
        'note': ParagraphStyle('note', **{**base, 'fontSize': 9.6, 'leading': 13.6}),
        'cell': ParagraphStyle('cell', **{**base, 'fontSize': 9.6, 'leading': 13.2}),
        'cellb': ParagraphStyle('cellb', **{**base, 'fontName': 'BodySemi', 'fontSize': 9.6, 'leading': 13.2}),
    }


def steps(items, st):
    return ListFlowable(
        [ListItem(Paragraph(t, st['body']), leftIndent=16) for t in items],
        bulletType='1', bulletFontName='BodyBold', bulletColor=PEN, bulletFontSize=10, leftIndent=16,
    )


def note(text, st):
    box = Table([[Paragraph(text, st['note'])]], colWidths=[170 * mm])
    box.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), PAPER),
        ('LINEBEFORE', (0, 0), (0, -1), 3, BAND),
        ('LEFTPADDING', (0, 0), (-1, -1), 10), ('RIGHTPADDING', (0, 0), (-1, -1), 10),
        ('TOPPADDING', (0, 0), (-1, -1), 7), ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
    ]))
    return box


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont('Body', 8.5)
    canvas.setFillColor(SOFT)
    canvas.drawString(20 * mm, 12 * mm, f'Scratch {VERSION}  |  {PUBLISHER}')
    canvas.drawRightString(190 * mm, 12 * mm, f'Page {doc.page}')
    canvas.restoreState()


def build(out):
    register_fonts()
    st = styles()
    smartscreen = (
        'The installer is signed by Arian, Sadif & Shibly.' if SIGNED else
        '<b>If Windows shows “Windows protected your PC”:</b> this release of the installer is not '
        'digitally signed yet, so Microsoft Defender SmartScreen may warn about it. Check that you '
        f'downloaded it from {PUBLISHER}, then click <b>More info</b> and <b>Run anyway</b>.'
    )

    icon = Image(os.path.join(ROOT, 'build', 'icon.png'), width=22 * mm, height=22 * mm)
    head = Table([[icon, [Paragraph('Scratch', st['title']),
                          Paragraph(f'Installation guide  ·  version {VERSION}  ·  {PUBLISHER}', st['sub'])]]],
                 colWidths=[27 * mm, 143 * mm])
    head.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'MIDDLE'), ('LEFTPADDING', (0, 0), (-1, -1), 0)]))

    req = Table([
        [Paragraph('Windows', st['cellb']), Paragraph('Windows 10 or Windows 11, 64-bit', st['cell'])],
        [Paragraph('Disk space', st['cellb']), Paragraph('About 400 MB', st['cell'])],
        [Paragraph('Permissions', st['cellb']), Paragraph('No administrator rights needed. Scratch installs for your Windows account only.', st['cell'])],
        [Paragraph('Internet', st['cellb']), Paragraph('Not needed. Your notes are stored on your PC.', st['cell'])],
    ], colWidths=[32 * mm, 138 * mm])
    req.setStyle(TableStyle([
        ('LINEBELOW', (0, 0), (-1, -2), 0.5, HexColor('#e6dfc2')),
        ('TOPPADDING', (0, 0), (-1, -1), 4), ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING', (0, 0), (-1, -1), 0), ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]))

    story = [
        head, Spacer(1, 6 * mm),
        Paragraph('What you need', st['h2']), req,

        Paragraph('Install', st['h2']),
        steps([
            'Double-click <b>Scratch_Setup.exe</b>.',
            'On the welcome page, click <b>Next</b>.',
            'Choose where to install, or keep the suggested folder, and click <b>Next</b>.',
            'Choose whether Scratch starts when you sign in to Windows. This is ticked by default; '
            'untick it if you prefer to open the app yourself. Click <b>Install</b>.',
            'Click <b>Finish</b>. Scratch opens straight away, with a “Start here” note to show you around.',
        ], st),
        Spacer(1, 2 * mm), note(smartscreen, st),
        Paragraph('The installer adds Scratch to your Start menu and your desktop.', st['body']),

        Paragraph('Getting started', st['h2']),
        Paragraph('Scratch puts a small note pad in the bottom-right corner of your screen. '
                  'Click it to add a note. The <b>···</b> button under the pad opens the menu, and so does '
                  'right-clicking the Scratch icon in the taskbar notification area: collapse or expand all notes, Settings, the data folder, About and Quit. '
                  'The clock and archive buttons next to it open the Pomodoro timer and your hidden notes.', st['body']),
        Paragraph('Notes stay on top of your other windows. You can turn that off with <b>Keep notes on top</b> in <b>Settings</b>.', st['body']),

        KeepTogether([
            Paragraph('Starting with Windows', st['h2']),
            Paragraph('To change whether Scratch opens when you sign in, use <b>Open when I sign in</b> in '
                      'the <b>Settings</b> window. You can also switch it on or off in Windows: <b>Settings › Apps › Startup</b>, '
                      'or the <b>Startup apps</b> page of Task Manager. Scratch follows whichever you change last.', st['body']),
            Paragraph('Only one copy of Scratch runs at a time. Opening it again brings your notes to the front.', st['body']),
        ]),

        KeepTogether([
            Paragraph('Updating', st['h2']),
            Paragraph('Run the installer for the new version. Your notes, their positions and your settings are kept, '
                      'and so is your choice about starting with Windows.', st['body']),
            Paragraph('<b>Coming from Sticky Notes?</b> Scratch is its new name. Run the Scratch installer: it replaces '
                      'Sticky Notes and brings your notes across the first time it starts.', st['body']),
        ]),

        KeepTogether([
            Paragraph('Uninstalling', st['h2']),
            Paragraph('Open <b>Settings › Apps › Installed apps</b>, find <b>Scratch</b>, and choose '
                      '<b>Uninstall</b>. This removes the app, its shortcuts and its startup entry.', st['body']),
            Paragraph('Your notes are kept, so they come back if you reinstall. To delete them as well, remove the folder '
                      '<b>%APPDATA%\\Scratch</b> (type it into the File Explorer address bar).', st['body']),
        ]),

        KeepTogether([
            Paragraph('For IT administrators', st['h2']),
            Paragraph('Silent install for the current user: <b>Scratch_Setup.exe /S</b> (starts with Windows by default). '
                      'Silent uninstall (default folder): <b>"%LOCALAPPDATA%\\Programs\\Scratch\\Uninstall Scratch.exe" /currentuser /S</b>. '
                      'The start-with-Windows entry is the value <b>com.stickynotes.desktop</b> under '
                      '<b>HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run</b>.', st['small']),
        ]),
    ]
    if SUPPORT:
        story += [Paragraph('Help', st['h2']), Paragraph(f'Contact {PUBLISHER}: {SUPPORT}', st['body'])]

    doc = SimpleDocTemplate(out, pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm, topMargin=18 * mm, bottomMargin=20 * mm,
                            title='Scratch Installation Guide', author=PUBLISHER, subject=f'Scratch {VERSION}')
    doc.build(story, onFirstPage=footer, onLaterPages=footer)


if __name__ == '__main__':
    build(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'release', 'Scratch Installation Guide.pdf'))
