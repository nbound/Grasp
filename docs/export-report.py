"""Export the maintained sprint report. Requires reportlab; run from any directory."""
from pathlib import Path
from html import escape
import re
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle
from reportlab.graphics.shapes import Drawing, Rect, String, Line, Polygon

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'output' / 'pdf' / 'grasp-implementation-report.pdf'
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
INK = colors.HexColor('#15362c')
MUTED = colors.HexColor('#526960')
PALE = colors.HexColor('#edf4ed')
WIDTH = 504
styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name='ReportTitle', fontName='Helvetica-Bold', fontSize=23, leading=28, textColor=INK, spaceAfter=14))
styles.add(ParagraphStyle(name='ReportHeading', fontName='Helvetica-Bold', fontSize=15, leading=19, textColor=INK, spaceBefore=13, spaceAfter=10, keepWithNext=True))
styles.add(ParagraphStyle(name='ReportBody', fontName='Helvetica', fontSize=9.6, leading=13.8, textColor=INK, spaceAfter=9, alignment=TA_LEFT))
styles.add(ParagraphStyle(name='Cell', fontName='Helvetica', fontSize=8.5, leading=12, textColor=INK))

def inline(text):
    text = escape(text).replace('`', '')
    return re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', text)

def box(d, x, y, title, width=108):
    d.add(Rect(x, y, width, 32, rx=4, ry=4, fillColor=PALE, strokeColor=MUTED, strokeWidth=.7))
    d.add(String(x + width/2, y + 12, title, fontName='Helvetica-Bold', fontSize=8.8, fillColor=INK, textAnchor='middle'))

def arrow(d, x1, y1, x2, y2, label='', label_x=None, label_y=None):
    import math
    d.add(Line(x1, y1, x2, y2, strokeColor=MUTED, strokeWidth=.8))
    angle = math.atan2(y2-y1, x2-x1)
    pts = [x2,y2,x2-5*math.cos(angle-.4),y2-5*math.sin(angle-.4),x2-5*math.cos(angle+.4),y2-5*math.sin(angle+.4)]
    d.add(Polygon(pts, fillColor=MUTED, strokeColor=MUTED))
    if label:
        d.add(String(label_x if label_x is not None else (x1+x2)/2,
                     label_y if label_y is not None else (y1+y2)/2+5,
                     label, textAnchor='middle', fontName='Helvetica', fontSize=7.3, fillColor=MUTED))

def architecture():
    d = Drawing(WIDTH, 210)
    box(d, 0, 94, 'React browser', 112)
    box(d, 185, 170, 'Supabase Auth', 124)
    box(d, 185, 94, 'PostgREST / RLS', 124)
    box(d, 185, 18, 'Express / Socket.IO', 124)
    box(d, 390, 94, 'PostgreSQL', 114)
    arrow(d, 56, 126, 185, 186, 'Auth token', 113, 175)
    arrow(d, 112, 110, 185, 110, 'User CRUD')
    arrow(d, 56, 94, 185, 34, 'Socket / HTTP', 108, 52)
    arrow(d, 309, 110, 390, 110, 'Policies')
    arrow(d, 309, 34, 390, 94, 'Trusted RPC', 360, 70)
    return d

def domain():
    d = Drawing(WIDTH, 356)
    for x,y,name in [(0,310,'Teacher'),(198,310,'Quiz'),(396,310,'Question'),
                     (198,230,'GameSession'),(0,150,'Team'),(198,150,'Player'),(396,150,'Answer'),
                     (198,70,'AuthUser'),(0,0,'PracticeSet'),(132,0,'PracticeAnswer'),(264,0,'StudyDay'),(396,0,'Cosmetics')]:
        box(d,x,y,name)
    arrow(d,108,326,198,326,'owns 1:N')
    arrow(d,306,326,396,326,'contains 1:N')
    arrow(d,252,310,252,262,'hosts 1:N',300,283)
    arrow(d,198,246,54,182,'groups 1:N',95,226)
    arrow(d,252,230,252,182,'admits 1:N',300,205)
    arrow(d,306,166,396,166,'submits 1:N')
    arrow(d,450,310,450,182,'evaluates 1:N',450,248)
    arrow(d,252,102,252,150,'identifies',293,124)
    arrow(d,198,86,54,32,'owns',106,68)
    arrow(d,108,16,132,16)
    arrow(d,306,86,318,32,'earns',340,60)
    arrow(d,306,86,450,32,'selects',434,66)
    d.add(String(180,45,'legacy set records 1:N attempts',fontName='Helvetica',fontSize=7.3,textAnchor='middle',fillColor=MUTED))
    return d

