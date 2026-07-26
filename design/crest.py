"""Ex8 ornate crest — flat 2D vector, square. Reference-matched composition."""
import math, cairosvg

# ---------- palette ----------
NAVY="#182742"; GREEN="#1f5138"; GREEN_D="#173d2b"; GOLD="#c9a227"; GOLD_L="#e6c65a"
GOLD_D="#8f6f1c"; CREAM="#f4ecd2"; INK="#14110b"; RED="#b23a2e"; MEAT="#8f3322"
AMBER="#e6a12a"; FOAM="#f6efd8"; HOP="#6f8f3a"; WHEAT="#d3a94a"

W=H=1600

# ---------- bezier sampler ----------
def _b(p0,p1,p2,p3,t):
    mt=1-t
    x=mt**3*p0[0]+3*mt**2*t*p1[0]+3*mt*t**2*p2[0]+t**3*p3[0]
    y=mt**3*p0[1]+3*mt**2*t*p1[1]+3*mt*t**2*p2[1]+t**3*p3[1]
    return x,y

def sample_path(segs, n_per=40):
    pts=[]
    for (p0,p1,p2,p3) in segs:
        for i in range(n_per):
            pts.append(_b(p0,p1,p2,p3,i/n_per))
    return pts

def segs_to_d(segs):
    d=f"M {segs[0][0][0]:.1f} {segs[0][0][1]:.1f} "
    for (p0,p1,p2,p3) in segs:
        d+=f"C {p1[0]:.1f} {p1[1]:.1f} {p2[0]:.1f} {p2[1]:.1f} {p3[0]:.1f} {p3[1]:.1f} "
    return d+"Z"

def shield_segs(cx, top, shoulder, widest, bottom, hw_sh, hw_wide):
    """Symmetric shield built from beziers. Returns segment list (clockwise)."""
    TL=(cx-hw_sh, top); TR=(cx+hw_sh, top)
    R_wide=(cx+hw_wide, widest); L_wide=(cx-hw_wide, widest)
    BOT=(cx, bottom)
    segs=[
        # top edge (gentle arch up)
        (TL,(cx-hw_sh*0.4, top-26),(cx+hw_sh*0.4, top-26),TR),
        # right shoulder -> widest
        (TR,(cx+hw_sh+40, shoulder),(cx+hw_wide, widest-120),R_wide),
        # widest -> bottom point
        (R_wide,(cx+hw_wide-6, bottom-360),(cx+220, bottom-70),BOT),
        # bottom point -> left widest
        (BOT,(cx-220, bottom-70),(cx-hw_wide+6, bottom-360),L_wide),
        # left widest -> shoulder
        (L_wide,(cx-hw_wide, widest-120),(cx-hw_sh-40, shoulder),TL),
    ]
    return segs

def rope(pts, r=9, c1=GOLD_L, c2=GOLD_D, step=2):
    s=[]
    for i in range(0,len(pts),step):
        x,y=pts[i]
        col=c1 if (i//step)%2==0 else c2
        s.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r}" fill="{col}"/>')
    return "".join(s)

if __name__=="__main__":
    cx=800
    segs=shield_segs(cx, 300, 360, 560, 1360, 470, 520)
    d=segs_to_d(segs)
    pts=sample_path(segs, 46)
    svg=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">']
    svg.append(f'<rect width="{W}" height="{H}" fill="{NAVY}"/>')
    # outer gold plate
    svg.append(f'<path d="{d}" fill="{GOLD}" stroke="{GOLD_D}" stroke-width="4"/>')
    # inner green field
    seg_in=shield_segs(cx, 322, 380, 566, 1330, 442, 490)
    svg.append(f'<path d="{segs_to_d(seg_in)}" fill="{GREEN}" stroke="{GREEN_D}" stroke-width="3"/>')
    # rope on outer edge
    svg.append(rope(pts))
    svg.append('</svg>')
    doc="".join(svg)
    open("/home/user/Dayel/design/_shield.svg","w").write(doc)
    cairosvg.svg2png(bytestring=doc.encode(),write_to="/home/user/Dayel/design/_shield.png",output_width=800,output_height=800)
    print("shield test done")
