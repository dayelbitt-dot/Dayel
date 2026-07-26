"""Ornate crest elements — flat 2D vector. All centered at origin unless noted."""
import math
from crest import (NAVY,GREEN,GREEN_D,GOLD,GOLD_L,GOLD_D,CREAM,INK,RED,MEAT,
                   AMBER,FOAM,HOP,WHEAT)

STEEL="#d7d2c4"; STEEL_D="#9a958a"; HANDLE="#3a2a1c"; POT="#20211f"; POT_L="#33352f"
STEW="#c65b1e"; BONE="#efe6cf"

# ---------------- star ----------------
def star(r=44, fill=GOLD_L, stroke=GOLD_D, sw=4, inner=0.44):
    pts=[]
    for i in range(10):
        ang=-math.pi/2+i*math.pi/5
        rr=r if i%2==0 else r*inner
        pts.append(f"{rr*math.cos(ang):.1f},{rr*math.sin(ang):.1f}")
    return f'<polygon points="{" ".join(pts)}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round"/>'

# ---------------- scroll flourish (curl) ----------------
def flourish(scale=1.0, flip=False, fill="none", stroke=GOLD_L, sw=7):
    f=-1 if flip else 1
    d=(f"M 0 0 C {40*f} -6 {78*f} -2 {96*f} 20 "
       f"C {112*f} 40 {96*f} 70 {70*f} 66 "
       f"C {50*f} 62 {50*f} 36 {68*f} 34 "
       f"C {80*f} 33 {84*f} 46 {78*f} 52")
    leaf=(f"M {30*f} -2 q {18*f} -26 {44*f} -20 q {-16*f} 10 {-10*f} 30")
    return (f'<g transform="scale({scale})">'
            f'<path d="{d}" fill="none" stroke="{stroke}" stroke-width="{sw}" stroke-linecap="round"/>'
            f'<path d="{leaf}" fill="{HOP}" stroke="{GREEN_D}" stroke-width="2"/>'
            f'</g>')

# ---------------- ornate banner ----------------
def banner(cx, cy, w, h, fill=GOLD, stroke=GOLD_D, dark=GOLD_D, sw=5, notch=True):
    l,r=cx-w/2,cx+w/2; t,b=cy-h/2,cy+h/2
    tw=h*0.9
    s=""
    # back tails
    for sgn in (-1,1):
        ex=r if sgn>0 else l
        s+=(f'<path d="M {ex} {t+6} l {sgn*tw} {-h*0.30:.0f} '
            f'l {sgn*-tw*0.34:.0f} {h*0.62:.0f} l {sgn*tw} {-h*0.10:.0f} '
            f'l {sgn*-tw*1.0:.0f} {h*0.30:.0f} Z" fill="{dark}" stroke="{stroke}" '
            f'stroke-width="{sw}" stroke-linejoin="round"/>')
    # main plate
    s+=(f'<path d="M {l} {t} Q {cx} {t-12} {r} {t} L {r} {b} Q {cx} {b+12} {l} {b} Z" '
        f'fill="{fill}" stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round"/>')
    # inner line
    s+=(f'<path d="M {l+10} {t+9} Q {cx} {t-2} {r-10} {t+9} L {r-10} {b-9} '
        f'Q {cx} {b+2} {l+10} {b-9} Z" fill="none" stroke="{GOLD_D}" stroke-width="2" opacity="0.6"/>')
    return s