def sequence():
    d = Drawing(WIDTH, 330)
    actors=[(45,'Host'),(177,'Server'),(320,'PostgreSQL'),(459,'Player')]
    for x,name in actors:
        box(d,x-42,292,name,84)
        d.add(Line(x,8,x,292,strokeColor=colors.HexColor('#bac9c1'),strokeWidth=.7,strokeDashArray=[3,3]))
    steps=[(45,177,'Start with revision'),(177,320,'Commit phase / deadline'),(177,459,'Public question; no answer key'),
           (459,177,'Submit choice and request ID'),(177,320,'Validate; commit answer + points'),(177,459,'Acknowledge accepted answer'),
           (45,177,'Reveal with revision'),(177,320,'Lock answers / feedback phase'),(177,459,'Release only allowed feedback'),
           (459,177,'Sync after reconnect'),(177,320,'Read durable state'),(177,459,'Restore player, team and answer')]
    for i,(start,end,label) in enumerate(steps):
        y=270-i*22
        arrow(d,start,y,end,y,label,label_y=y+5)
    return d

def table(rows):
    data = [[Paragraph(inline(cell), styles['Cell']) for cell in row] for row in rows]
    result = Table(data, colWidths=[115,195,194], repeatRows=1, hAlign='LEFT')
    result.setStyle(TableStyle([
        ('BACKGROUND',(0,0),(-1,0),PALE),('VALIGN',(0,0),(-1,-1),'TOP'),
        ('BOX',(0,0),(-1,-1),.5,colors.HexColor('#c6d2ca')),
        ('INNERGRID',(0,0),(-1,-1),.4,colors.HexColor('#d5dfd8')),
        ('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),
        ('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8),
    ]))
    return result

lines=(ROOT/'docs'/'sprint-report.md').read_text(encoding='utf-8').splitlines()
story=[];paragraph=[];i=0
new_pages={'Domain model','Gameplay and recovery','Sprint delivery and next checks','Verification evidence','Reproducible demonstration'}
def flush():
    if paragraph:
        story.append(Paragraph(inline(' '.join(paragraph)),styles['ReportBody']));paragraph.clear()
while i<len(lines):
    line=lines[i]
    if line.startswith('```mermaid'):
        flush();code=[];i+=1
        while i<len(lines) and lines[i]!='```':code.append(lines[i]);i+=1
        first=code[0].strip()
        story.append(architecture() if first.startswith('flowchart') else domain() if first=='classDiagram' else sequence())
        story.append(Spacer(1,12))
    elif line.startswith('|'):
        flush();rows=[]
        while i<len(lines) and lines[i].startswith('|'):
            if not re.match(r'^\|\s*---',lines[i]):rows.append([c.strip() for c in lines[i].strip('|').split('|')])
            i+=1
        story.append(table(rows));story.append(Spacer(1,12));continue
    elif line.startswith('# '):
        flush();story.append(Paragraph(inline(line[2:]),styles['ReportTitle']))
    elif line.startswith('## '):
        flush();title=line[3:]
        if title in new_pages:story.append(PageBreak())
        story.append(Paragraph(inline(title),styles['ReportHeading']))
    elif not line.strip():flush()
    elif re.match(r'^\d+\.\s',line):flush();paragraph.append(line)
    else:paragraph.append(line)
    i+=1
flush()
def page(canvas,doc):
    canvas.setStrokeColor(colors.HexColor('#c6d2ca'));canvas.line(54,42,558,42)
    canvas.setFillColor(MUTED);canvas.setFont('Helvetica',8)
    canvas.drawString(54,29,'GRASP  /  feat/game-creation  /  November 8, 2026')
    canvas.drawRightString(558,29,str(doc.page))

doc=SimpleDocTemplate(str(OUTPUT),pagesize=(612,792),leftMargin=54,rightMargin=54,topMargin=42,bottomMargin=57,
    title='Grasp implementation and release report',author='Grasp project',pageCompression=1)
doc.build(story,onFirstPage=page,onLaterPages=page)
print(OUTPUT)
