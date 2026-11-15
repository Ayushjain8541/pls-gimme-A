"""Bounded PDF extraction. stdout is JSON only; source PDFs stay private."""
import argparse, json, os, sys
import pymupdf
parser=argparse.ArgumentParser()
parser.add_argument('--input',required=True)
parser.add_argument('--out',required=True)
a=parser.parse_args()
try:
    d=pymupdf.open(a.input)
    if d.needs_pass: raise ValueError('encrypted_pdf')
    if not 0 < len(d) <= 100: raise ValueError('page_limit')
    os.makedirs(a.out,exist_ok=True)
    pages=[]
    for i,p in enumerate(d):
        w,h=p.rect.width,p.rect.height
        scale=min(120/72,(16000000/max(1,w*h))**0.5)
        pix=p.get_pixmap(matrix=pymupdf.Matrix(scale,scale),alpha=False)
        filename=f'page-{i+1}.png'
        pix.save(os.path.join(a.out,filename))
        blocks=[{'bbox':list(b[:4]),'text':b[4]} for b in p.get_text('blocks',sort=True) if b[6]==0]
        pages.append({'page':i+1,'width':w,'height':h,'text':'\n'.join(b['text'] for b in blocks),'textBlocks':blocks,'file':filename})
    print(json.dumps({'pages':pages}))
except Exception as e:
    code=str(e) if str(e) in ('encrypted_pdf','page_limit') else 'unreadable_pdf'
    print(json.dumps({'error':code}))
    sys.exit(1)