# ---------------- padel racket (butt at origin, grows up) ----------------
def racket(face=CREAM, rim=GOLD, hole=GREEN, handle=HANDLE, stroke=INK, sw=6):
    hc=-196; rx=58; ry=72
    s=f'<g stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round" stroke-linecap="round">'
    s+=f'<rect x="-15" y="-100" width="30" height="102" rx="11" fill="{handle}"/>'
    s+=f'<rect x="-19" y="-16" width="38" height="20" rx="8" fill="{handle}"/>'
    s+=f'<path d="M -15 -100 L -26 -128 L 26 -128 L 15 -100 Z" fill="{handle}"/>'
    s+=f'<ellipse cx="0" cy="{hc}" rx="{rx}" ry="{ry}" fill="{rim}"/>'
    s+=f'<ellipse cx="0" cy="{hc}" rx="{rx-11}" ry="{ry-11}" fill="{face}"/>'
    s+='</g>'
    # holes
    for yy in range(-1,2):
        for xx in range(-2,3):
            hx=xx*20+(10 if yy%2 else 0); hy=hc+yy*22
            if (hx/(rx-16))**2+((hy-hc)/(ry-16))**2<=1:
                s+=f'<circle cx="{hx}" cy="{hy}" r="5.5" fill="{hole}"/>'
    # grip lines
    for gy in (-30,-48,-66,-84):
        s+=f'<line x1="-12" y1="{gy}" x2="12" y2="{gy+8}" stroke="{GOLD_L}" stroke-width="3" opacity="0.5"/>'
    return s

# ---------------- churrasco knife (blade up, handle at origin) ----------------
def knife(stroke=INK, sw=5):
    s=f'<g stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round" stroke-linecap="round">'
    s+=f'<rect x="-11" y="0" width="22" height="90" rx="7" fill="{HANDLE}"/>'  # handle
    for gy in (24,44,64): s+=f'<line x1="-8" y1="{gy}" x2="8" y2="{gy}" stroke="{GOLD_L}" stroke-width="2.5" opacity="0.6"/>'
    # bolster
    s+=f'<rect x="-13" y="-14" width="26" height="16" rx="4" fill="{GOLD}"/>'
    # blade pointing up
    s+=f'<path d="M -12 -14 L 12 -14 L 12 -150 Q 12 -172 -2 -180 Q -12 -150 -12 -60 Z" fill="{STEEL}"/>'
    s+=f'<path d="M 12 -14 L 12 -150 Q 12 -172 -2 -180 L 4 -150 L 4 -14 Z" fill="{STEEL_D}" stroke="none" opacity="0.7"/>'
    s+='</g>'
    return s

# ---------------- churrasco fork ----------------
def fork(stroke=INK, sw=5):
    s=f'<g stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round" stroke-linecap="round">'
    s+=f'<rect x="-11" y="0" width="22" height="90" rx="7" fill="{HANDLE}"/>'
    for gy in (24,44,64): s+=f'<line x1="-8" y1="{gy}" x2="8" y2="{gy}" stroke="{GOLD_L}" stroke-width="2.5" opacity="0.6"/>'
    s+=f'<rect x="-13" y="-14" width="26" height="16" rx="4" fill="{GOLD}"/>'
    s+=f'<rect x="-13" y="-58" width="26" height="46" rx="6" fill="{STEEL}"/>'  # neck
    # two tines
    s+=f'<path d="M -11 -58 L -11 -150 Q -11 -160 -6 -160 L -6 -58 Z" fill="{STEEL}"/>'
    s+=f'<path d="M 11 -58 L 11 -150 Q 11 -160 6 -160 L 6 -58 Z" fill="{STEEL}"/>'
    s+='</g>'
    return s

# ---------------- ball ----------------
def ball(r=30, fill="#dfe64a", stroke=INK, sw=5):
    s=f'<circle cx="0" cy="0" r="{r}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>'
    s+=f'<path d="M {-r*0.95} {-r*0.35} Q 0 {r*0.15} {r*0.95} {-r*0.35}" fill="none" stroke="{stroke}" stroke-width="{sw*0.7:.1f}"/>'
    s+=f'<path d="M {-r*0.95} {r*0.35} Q 0 {-r*0.15} {r*0.95} {r*0.35}" fill="none" stroke="{stroke}" stroke-width="{sw*0.7:.1f}"/>'
    return s

# ---------------- grill with ribs & skewers ----------------
def grill(stroke=INK, sw=6):
    s=f'<g stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round" stroke-linecap="round">'
    # bowl
    s+=f'<ellipse cx="0" cy="6" rx="150" ry="46" fill="{POT}"/>'
    s+=f'<path d="M -150 6 Q 0 92 150 6 L 132 44 Q 0 118 -132 44 Z" fill="{POT_L}"/>'
    # legs
    s+=f'<line x1="-96" y1="70" x2="-120" y2="120"/><line x1="96" y1="70" x2="120" y2="120"/>'
    # grate lines
    s+='</g>'
    for gx in range(-120,121,24):
        s+=f'<line x1="{gx}" y1="{6-38*(1-(gx/150)**2)**0.5:.0f}" x2="{gx}" y2="{6+38*(1-(gx/150)**2)**0.5:.0f}" stroke="{STEEL_D}" stroke-width="3" opacity="0.55"/>'
    # ribs slab
    s+=f'<g stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round">'
    s+=f'<path d="M -96 -6 Q -60 -30 24 -22 Q 96 -16 92 6 Q 40 22 -40 18 Q -104 12 -96 -6 Z" fill="{MEAT}"/>'
    for i,rx in enumerate(range(-72,90,26)):
        s+=f'<line x1="{rx}" y1="-20" x2="{rx-6}" y2="14" stroke="{BONE}" stroke-width="5"/>'
    s+='</g>'
    # a skewer with chunks over the grill
    s+=f'<line x1="-140" y1="-30" x2="150" y2="-52" stroke="{STEEL_D}" stroke-width="5" stroke-linecap="round"/>'
    for t in (0.42,0.6,0.78):
        cxp=-140+290*t; cyp=-30+(-22)*t
        s+=f'<rect x="{cxp-14:.0f}" y="{cyp-13:.0f}" width="28" height="26" rx="8" fill="{MEAT}" stroke="{stroke}" stroke-width="4"/>'
    return s

# ---------------- hop cone ----------------
def hop(scale=1.0, stroke=GREEN_D, sw=3):
    s=f'<g transform="scale({scale})" stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round">'
    rows=[(-46,16,1),(-30,26,2),(-10,32,3),(12,30,2),(30,22,1)]
    petal_cols=[HOP,"#83a544"]
    yprev=-58
    idx=0
    for (yy,wspread,cnt) in rows:
        for k in range(-cnt,cnt+1):
            xx=k*(wspread/ (cnt if cnt else 1))
            col=petal_cols[idx%2]; idx+=1
            s+=f'<path d="M {xx:.0f} {yy-16} q -16 12 -12 26 q 12 10 24 0 q 4 -14 -12 -26 Z" fill="{col}"/>'
    s+='</g>'
    # stem
    s+=f'<line x1="0" y1="-58" x2="0" y2="-78" stroke="{GREEN_D}" stroke-width="4" stroke-linecap="round"/>'
    return s

# ---------------- wheat stalk (vertical, base at origin) ----------------
def wheat(scale=1.0, stroke=GOLD_D, sw=2.5):
    s=f'<g transform="scale({scale})" stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round">'
    s+=f'<line x1="0" y1="0" x2="0" y2="-150" stroke="{WHEAT}" stroke-width="6"/>'
    for yy in range(-40,-152,-20):
        for sgn in (-1,1):
            s+=(f'<path d="M 0 {yy} q {sgn*20} {-6} {sgn*24} {-24} q {sgn*-16} {2} {sgn*-22} {18} Z" '
                f'fill="{WHEAT}"/>')
    s+=f'<path d="M 0 -150 q -8 -20 0 -40 q 8 20 0 40 Z" fill="{WHEAT}"/>'
    s+='</g>'
    return s

# ---------------- beer mug ----------------
def mug(flip=False, stroke=INK, sw=6):
    f=-1 if flip else 1
    s=f'<g transform="scale({f},1)">'
    s+=f'<g stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round" stroke-linecap="round">'
    s+=f'<path d="M 44 -14 C 88 -18 88 62 44 58" fill="none" stroke="{stroke}" stroke-width="{sw+16}"/>'
    s+=f'<path d="M 44 -14 C 88 -18 88 62 44 58" fill="none" stroke="{AMBER}" stroke-width="{sw+3}"/>'
    s+=f'<path d="M -44 -28 L 44 -28 L 40 84 L -40 84 Z" fill="{AMBER}"/>'
    s+='</g>'
    for gx in (-22,0,20): s+=f'<line x1="{gx}" y1="-16" x2="{gx-3}" y2="74" stroke="{INK}" stroke-width="3" opacity="0.22"/>'
    for bx,by,br in ((-18,12,5),(6,36,4),(-4,58,3.5)): s+=f'<circle cx="{bx}" cy="{by}" r="{br}" fill="{FOAM}" opacity="0.5"/>'
    # foam
    s+=(f'<path d="M -50 -28 C -58 -62 -20 -68 -12 -50 C -6 -76 34 -76 34 -50 '
        f'C 46 -72 74 -48 54 -28 Z" fill="{FOAM}" stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round"/>')
    s+='</g>'
    return s

# ---------------- panela (pot with stew + steam) ----------------
def panela(stroke=INK, sw=6):
    s=""
    for sx in (-20,0,20):
        s+=(f'<path d="M {sx} -46 q -10 -12 0 -24 q 10 -12 0 -24" fill="none" '
            f'stroke="{FOAM}" stroke-width="5" stroke-linecap="round" opacity="0.8"/>')
    s+=f'<g stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round" stroke-linecap="round">'
    s+=f'<path d="M -58 -6 q -20 4 -20 20 q 0 12 12 12" fill="none" stroke-width="{sw+9}"/>'
    s+=f'<path d="M 58 -6 q 20 4 20 20 q 0 12 -12 12" fill="none" stroke-width="{sw+9}"/>'
    s+=f'<path d="M -58 -8 L 58 -8 L 50 64 Q 46 74 34 74 L -34 74 Q -46 74 -50 64 Z" fill="{POT}"/>'
    s+=f'<ellipse cx="0" cy="-8" rx="58" ry="14" fill="{STEW}"/>'
    s+=f'<ellipse cx="0" cy="-8" rx="58" ry="14" fill="none"/>'
    s+='</g>'
    for bx in (-24,0,26): s+=f'<circle cx="{bx}" cy="-10" r="4" fill="{GOLD_L}" opacity="0.7"/>'
    return s

# ---------------- emblem text (layered varsity) ----------------
def emblem_text(text,x,y,size,font="Big Shoulders",weight="700",
                face=CREAM,edge=GOLD_D,shadow=INK,ls=2):
    common=(f'font-family="{font}" font-size="{size}" font-weight="{weight}" '
            f'text-anchor="middle" dominant-baseline="central" letter-spacing="{ls}"')
    s=f'<text x="{x}" y="{y+6}" {common} fill="{shadow}">{text}</text>'
    s+=f'<text x="{x}" y="{y}" {common} fill="none" stroke="{edge}" stroke-width="10" stroke-linejoin="round">{text}</text>'
    s+=f'<text x="{x}" y="{y}" {common} fill="none" stroke="{GOLD_L}" stroke-width="5" stroke-linejoin="round">{text}</text>'
    s+=f'<text x="{x}" y="{y}" {common} fill="{face}">{text}</text>'
    return s

def divider(cx,y,w,col=GOLD):
    l,r=cx-w/2,cx+w/2
    s=f'<line x1="{l}" y1="{y}" x2="{r}" y2="{y}" stroke="{col}" stroke-width="6"/>'
    s+=f'<circle cx="{l}" cy="{y}" r="7" fill="{col}"/><circle cx="{r}" cy="{y}" r="7" fill="{col}"/>'
    return s
